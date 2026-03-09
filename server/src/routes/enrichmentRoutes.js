import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { enrichCompetitorsData } from '../../openrouter.js';
import { callDeepSeekAPI } from '../../openrouter.js';
import { parseAndEnrichByUrl, parseOnlyByUrl } from '../services/parserPipeline.js';
import {
  getPrecedentsSnapshot,
  getPrecedentsSummary,
  persistPrecedents,
  searchPrecedents
} from '../repositories/precedentRepository.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'demoPrecedents.json');
const DRAFT_PLAN_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'articleDraftPlanPrompt.txt');

const router = Router();

function extractJsonFromLlmContent(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Пустой ответ от LLM');
  }

  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM не вернул JSON объект');
  }

  return JSON.parse(trimmed.slice(start, end + 1));
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
    const persistence = persistPrecedents(fixture, { source: 'demo_seed' });
    return res.json({
      success: true,
      message: 'Демо-база прецедентов загружена',
      persistence
    });
  } catch (error) {
    console.error('Ошибка в /api/precedents/seed:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/precedents/seed'
    });
  }
});

router.post('/precedents/search', (req, res) => {
  try {
    const { query, limit, platform, audience_segments } = req.body || {};

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле query в теле запроса'
      });
    }

    const results = searchPrecedents(query, {
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

    const ragResults = searchPrecedents(query, {
      limit: rag_limit || 8,
      platform: Array.isArray(form_input.platforms) ? form_input.platforms[0] : undefined,
      audience_segments: form_input.consumerCategory ? [form_input.consumerCategory] : []
    });

    const systemPrompt = fs.readFileSync(DRAFT_PLAN_PROMPT_PATH, 'utf-8');
    const userPrompt = `Сформируй черновой контент-план на основании требований проекта и найденных прецедентов.

Требования проекта:
${JSON.stringify(form_input, null, 2)}

RAG query:
${query}

Найденные публикации-прецеденты:
${JSON.stringify(ragResults.publications, null, 2)}

Найденные прецеденты контент-планов:
${JSON.stringify(ragResults.content_plans, null, 2)}
`;

    const llmResponse = await callDeepSeekAPI(systemPrompt, userPrompt, {
      temperature: 0.3,
      maxTokens: 100000,
      responseFormat: null
    });
    const parsed = extractJsonFromLlmContent(llmResponse.content || '');

    return res.json({
      success: true,
      rag: ragResults,
      draft: parsed,
      usage: llmResponse.usage || null
    });
  } catch (error) {
    console.error('Ошибка в /api/plan/generate:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/plan/generate'
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
        ? persistPrecedents(result.enriched_data, { source: 'api_parse_and_enrich' })
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

    const competitorsCount = competitors_data.competitors.length;
    const postsCount = competitors_data.competitors.reduce((sum, c) => sum + (c.posts?.length || 0), 0);
    console.log(`[${new Date().toISOString()}] Начало обогащения данных для ${competitorsCount} конкурентов, ${postsCount} постов`);

    const result = await enrichCompetitorsData(competitors_data);
    console.log(`[${new Date().toISOString()}] Обогащение завершено. Использовано токенов: ${result.usage?.total_tokens || 'N/A'}`);

    const persistence =
      result.enriched_data !== null
        ? persistPrecedents(result.enriched_data, { source: 'api_enrich' })
        : null;

    if (result.parse_error) {
      console.warn('[ВНИМАНИЕ] JSON ответ от LLM невалидный, но данные возвращаются для проверки');
    }

    return res.json({
      success: result.enriched_data !== null,
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
