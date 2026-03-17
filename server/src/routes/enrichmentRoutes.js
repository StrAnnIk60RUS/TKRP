import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichCompetitorsData } from '../../openrouter.js';
import { parseAndEnrichByUrl, parseOnlyByUrl } from '../services/parserPipeline.js';
import {
  getPrecedentsSnapshot,
  getPrecedentsSummary,
  persistPrecedents,
  searchPrecedents
} from '../repositories/precedentRepository.js';
import {
  getEnrichmentConfig,
  summarizeEnrichmentLimits
} from '../services/semanticEnrichmentPipeline.js';
import { runHierarchicalOptimization } from '../services/evolutionary/hierarchicalGa.js';
import { generateDraftPlanBatched } from '../services/draftPlanGenerationPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'demoPrecedents.json');

const router = Router();

function isIsoDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (isIsoDateString(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

function addDaysIso(startDate, daysToAdd) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function normalizeDraftPlanResponse(parsedDraft, formInput) {
  if (!parsedDraft || typeof parsedDraft !== 'object') return parsedDraft;
  const plan = parsedDraft?.draft_content_plan;
  if (!plan || typeof plan !== 'object') return parsedDraft;

  const requestedStart = toIsoDateOnly(formInput?.contentPlanStartDate) || null;
  const requestedEnd = toIsoDateOnly(formInput?.contentPlanEndDate) || null;
  const requestedPlatforms = Array.isArray(formInput?.platforms) ? formInput.platforms : [];

  const normalized = JSON.parse(JSON.stringify(parsedDraft));
  const normalizedPlan = normalized.draft_content_plan;

  if (requestedStart && requestedEnd) {
    normalizedPlan.planning_horizon = { start_date: requestedStart, end_date: requestedEnd };
  } else {
    const start = toIsoDateOnly(normalizedPlan?.planning_horizon?.start_date);
    const end = toIsoDateOnly(normalizedPlan?.planning_horizon?.end_date);
    normalizedPlan.planning_horizon = {
      start_date: start || (requestedStart ?? null),
      end_date: end || (requestedEnd ?? null)
    };
  }

  if (requestedPlatforms.length) {
    normalizedPlan.platforms = requestedPlatforms;
  }

  const publications = Array.isArray(normalizedPlan.publications) ? normalizedPlan.publications : [];

  // 1) dedupe by stable key
  const seen = new Set();
  const deduped = [];
  publications.forEach((pub) => {
    if (!pub || typeof pub !== 'object') return;
    const key = [
      String(pub.platform || '').toLowerCase(),
      toIsoDateOnly(pub.planned_date) || '',
      String(pub.topic || '').trim().toLowerCase(),
      String(pub.format || '').trim().toLowerCase(),
      String(pub.objective || '').trim().toLowerCase()
    ].join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(pub);
  });

  // 2) ensure unique publication_id
  const usedIds = new Set();
  deduped.forEach((pub, idx) => {
    const current = typeof pub.publication_id === 'string' ? pub.publication_id.trim() : '';
    let nextId = current;
    if (!nextId || usedIds.has(nextId)) {
      nextId = `plan_pub_${idx + 1}`;
    }
    while (usedIds.has(nextId)) {
      nextId = `${nextId}_${Math.floor(Math.random() * 10000)}`;
    }
    usedIds.add(nextId);
    pub.publication_id = nextId;
  });

  // 3) clamp planned_date into horizon and distribute if everything collapsed to one day
  const startDate = normalizedPlan?.planning_horizon?.start_date;
  const endDate = normalizedPlan?.planning_horizon?.end_date;
  if (isIsoDateString(startDate) && isIsoDateString(endDate) && deduped.length) {
    const spanDays = daysBetweenInclusive(startDate, endDate);
    const hasValidSpan = spanDays > 0;
    const normalizedDates = deduped.map((p) => toIsoDateOnly(p.planned_date)).filter(Boolean);
    const uniqueDates = new Set(normalizedDates);

    deduped.forEach((pub) => {
      const d = toIsoDateOnly(pub.planned_date);
      if (!d) return;
      if (d < startDate) pub.planned_date = startDate;
      if (d > endDate) pub.planned_date = endDate;
    });

    // If LLM returned effectively one repeated date, spread evenly across horizon
    if (hasValidSpan && uniqueDates.size <= 1) {
      const step = Math.max(1, Math.floor(spanDays / Math.max(1, deduped.length)));
      deduped.forEach((pub, idx) => {
        const offset = Math.min(spanDays - 1, idx * step);
        pub.planned_date = addDaysIso(startDate, offset);
      });
    }
  }

  normalizedPlan.publications = deduped;
  return normalized;
}

function buildRagQueryFromForm(formInput = {}) {
  const parts = [
    formInput.projectName ? `IT-проект ${formInput.projectName}` : '',
    formInput.projectDescription || '',
    formInput.projectBenefits ? `Преимущества: ${formInput.projectBenefits}` : '',
    formInput.consumerCategory ? `Аудитория: ${formInput.consumerCategory}` : '',
    Array.isArray(formInput.platforms) && formInput.platforms.length
      ? `Платформы: ${formInput.platforms.join(', ')}`
      : '',
    Array.isArray(formInput.contentFormats) && formInput.contentFormats.length
      ? `Форматы: ${formInput.contentFormats.join(', ')}`
      : ''
  ];

  return parts.filter(Boolean).join('. ');
}

router.get('/precedents/summary', (req, res) => {
  try {
    return res.json({
      success: true,
      summary: getPrecedentsSummary()
    });
  } catch (error) {
    console.error('Ошибка в /api/precedents/summary:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/precedents/summary'
    });
  }
});

router.get('/precedents', (req, res) => {
  try {
    return res.json({
      success: true,
      data: getPrecedentsSnapshot()
    });
  } catch (error) {
    console.error('Ошибка в /api/precedents:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/precedents'
    });
  }
});

router.post('/precedents/seed', (req, res) => {
  try {
    if (!fs.existsSync(DEMO_FIXTURE_PATH)) {
      return res.status(404).json({
        success: false,
        error: 'Демо-фикстура не найдена'
      });
    }
    const raw = fs.readFileSync(DEMO_FIXTURE_PATH, 'utf-8');
    const fixture = JSON.parse(raw);
    if (!fixture.competitors || !Array.isArray(fixture.competitors)) {
      return res.status(400).json({
        success: false,
        error: 'Неверный формат фикстуры: ожидается массив competitors'
      });
    }
    // persistPrecedents теперь включает индексацию эмбеддингов, поэтому async
    persistPrecedents(fixture, { source: 'demo_seed' })
      .then((persistence) =>
        res.json({
          success: true,
          message: 'Демо-база прецедентов загружена',
          persistence
        })
      )
      .catch((error) => {
        console.error('Ошибка в /api/precedents/seed:', error);
        res.status(500).json({
          success: false,
          error: error.message || 'Внутренняя ошибка сервера в /api/precedents/seed'
        });
      });
  } catch (error) {
    console.error('Ошибка в /api/precedents/seed:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/precedents/seed'
    });
  }
});

router.post('/precedents/search', async (req, res) => {
  try {
    const { query, limit, platform, audience_segments } = req.body || {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле query в теле запроса'
      });
    }

    const results = await searchPrecedents(query, {
      limit,
      platform,
      audience_segments
    });

    return res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Ошибка в /api/precedents/search:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/precedents/search'
    });
  }
});

router.post('/plan/generate', async (req, res) => {
  try {
    const { form_input, rag_query, rag_limit } = req.body || {};
    if (!form_input || typeof form_input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле form_input'
      });
    }

    const query = typeof rag_query === 'string' && rag_query.trim()
      ? rag_query.trim()
      : buildRagQueryFromForm(form_input);
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Не удалось сформировать rag_query из form_input'
      });
    }

    const ragResults = await searchPrecedents(query, {
      limit: rag_limit || 8,
      platform: Array.isArray(form_input.platforms) ? form_input.platforms[0] : undefined,
      audience_segments: form_input.consumerCategory ? [form_input.consumerCategory] : []
    });
    const generated = await generateDraftPlanBatched({
      formInput: form_input,
      query,
      ragResults,
      ragLimit: rag_limit || 8
    });
    const normalizedDraft = normalizeDraftPlanResponse(generated.draft, form_input);

    return res.json({
      success: true,
      rag: ragResults,
      draft: normalizedDraft,
      usage: generated.usage || null,
      generation_metadata: generated.generation_metadata || null
    });
  } catch (error) {
    console.error('Ошибка в /api/plan/generate:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/plan/generate'
    });
  }
});

router.post('/plan/generate-batched', async (req, res) => {
  try {
    const { form_input, rag_query, rag_limit } = req.body || {};
    if (!form_input || typeof form_input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле form_input'
      });
    }

    const query = typeof rag_query === 'string' && rag_query.trim()
      ? rag_query.trim()
      : buildRagQueryFromForm(form_input);
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Не удалось сформировать rag_query из form_input'
      });
    }

    const ragResults = await searchPrecedents(query, {
      limit: rag_limit || 8,
      platform: Array.isArray(form_input.platforms) ? form_input.platforms[0] : undefined,
      audience_segments: form_input.consumerCategory ? [form_input.consumerCategory] : []
    });

    const generated = await generateDraftPlanBatched({
      formInput: form_input,
      query,
      ragResults,
      ragLimit: rag_limit || 8
    });
    const normalizedDraft = normalizeDraftPlanResponse(generated.draft, form_input);

    return res.json({
      success: true,
      rag: ragResults,
      draft: normalizedDraft,
      usage: generated.usage || null,
      generation_metadata: generated.generation_metadata || null
    });
  } catch (error) {
    console.error('Ошибка в /api/plan/generate-batched:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/plan/generate-batched'
    });
  }
});

router.post('/plan/optimize', (req, res) => {
  try {
    const payload = req.body || {};
    const result = runHierarchicalOptimization(payload);
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Ошибка в /api/plan/optimize:', error);
    return res.status(400).json({
      success: false,
      error: error.message || 'Некорректный запрос в /api/plan/optimize'
    });
  }
});

router.post('/parse', async (req, res) => {
  try {
    const { url, limit } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса'
      });
    }

    console.log(
      `[${new Date().toISOString()}] Запуск parse-only для URL: ${url} (лимит постов: ${
        typeof limit === 'number' ? limit : 'all'
      })`
    );
    const numericLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    const result = await parseOnlyByUrl(url, numericLimit);

    return res.json(result);
  } catch (error) {
    console.error('Ошибка в /api/parse:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/parse',
      error_type: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/parse-and-enrich', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса'
      });
    }

    console.log(`[${new Date().toISOString()}] Запуск parse-and-enrich для URL: ${url}`);
    const result = await parseAndEnrichByUrl(url);
    const persistence =
      result.enriched_data !== null
        ? await persistPrecedents(result.enriched_data, { source: 'api_parse_and_enrich' })
        : null;

    console.log(
      `[${new Date().toISOString()}] parse-and-enrich завершен. Использовано токенов: ${
        result.usage?.total_tokens || 'N/A'
      }`
    );

    return res.json({
      ...result,
      persistence
    });
  } catch (error) {
    console.error('Ошибка в /api/parse-and-enrich:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/parse-and-enrich',
      error_type: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { competitors_data } = req.body;

    if (!competitors_data) {
      return res.status(400).json({
        error: 'Отсутствует поле competitors_data в теле запроса'
      });
    }

    if (!competitors_data.competitors || !Array.isArray(competitors_data.competitors)) {
      return res.status(400).json({
        error: 'Неверная структура данных: ожидается массив competitors'
      });
    }

    const config = getEnrichmentConfig();
    const requestGuardrails = summarizeEnrichmentLimits(competitors_data, config);
    console.log(
      `[${new Date().toISOString()}] Начало обогащения данных для ${requestGuardrails.competitors_count} конкурентов, ${requestGuardrails.posts_count} постов, payload=${requestGuardrails.payload_bytes} bytes`
    );

    if (requestGuardrails.payload_bytes > config.maxRequestBytes) {
      return res.status(413).json({
        success: false,
        error:
          'Входные данные слишком большие для одного запроса. Уменьшите объем данных или повысьте MAX_ENRICH_REQUEST_BYTES.',
        request_guardrails: requestGuardrails
      });
    }

    if (
      !config.autoBatch &&
      (requestGuardrails.posts_count > config.maxPostsPerBatch ||
        requestGuardrails.payload_bytes > config.maxPayloadBytes)
    ) {
      return res.status(413).json({
        success: false,
        error:
          'Запрос превышает лимиты enrichment, а автоматический batching отключен. Включите ENRICH_AUTO_BATCH или уменьшите объем данных.',
        request_guardrails: requestGuardrails
      });
    }

    const result = await enrichCompetitorsData(competitors_data);
    console.log(
      `[${new Date().toISOString()}] Обогащение завершено. Использовано токенов: ${result.usage?.total_tokens || 'N/A'}`
    );

    const persistence =
      result.enriched_data !== null
        ? await persistPrecedents(result.enriched_data, { source: 'api_enrich' })
        : null;

    if (result.parse_error) {
      console.warn('[ВНИМАНИЕ] JSON ответ от LLM невалидный, но данные возвращаются для проверки');
    }

    return res.json({
      success: result.enriched_data !== null,
      request_guardrails: requestGuardrails,
      persistence,
      ...result
    });
  } catch (error) {
    console.error('Ошибка при обогащении данных:', error);
    console.error('Stack trace:', error.stack);

    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера',
      error_type: error.name || 'UnknownError',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
