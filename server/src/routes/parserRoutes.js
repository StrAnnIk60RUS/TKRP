import { Router } from 'express';

import { enrichCompetitorsData } from '../../openrouter.js';
import {
  getEnrichmentConfig,
  summarizeEnrichmentLimits
} from '../services/semanticEnrichmentPipeline.js';
import { parseAndEnrichByUrl, parseOnlyByUrl } from '../services/parserPipeline.js';
import { persistPrecedents } from '../repositories/precedentRepository.js';
import { sendRouteError } from './shared/routeUtils.js';

const router = Router();

router.post('/parse', async (req, res) => {
  try {
    const { url, limit } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса',
        request_id: req.requestId
      });
    }

    const numericLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    const result = await parseOnlyByUrl(url, numericLimit);
    return res.json({
      ...result,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/parse', error);
  }
});

router.post('/parse-and-enrich', async (req, res) => {
  try {
    const { url, limit } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса',
        request_id: req.requestId
      });
    }

    const numericLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    const result = await parseAndEnrichByUrl(url, numericLimit);
    const persistence =
      result.enriched_data !== null
        ? await persistPrecedents(result.enriched_data, { source: 'api_parse_and_enrich' })
        : null;

    return res.json({
      ...result,
      persistence,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/parse-and-enrich', error);
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { competitors_data } = req.body || {};
    if (!competitors_data) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует поле competitors_data в теле запроса',
        request_id: req.requestId
      });
    }

    if (!Array.isArray(competitors_data.competitors)) {
      return res.status(400).json({
        success: false,
        error: 'Неверная структура данных: ожидается массив competitors',
        request_id: req.requestId
      });
    }

    const config = getEnrichmentConfig();
    const requestGuardrails = summarizeEnrichmentLimits(competitors_data, config);
    if (requestGuardrails.max_batch_payload_bytes > config.maxRequestBytes) {
      return res.status(413).json({
        success: false,
        error:
          'Входные данные слишком большие для одного запроса. Уменьшите объем данных или повысьте MAX_ENRICH_REQUEST_BYTES.',
        request_guardrails: requestGuardrails,
        request_id: req.requestId
      });
    }

    if (!config.autoBatch && requestGuardrails.batches_count > 1) {
      return res.status(413).json({
        success: false,
        error:
          'Запрос превышает лимиты enrichment, а автоматический batching отключен. Включите ENRICH_AUTO_BATCH или уменьшите объем данных.',
        request_guardrails: requestGuardrails,
        request_id: req.requestId
      });
    }

    const result = await enrichCompetitorsData(competitors_data);
    const persistence =
      result.enriched_data !== null
        ? await persistPrecedents(result.enriched_data, { source: 'api_enrich' })
        : null;

    return res.json({
      success: result.enriched_data !== null,
      request_guardrails: requestGuardrails,
      persistence,
      ...result,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/enrich', error);
  }
});

export default router;
