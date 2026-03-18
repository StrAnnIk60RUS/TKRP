import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { fileURLToPath } from 'url';

import {
  getPrecedentsSnapshot,
  getPrecedentsSummary,
  persistPrecedents,
  searchPrecedents
} from '../repositories/precedentRepository.js';
import { requireLocalOrAdminApiKey } from '../http/security.js';
import { sendRouteError } from './shared/routeUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'demoPrecedents.json');

const router = Router();

router.get('/summary', (req, res) => {
  try {
    return res.json({
      success: true,
      summary: getPrecedentsSummary(),
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/summary', error);
  }
});

router.get('/', (req, res) => {
  try {
    return res.json({
      success: true,
      data: getPrecedentsSnapshot(),
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents', error);
  }
});

router.post('/seed', requireLocalOrAdminApiKey, (req, res) => {
  try {
    if (!fs.existsSync(DEMO_FIXTURE_PATH)) {
      return res.status(404).json({
        success: false,
        error: 'Демо-фикстура не найдена',
        request_id: req.requestId
      });
    }

    const raw = fs.readFileSync(DEMO_FIXTURE_PATH, 'utf-8');
    const fixture = JSON.parse(raw);
    if (!Array.isArray(fixture.competitors)) {
      return res.status(400).json({
        success: false,
        error: 'Неверный формат фикстуры: ожидается массив competitors',
        request_id: req.requestId
      });
    }

    persistPrecedents(fixture, { source: 'demo_seed' })
      .then((persistence) =>
        res.json({
          success: true,
          message: 'Демо-база прецедентов загружена',
          persistence,
          request_id: req.requestId
        })
      )
      .catch((error) =>
        sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/seed', error)
      );
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/seed', error);
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query, limit, platform, audience_segments } = req.body || {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле query в теле запроса',
        request_id: req.requestId
      });
    }

    const results = await searchPrecedents(query, {
      limit,
      platform,
      audience_segments
    });

    return res.json({
      success: true,
      results,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/search', error);
  }
});

export default router;
