import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  summarizeEnrichmentLimits,
  validateAndNormalizeSemanticBatchResult,
  validateNormalizedEnrichmentResult
} from './src/modules/enrichment/services/semanticEnrichmentPipeline.js';

// Загружаем единый .env из корня проекта
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.AI_MODEL;
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
 * Вычисляет engagement_rate для поста
 * @param {Object} metrics - метрики поста
 * @returns {number} - engagement_rate
 */
export function calculateEngagementRate(metrics) {
  const { likes = 0, comments = 0, shares = 0, views = 0 } = metrics;
  
  if (views === 0) {
    return 0;
  }
  
  return Number(((likes + comments + shares) / views).toFixed(4));
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
            post.engagement_rate = calculateEngagementRate(post.metrics);
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
  const llmResponse = await callDeepSeekAPI(
    systemPrompt,
    buildSemanticUserPrompt(batch.payload, { compact }),
    {
      temperature: compact ? 0.1 : 0.2,
      maxTokens: compact ? 4000 : 8000,
      // Enrichment expects strict JSON; ask the model to return JSON object.
      responseFormat: 'json'
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
 * Отправляет запрос к LLM API
 * @param {string} systemPrompt - системный промпт
 * @param {string} userPrompt - пользовательский промпт
 * @param {Object} options - дополнительные опции
 * @returns {Promise<Object>} - ответ от API
 */
export async function callDeepSeekAPI(systemPrompt, userPrompt, options = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('API ключ для LLM не установлен в переменных окружения');
  }

  const {
    temperature = 0.4,
    maxTokens = 100000,
    responseFormat = null
  } = options;

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

  // Если нужен JSON формат ответа
  if (responseFormat === 'json') {
    requestBody.response_format = { type: 'json_object' };
  }

  try {
    console.log(`[LLM] Отправка запроса`);  
    console.log(`[LLM] Размер промпта: ${(systemPrompt.length + userPrompt.length) / 1024} KB`);
    
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

    console.log(`[LLM] Ответ получен. Статус: ${response.status}`);
    console.log(`[LLM] Использовано токенов: ${response.data.usage?.total_tokens || 'N/A'}`);
    
    const content = response.data.choices?.[0]?.message?.content || null;
    if (!content) {
      console.warn('[LLM] Внимание: контент отсутствует в ответе');
      console.log('[LLM] Полный ответ:', JSON.stringify(response.data, null, 2));
    }

    return {
      success: true,
      data: response.data,
      content: content,
      usage: response.data.usage || null
    };
  } catch (error) {
    console.error('Ошибка при вызове LLM API:', error.response?.data || error.message);

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
 * Обогащает данные конкурентов через LLM
 * @param {Object} competitorsData - сырые данные от парсера (уже с engagement_rate)
 * @returns {Promise<Object>} - обогащенные данные
 */
export async function enrichCompetitorsData(competitorsData) {
  const config = getEnrichmentConfig();
  const dataWithEngagementRate = enrichWithEngagementRate(competitorsData);
  const limitsSummary = summarizeEnrichmentLimits(dataWithEngagementRate, config);
  const dataSizeKb = (limitsSummary.payload_bytes / 1024).toFixed(2);
  console.log(`Размер исходных данных для enrichment: ${dataSizeKb} KB`);

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

  if (!batches.length) {
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
  let parseError = null;

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
        console.log(
          `[LLM] Enrichment batch ${index + 1}/${batches.length}, posts=${batch.stats.posts_count}, bytes=${batch.stats.payload_bytes}, attempt=${attempt + 1}/${totalAttempts}${apiAttempt > 0 ? ` (api retry ${apiAttempt})` : ''}`
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
        console.error(
          `[LLM] Ошибка enrichment batch ${index + 1}/${batches.length}:`,
          error.message
        );

        if (isRetryableApiError(error) && apiAttempt < maxApiRetries) {
          apiAttempt += 1;
          const delayMs = 2000;
          console.log(`[LLM] Повтор запроса через ${delayMs} мс из-за ошибки API (${error.responseStatus})...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        // Увеличиваем попытку валидации только когда мы не делаем API retry.
        attempt += 1;
      }
    }

    if (lastError) {
      const isApi = isRetryableApiError(lastError) || (typeof lastError.responseStatus === 'number' && lastError.responseStatus >= 400);
      parseError = {
        message: lastError.message,
        batch_index: index + 1,
        total_batches: batches.length,
        validation_errors: lastError.validation_errors || null,
        raw_content: typeof lastError.raw_content === 'string' ? lastError.raw_content.slice(0, 3000) : null,
        error_type: isApi ? 'api_error' : 'validation_error',
        response_status: lastError.responseStatus ?? null
      };
      break;
    }
  }

  const enrichedData = !parseError
    ? mergeSemanticBatchResults(dataWithEngagementRate, semanticMaps)
    : null;
  const postProcessedData = enrichedData ? applyDeterministicPostProcessing(enrichedData) : null;
  const normalizedData = postProcessedData
    ? normalizeCompetitorsContentData(postProcessedData)
    : null;
  const normalizedValidation = normalizedData
    ? validateNormalizedEnrichmentResult(normalizedData)
    : { valid: false, errors: ['normalized_data is null'] };

  if (!parseError && !normalizedValidation.valid) {
    parseError = {
      message: 'Нормализованный результат enrichment не прошел валидацию',
      validation_errors: normalizedValidation.errors
    };
  }

  return {
    enriched_data: parseError ? null : normalizedData,
    raw_response: rawResponses.join('\n\n--- batch separator ---\n\n'),
    parse_error: parseError,
    usage: usageItems.length ? mergeUsageStats(usageItems) : null,
    metadata: {
      enriched_at: new Date().toISOString(),
      model: 'llm',
      engagement_rate_calculated_locally: true,
      parse_successful: parseError === null,
      normalized_to_content_model: parseError === null && normalizedData !== null,
      batching: {
        total_batches: batches.length,
        auto_batched: batches.length > 1,
        batch_stats: batchStats
      },
      request_limits: limitsSummary
    }
  };
}



