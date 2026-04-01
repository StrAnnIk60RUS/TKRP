import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

import {
  getAggregatedOntology,
  getPrecedentsSnapshot,
  getPrecedentsSummary,
  getOntologyExportData,
  getOntologyTurtleData,
  persistPrecedents,
  searchPrecedents
} from '../repositories/precedentRepository.js';
import { requireLocalOrAdminApiKey } from '../../../shared/http/security.js';
import { sendRouteError } from '../../../shared/http/routeUtils.js';

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

router.get('/ontology', (req, res) => {
  try {
    return res.json({
      success: true,
      ontology: getAggregatedOntology(),
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/ontology', error);
  }
});

router.get('/ontology/export', (req, res) => {
  try {
    const {
      metaRows,
      classesRows,
      entitiesRows,
      relationsRows,
      entityClassRows,
      templatesRows,
      hierarchyRows,
      synonymsRows,
      metaEntitiesRows
    } = getOntologyExportData();

    const wb = XLSX.utils.book_new();

    const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Сводка');

    const wsClasses = XLSX.utils.aoa_to_sheet(classesRows);
    XLSX.utils.book_append_sheet(wb, wsClasses, 'Классы');

    const wsEntities = XLSX.utils.aoa_to_sheet(entitiesRows);
    XLSX.utils.book_append_sheet(wb, wsEntities, 'Сущности');

    const wsRelations = XLSX.utils.aoa_to_sheet(relationsRows);
    XLSX.utils.book_append_sheet(wb, wsRelations, 'Отношения');

    const wsEntityClasses = XLSX.utils.aoa_to_sheet(entityClassRows);
    XLSX.utils.book_append_sheet(wb, wsEntityClasses, 'EntityClassLinks');

    const wsTemplates = XLSX.utils.aoa_to_sheet(templatesRows);
    XLSX.utils.book_append_sheet(wb, wsTemplates, 'RelationTemplates');

    const wsHierarchy = XLSX.utils.aoa_to_sheet(hierarchyRows);
    XLSX.utils.book_append_sheet(wb, wsHierarchy, 'Hierarchy');

    const wsSynonyms = XLSX.utils.aoa_to_sheet(synonymsRows);
    XLSX.utils.book_append_sheet(wb, wsSynonyms, 'Synonyms');

    const wsMetaEntities = XLSX.utils.aoa_to_sheet(metaEntitiesRows);
    XLSX.utils.book_append_sheet(wb, wsMetaEntities, 'MetaEntities');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `ontology_${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/precedents/ontology/export', error);
  }
});

router.get('/ontology/export/turtle', (req, res) => {
  try {
    const turtle = getOntologyTurtleData();
    const filename = `ontology_${new Date().toISOString().slice(0, 10)}.ttl`;

    res.setHeader('Content-Type', 'text/turtle; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(turtle);
  } catch (error) {
    return sendRouteError(
      res,
      req,
      500,
      'Внутренняя ошибка сервера в /api/precedents/ontology/export/turtle',
      error
    );
  }
});

export default router;


