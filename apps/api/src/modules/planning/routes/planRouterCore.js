import { Router } from 'express';

import { buildRagQueryFromForm, normalizeDraftPlanResponse } from './shared/planUtils.js';
import { sendRouteError } from '../../../shared/http/routeUtils.js';
import { logPlanStructured, timePlanPhase } from './planRouteLog.js';

function buildAudienceSegmentsFromForm(formInput = {}) {
  return Array.from(
    new Set(
      [
        formInput.consumerCategory,
        ...String(formInput.consumerDemographics || '')
          .split(/[,\n;]/)
          .map((item) => item.trim()),
        ...String(formInput.consumerPurchaseGoal || '')
          .split(/[,\n;]/)
          .map((item) => item.trim())
      ].filter(Boolean)
    )
  ).slice(0, 8);
}

export function createPlanRouter(deps) {
  const router = Router();
  let currentWizardDraft = null;

  async function initDraftFromDisk() {
    if (currentWizardDraft) return;
    currentWizardDraft = await deps.loadDraft();
  }

  async function handleGeneratePlan(req, res, routeName) {
    const { form_input, rag_query, rag_limit } = req.body || {};
    if (!form_input || typeof form_input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле form_input',
        request_id: req.requestId
      });
    }

    const query =
      typeof rag_query === 'string' && rag_query.trim() ? rag_query.trim() : buildRagQueryFromForm(form_input);
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Не удалось сформировать rag_query из form_input',
        request_id: req.requestId
      });
    }

    const ragLimit = rag_limit || 8;
    const ragResults = await timePlanPhase(req, 'rag_search', () =>
      deps.searchPrecedents(query, {
        limit: ragLimit,
        platforms: Array.isArray(form_input.platforms) ? form_input.platforms : [],
        audience_segments: buildAudienceSegmentsFromForm(form_input)
      })
    );

    const generated = await timePlanPhase(req, 'draft_generation', () =>
      deps.generateDraftPlanBatched({
        formInput: form_input,
        query,
        ragResults,
        ragLimit
      })
    );

    return res.json({
      success: true,
      rag: ragResults,
      draft: normalizeDraftPlanResponse(generated.draft, form_input),
      usage: generated.usage || null,
      generation_metadata: {
        ...(generated.generation_metadata || {}),
        route: routeName
      },
      request_id: req.requestId
    });
  }

  router.post('/generate', async (req, res) => {
    try {
      return await handleGeneratePlan(req, res, 'generate');
    } catch (error) {
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/generate', error);
    }
  });

  router.post('/generate-batched', async (req, res) => {
    try {
      return await handleGeneratePlan(req, res, 'generate-batched');
    } catch (error) {
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/generate-batched', error);
    }
  });

  router.post('/optimize', async (req, res) => {
    try {
      const result = await timePlanPhase(req, 'hierarchical_ga', () =>
        deps.runHierarchicalOptimization(req.body || {})
      );
      logPlanStructured(req, { event: 'plan_optimize_done', stage1_generations: result?.stage1?.ga?.generations });
      return res.json({
        success: true,
        ...result,
        request_id: req.requestId
      });
    } catch (error) {
      return sendRouteError(res, req, 400, 'Некорректный запрос в /api/plan/optimize', error);
    }
  });

  router.get('/draft/current', async (req, res) => {
    await initDraftFromDisk();
    return res.json({
      success: true,
      draft: currentWizardDraft,
      request_id: req.requestId
    });
  });

  router.put('/draft/current', async (req, res) => {
    const payload = req.body || {};
    currentWizardDraft = {
      formData: payload.formData || null,
      updated_at: new Date().toISOString()
    };
    await deps.saveDraft(currentWizardDraft);
    return res.json({
      success: true,
      draft: currentWizardDraft,
      request_id: req.requestId
    });
  });

  router.post('/snapshots', async (req, res) => {
    try {
      const payload = req.body || {};
      const plan = payload.plan;
      const optimization = payload.optimization || null;
      if (!plan || typeof plan !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Отсутствует или некорректное поле plan в теле запроса',
          request_id: req.requestId
        });
      }

      const saved = await timePlanPhase(req, 'snapshot_save', () =>
        deps.saveSnapshot(plan, optimization, payload.token || null)
      );
      return res.json({
        success: true,
        snapshot: saved,
        request_id: req.requestId
      });
    } catch (error) {
      if (error?.code === 'PLAN_SNAPSHOT_TOO_LARGE') {
        return res.status(413).json({
          success: false,
          error: error.message || 'Снимок плана слишком большой',
          request_id: req.requestId
        });
      }
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/snapshots', error);
    }
  });

  router.get('/snapshots', async (req, res) => {
    try {
      const snapshots = await timePlanPhase(req, 'snapshot_list', () => deps.listSnapshots());
      return res.json({
        success: true,
        snapshots,
        request_id: req.requestId
      });
    } catch (error) {
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в GET /api/plan/snapshots', error);
    }
  });

  router.get('/snapshots/:token', async (req, res) => {
    try {
      const token = req.params?.token;
      const snapshot = await deps.loadSnapshot(token);
      if (!snapshot) {
        return res.status(404).json({
          success: false,
          error: 'Snapshot не найден',
          request_id: req.requestId
        });
      }
      return res.json({
        success: true,
        snapshot,
        request_id: req.requestId
      });
    } catch (error) {
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/snapshots/:token', error);
    }
  });

  router.delete('/snapshots/:token', async (req, res) => {
    try {
      const token = req.params?.token;
      const result = await deps.deleteSnapshot(token);
      if (!result.ok && result.reason === 'invalid_token') {
        return res.status(400).json({
          success: false,
          error: 'Некорректный токен snapshot',
          request_id: req.requestId
        });
      }
      return res.json({
        success: true,
        request_id: req.requestId
      });
    } catch (error) {
      return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера при удалении snapshot', error);
    }
  });

  return router;
}
