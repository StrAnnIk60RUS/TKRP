import { Router } from 'express';

import { generateDraftPlanBatched } from '../services/draftPlanGenerationPipeline.js';
import { runHierarchicalOptimization } from '../services/evolutionary/hierarchicalGa.js';
import { searchPrecedents } from '../../precedents/repositories/precedentRepository.js';
import { buildRagQueryFromForm, normalizeDraftPlanResponse } from './shared/planUtils.js';
import { sendRouteError } from '../../../shared/http/routeUtils.js';
import { loadDraft, saveDraft } from '../services/draftStore.js';
import { loadSnapshot, saveSnapshot } from '../services/planSnapshotStore.js';

const router = Router();
let currentWizardDraft = null;

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

async function initDraftFromDisk() {
  if (currentWizardDraft) return;
  currentWizardDraft = await loadDraft();
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
  const ragResults = await searchPrecedents(query, {
    limit: ragLimit,
    platforms: Array.isArray(form_input.platforms) ? form_input.platforms : [],
    audience_segments: buildAudienceSegmentsFromForm(form_input)
  });

  const generated = await generateDraftPlanBatched({
    formInput: form_input,
    query,
    ragResults,
    ragLimit
  });

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
    const result = await runHierarchicalOptimization(req.body || {});
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
  await saveDraft(currentWizardDraft);
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

    const saved = await saveSnapshot(plan, optimization, payload.token || null);
    return res.json({
      success: true,
      snapshot: saved,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/snapshots', error);
  }
});

router.get('/snapshots/:token', async (req, res) => {
  try {
    const token = req.params?.token;
    const snapshot = await loadSnapshot(token);
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

export default router;


