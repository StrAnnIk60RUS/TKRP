import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './src/shared/logging/logger.js';
import { applyDeterministicPostProcessing } from './src/modules/enrichment/services/postDeterministicFeatures.js';
import {
  normalizeCompetitorsContentData
} from './src/shared/models/contentModels.js';
import {
  buildSemanticEnrichmentBatches,
  buildSemanticUserPrompt,
  extractJsonObjectFromContent,
  getEnrichmentConfig,
  mergeSemanticBatchResults,
  SEMANTIC_ENRICHMENT_BATCH_JSON_SCHEMA,
  summarizeEnrichmentLimits,
  validateAndNormalizeSemanticBatchResult,
  validateNormalizedEnrichmentResult
} from './src/modules/enrichment/services/semanticEnrichmentPipeline.js';
import {
  buildLlmCacheKey,
  isLlmCacheEnabled,
  llmCacheOrCompute
} from './src/shared/utils/llmCache.js';

// Загружаем единый .env из корня проекта
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const llmLog = logger.child({ module: 'openrouter' });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.AI_MODEL;
/** Верхняя граница completion, если вызов не передал свой maxTokens (планирование и т.п.). */
const DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS = 32768;
const SEMANTIC_ENRICHMENT_PROMPT_PATH = path.join(
  __dirname,
  'src',
  'shared',
  'prompts',
  'articleStage1SemanticEnrichmentPrompt.txt'
);

// Экспортируем для проверки в server.js
export { OPENROUTER_API_KEY, AI_MODEL };

/**
 * Semantic enrichment gate: default ON in development, OFF in production
 * (detected via APP_ENV/NODE_ENV). Explicit SEMANTIC_ENRICHMENT_ENABLED overrides.
 * @returns {boolean}
 */
export function isSemanticEnrichmentEnabled() {
  const explicit = process.env.SEMANTIC_ENRICHMENT_ENABLED;
  if (explicit === 'true' || explicit === 'false') {
    return explicit === 'true';
  }
  const env = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
  return env !== 'production';
}

/**
 * LLM response cache: implemented in shared/utils/llmCache.js (TTL + LRU,
 * env-configurable via LLM_CACHE_* with SEMANTIC_ENRICHMENT_CACHE_* fallbacks).
 */

/**
 * Rate limiter: at most SEMANTIC_ENRICH_RATE_LIMIT_PER_MIN API calls per rolling minute;
 * excess calls wait until a slot frees (simple timestamp queue).
 * @returns {Promise<void>}
 */
async function waitForRateLimitSlot() {
  const perMin = Number(process.env.SEMANTIC_ENRICH_RATE_LIMIT_PER_MIN ?? 0);
  if (!Number.isFinite(perMin) || perMin <= 0) return;
  const windowMs = 60000;
  for (;;) {
    const now = Date.now();
    while (requestTimestamps.length && now - requestTimestamps[0] >= windowMs) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < perMin) {
      requestTimestamps.push(now);
      return;
    }
    const waitMs = windowMs - (now - requestTimestamps[0]) + 10;
    llmLog.warn(`Rate limit (${perMin}/min) reached, waiting ${waitMs}ms`, { perMin, waitMs });
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

const requestTimestamps = [];

async function callOpenRouterChatUncached(systemPrompt, userPrompt, options = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('API ключ для LLM не установлен в переменных окружения');
  }

  const {
    temperature = 0.4,
    responseFormat = null,
    jsonSchema = null,
    schemaName = 'response',
    schemaStrict = true,
    reasoningEffort = process.env.OPENROUTER_REASONING_EFFORT || 'none'
  } = options;
  const maxTokens =
    options.maxTokens != null && Number.isFinite(Number(options.maxTokens))
      ? Number(options.maxTokens)
      : DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS;

  const requestBody = {
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    temperature,
    max_tokens: maxTokens
  };

  // Управление reasoning для моделей-рассуждателей (DeepSeek R1/V4, OpenAI o1/o3 и т.д.)
  // 'none' отключает трату токенов на reasoning, спасая от исчерпания max_tokens при генерации JSON
  if (reasoningEffort && reasoningEffort !== 'default') {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  // Нативный JSON Schema mode или JSON object mode
  if (jsonSchema && typeof jsonSchema === 'object') {
    requestBody.response_format = {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: Boolean(schemaStrict),
        schema: jsonSchema
      }
    };
  } else if (responseFormat && typeof responseFormat === 'object') {
    requestBody.response_format = responseFormat;
  } else if (responseFormat === 'json') {
    requestBody.response_format = { type: 'json_object' };
  }

  const llmLog = logger.child({ module: 'openrouter' });

  try {
    const promptKb = Math.round((systemPrompt.length + userPrompt.length) / 10.24) / 100;
    llmLog.debug('Отправка запроса к OpenRouter', {
      model: requestBody.model,
      prompt_kb: promptKb
    });
    
    const response = await axios.post(
      OPENROUTER_API_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
          'X-Title': 'IT Project Promotion App'
        },
        timeout: 120000 // 2 минуты таймаут
      }
    );

    const totalTokens = response.data.usage?.total_tokens || null;
    llmLog.info('Ответ от OpenRouter получен', {
      status: response.status,
      total_tokens: totalTokens
    });
    
    const choice = response.data.choices?.[0];
    let content = choice?.message?.content || null;

    // Вторичный фоллбэк: если контент пуст, но есть reasoning, пробуем извлечь JSON из reasoning
    if (!content && choice?.message?.reasoning) {
      const reasoningText = String(choice.message.reasoning);
      const jsonMatch = reasoningText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
        llmLog.warn('Контент извлечён из reasoning (content был null в ответе)', {
          extracted_len: content.length
        });
      }
    }

    if (!content) {
      llmLog.warn('Контент отсутствует в ответе OpenRouter', {
        finish_reason: choice?.finish_reason,
        response_preview: JSON.stringify(response.data).slice(0, 500)
      });
    }

    return {
      success: true,
      data: response.data,
      content: content,
      usage: response.data.usage || null
    };
  } catch (error) {
    // Мягкий fallback: если провайдер не поддерживает reasoning, повторяем без него
    if (
      requestBody.reasoning &&
      error.response?.status === 400 &&
      /reasoning/i.test(String(error.response?.data?.error?.message || error.message || ''))
    ) {
      llmLog.warn('Провайдер не поддерживает reasoning, повтор без reasoning параметра');
      const { reasoningEffort: _, ...restOptions } = options;
      return await callOpenRouterChatUncached(systemPrompt, userPrompt, {
        ...restOptions,
        reasoningEffort: 'default'
      });
    }

    // Мягкий fallback: если провайдер в OpenRouter не поддерживает json_schema, повторяем с type: 'json_object'
    if (
      requestBody.response_format?.type === 'json_schema' &&
      error.response?.status === 400 &&
      /json_schema|response_format|schema/i.test(String(error.response?.data?.error?.message || error.message || ''))
    ) {
      llmLog.warn('Провайдер не поддерживает json_schema, повтор с type: json_object');
      return await callOpenRouterChatUncached(systemPrompt, userPrompt, {
        ...options,
        jsonSchema: null,
        responseFormat: 'json'
      });
    }

    llmLog.error('Ошибка при вызове LLM API', {
      status: error.response?.status,
      error: error.response?.data || error.message
    });

    let errorMessage = 'Ошибка при обращении к LLM API';
    if (error.response?.data?.error) {
      errorMessage = error.response.data.error.message || JSON.stringify(error.response.data.error);
    } else if (error.message) {
      errorMessage = error.message;
    }
    const status = error.response?.status;
    if (status) {
      errorMessage += ` (HTTP ${status})`;
    }

    const err = new Error(errorMessage);
    err.responseStatus = status;
    err.responseData = error.response?.data;
    throw err;
  }
}

/**
 * Считает вовлечённость и помечает, насколько метрики надёжны.
 * При отсутствии просмотров (типично LinkedIn) используется прокси по сумме взаимодействий.
 * @param {Object} metrics
 * @returns {{ rate: number, metrics_quality: 'views_based' | 'interaction_proxy' | 'unknown' }}
 */
export function computePostEngagementMetrics(metrics = {}) {
  const likes = Number(metrics.likes) || 0;
  const comments = Number(metrics.comments) || 0;
  const shares = Number(metrics.shares) || 0;
  const views = Number(metrics.views) || 0;
  const interactions = likes + comments + shares;

  if (views > 0) {
    const rate = Number((interactions / views).toFixed(4));
    return { rate, metrics_quality: 'views_based' };
  }

  if (interactions > 0) {
    // Ограниченный 0..1 прокси: насыщение при росте суммы реакций (reach неизвестен).
    const proxy = interactions / (interactions + 50);
    return { rate: Number(proxy.toFixed(4)), metrics_quality: 'interaction_proxy' };
  }

  return { rate: 0, metrics_quality: 'unknown' };
}

/**
 * Вычисляет engagement_rate для поста (число; для качества метрик см. computePostEngagementMetrics).
 * @param {Object} metrics - метрики поста
 * @returns {number} - engagement_rate
 */
export function calculateEngagementRate(metrics) {
  return computePostEngagementMetrics(metrics).rate;
}

/**
 * Обогащает сырые данные конкурентов: вычисляет engagement_rate для всех постов
 * @param {Object} competitorsData - сырые данные от парсера
 * @returns {Object} - данные с вычисленным engagement_rate
 */
export function enrichWithEngagementRate(competitorsData) {
  const enriched = JSON.parse(JSON.stringify(competitorsData)); // глубокое копирование
  
  if (enriched.competitors && Array.isArray(enriched.competitors)) {
    enriched.competitors.forEach(competitor => {
      if (competitor.posts && Array.isArray(competitor.posts)) {
        competitor.posts.forEach(post => {
          if (post.metrics) {
            const { rate, metrics_quality } = computePostEngagementMetrics(post.metrics);
            post.engagement_rate = rate;
            post.metrics_quality = metrics_quality;
          }
        });
      }
    });
  }
  
  return enriched;
}

function readPromptFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function mergeUsageStats(usageItems = []) {
  return usageItems.reduce(
    (acc, usage) => ({
      prompt_tokens: acc.prompt_tokens + (Number(usage?.prompt_tokens) || 0),
      completion_tokens: acc.completion_tokens + (Number(usage?.completion_tokens) || 0),
      total_tokens: acc.total_tokens + (Number(usage?.total_tokens) || 0)
    }),
    {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  );
}

function buildLimitsErrorMessage(summary) {
  return [
    'Запрос на обогащение слишком большой для текущих ограничений сервера.',
    `competitors=${summary.competitors_count}`,
    `posts=${summary.posts_count}`,
    `payload_bytes(total)=${summary.payload_bytes}`,
    `batches=${summary.batches_count ?? 'N/A'}`,
    `payload_bytes(max_batch)=${summary.max_batch_payload_bytes ?? 'N/A'}`,
    `max_request_bytes=${summary.limits.max_request_bytes}`
  ].join(' ');
}

async function enrichSemanticBatch(batch, systemPrompt, options = {}) {
  const compact = options.compact === true;
  const llmResponse = await callOpenRouterChat(
    systemPrompt,
    buildSemanticUserPrompt(batch.payload, { compact }),
    {
      temperature: compact ? 0.1 : 0.2,
      maxTokens: compact ? 4000 : 8000,
      jsonSchema: SEMANTIC_ENRICHMENT_BATCH_JSON_SCHEMA,
      schemaName: 'semantic_enrichment_batch',
      responseFormat: 'json_schema'
    }
  );

  const parsed = extractJsonObjectFromContent(llmResponse.content || '');
  const validation = validateAndNormalizeSemanticBatchResult(batch.payload, parsed);

  if (!validation.valid) {
    const error = new Error(`Невалидный семантический ответ LLM: ${validation.errors.join('; ')}`);
    error.validation_errors = validation.errors;
    error.raw_content = llmResponse.content || null;
    throw error;
  }

  return {
    postsById: validation.posts_by_id,
    rawContent: llmResponse.content || '',
    usage: llmResponse.usage || null
  };
}

/**
 * Отправляет запрос к OpenRouter Chat Completions API (модель из AI_MODEL).
 * Cached via shared llmCache.js; rate-limited by SEMANTIC_ENRICH_RATE_LIMIT_PER_MIN.
 * @param {string} systemPrompt - системный промпт
 * @param {string} userPrompt - пользовательский промпт
 * @param {Object} options - дополнительные опции (maxTokens — опционально; без него используется DEFAULT_OPENROUTER_MAX_OUTPUT_TOKENS)
 * @returns {Promise<Object>} - ответ от API
 */
export async function callOpenRouterChat(systemPrompt, userPrompt, options = {}) {
  const cacheKey = buildLlmCacheKey({
    model: AI_MODEL,
    systemPrompt,
    userPrompt,
    options
  });
  return await llmCacheOrCompute(cacheKey, async () => {
    await waitForRateLimitSlot();
    const response = await callOpenRouterChatUncached(systemPrompt, userPrompt, options);
    if (isLlmCacheEnabled()) {
      llmLog.debug('LLM response cached', { cacheKey: cacheKey.slice(0, 12) });
    }
    return response;
  });
}

/** @deprecated Используйте callOpenRouterChat */
export const callDeepSeekAPI = callOpenRouterChat;

/**
 * Обогащает данные конкурентов через LLM
 * @param {Object} competitorsData - сырые данные от парсера (уже с engagement_rate)
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData) {
  const config = getEnrichmentConfig();
  const dataWithEngagementRate = enrichWithEngagementRate(competitorsData);
  const limitsSummary = summarizeEnrichmentLimits(dataWithEngagementRate, config);
  const dataSizeKb = (limitsSummary.payload_bytes / 1024).toFixed(2);
  llmLog.info(`Исходные данные для semantic enrichment: ${dataSizeKb} KB`, {
    payload_bytes: limitsSummary.payload_bytes,
    posts_count: limitsSummary.posts_count,
    batches_count: limitsSummary.batches_count
  });

  if (limitsSummary.max_batch_payload_bytes > config.maxRequestBytes) {
    throw new Error(buildLimitsErrorMessage(limitsSummary));
  }

  if (
    !config.autoBatch &&
    limitsSummary.batches_count > 1
  ) {
    throw new Error(
      `Запрос превышает лимиты enrichment и auto-batch выключен (нужно больше 1 батча). posts=${limitsSummary.posts_count}, batches=${limitsSummary.batches_count}`
    );
  }

  const batches = buildSemanticEnrichmentBatches(dataWithEngagementRate, config);
  const systemPrompt = readPromptFile(SEMANTIC_ENRICHMENT_PROMPT_PATH);

  if (!isSemanticEnrichmentEnabled() || !batches.length) {
    const normalizedData = normalizeCompetitorsContentData(
      applyDeterministicPostProcessing(dataWithEngagementRate)
    );
    return {
      enriched_data: normalizedData,
      raw_response: '',
      parse_error: null,
      usage: null,
      metadata: {
        enriched_at: new Date().toISOString(),
        model: 'llm',
        engagement_rate_calculated_locally: true,
        parse_successful: true,
        normalized_to_content_model: true,
        batching: {
          total_batches: 0,
          auto_batched: false
        },
        request_limits: limitsSummary
      }
    };
  }

  const semanticMaps = [];
  const rawResponses = [];
  const usageItems = [];
  const batchStats = [];
  const batchErrors = [];

  const isRetryableApiError = (err) =>
    typeof err.responseStatus === 'number' && err.responseStatus >= 500 && err.responseStatus < 600;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const totalAttempts = config.retryOnInvalid ? config.maxRetries + 1 : 1;
    let lastError = null;
    const maxApiRetries = 1; // один повтор при 5xx
    let apiAttempt = 0;

    let attempt = 0;
    while (attempt < totalAttempts) {
      const compact = attempt > 0;
      try {
        llmLog.info(
          `Enrichment batch ${index + 1}/${batches.length}, posts=${batch.stats.posts_count}, bytes=${batch.stats.payload_bytes}, attempt=${attempt + 1}/${totalAttempts}${apiAttempt > 0 ? ` (api retry ${apiAttempt})` : ''}`,
          {
            batch_index: index + 1,
            total_batches: batches.length,
            posts_count: batch.stats.posts_count,
            payload_bytes: batch.stats.payload_bytes,
            attempt: attempt + 1,
            api_attempt: apiAttempt
          }
        );
        const batchResult = await enrichSemanticBatch(batch, systemPrompt, { compact });
        semanticMaps.push(batchResult.postsById);
        rawResponses.push(batchResult.rawContent);
        if (batchResult.usage) {
          usageItems.push(batchResult.usage);
        }
        batchStats.push({
          batch_index: index + 1,
          posts_count: batch.stats.posts_count,
          payload_bytes: batch.stats.payload_bytes,
          attempts_used: attempt + 1,
          compact_retry_used: compact,
          api_retries: apiAttempt
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        llmLog.error(`Enrichment batch ${index + 1}/${batches.length} failed: ${error.message}`, {
          batch_index: index + 1,
          total_batches: batches.length,
          error: error.message
        });

        if (isRetryableApiError(error) && apiAttempt < maxApiRetries) {
          apiAttempt += 1;
          const delayMs = 2000;
          llmLog.warn(`Retrying request in ${delayMs}ms due to API error (${error.responseStatus})`, {
            delayMs,
            responseStatus: error.responseStatus
          });
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        // Увеличиваем попытку валидации только когда мы не делаем API retry.
        attempt += 1;
      }
    }

    if (lastError) {
      const isApi =
        isRetryableApiError(lastError) ||
        (typeof lastError.responseStatus === 'number' && lastError.responseStatus >= 400);
      batchErrors.push({
        message: lastError.message,
        batch_index: index + 1,
        total_batches: batches.length,
        validation_errors: lastError.validation_errors || null,
        raw_content: typeof lastError.raw_content === 'string' ? lastError.raw_content.slice(0, 3000) : null,
        error_type: isApi ? 'api_error' : 'validation_error',
        response_status: lastError.responseStatus ?? null
      });
      llmLog.warn(
        `Batch ${index + 1}/${batches.length} skipped; remaining batches will be merged during partial enrichment`,
        { batch_index: index + 1, total_batches: batches.length }
      );
    }
  }

  const enrichedData = mergeSemanticBatchResults(dataWithEngagementRate, semanticMaps);
  const postProcessedData = applyDeterministicPostProcessing(enrichedData);
  const normalizedData = normalizeCompetitorsContentData(postProcessedData);
  const normalizedValidation = normalizedData
    ? validateNormalizedEnrichmentResult(normalizedData)
    : { valid: false, errors: ['normalized_data is null'] };

  let parseError = null;
  if (!normalizedValidation.valid) {
    parseError = {
      partial: false,
      message: 'Нормализованный результат enrichment не прошел валидацию',
      validation_errors: normalizedValidation.errors
    };
  } else if (batchErrors.length > 0) {
    parseError = {
      partial: true,
      message: `Частичное обогащение: не удалось обработать ${batchErrors.length} из ${batches.length} батч(ей)`,
      batch_errors: batchErrors
    };
  }

  return {
    enriched_data: normalizedValidation.valid ? normalizedData : null,
    raw_response: rawResponses.join('\n\n--- batch separator ---\n\n'),
    parse_error: parseError,
    usage: usageItems.length ? mergeUsageStats(usageItems) : null,
    metadata: {
      enriched_at: new Date().toISOString(),
      model: 'llm',
      engagement_rate_calculated_locally: true,
      parse_successful: normalizedValidation.valid,
      normalized_to_content_model: normalizedValidation.valid && normalizedData !== null,
      partial_enrichment: batchErrors.length > 0 && normalizedValidation.valid,
      batching: {
        total_batches: batches.length,
        auto_batched: batches.length > 1,
        batch_stats: batchStats,
        failed_batches: batchErrors.length
      },
      request_limits: limitsSummary
    }
  };
}



