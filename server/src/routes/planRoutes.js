import { Router } from 'express';

import { generateDraftPlanBatched } from '../services/draftPlanGenerationPipeline.js';
import { runHierarchicalOptimization } from '../services/evolutionary/hierarchicalGa.js';
import { searchPrecedents } from '../repositories/precedentRepository.js';
import { buildRagQueryFromForm, normalizeDraftPlanResponse } from './shared/planUtils.js';
import { sendRouteError } from './shared/routeUtils.js';

const router = Router();
let currentWizardDraft = null

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
    platform: Array.isArray(form_input.platforms) ? form_input.platforms[0] : undefined,
    audience_segments: form_input.consumerCategory ? [form_input.consumerCategory] : []
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

router.post('/optimize', (req, res) => {
  try {
    const result = runHierarchicalOptimization(req.body || {});
    return res.json({
      success: true,
      ...result,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 400, 'Некорректный запрос в /api/plan/optimize', error);
  }
});

router.get('/draft/current', (req, res) => {
  return res.json({
    success: true,
    draft: currentWizardDraft,
    request_id: req.requestId
  })
})

router.put('/draft/current', (req, res) => {
  const payload = req.body || {}
  currentWizardDraft = {
    formData: payload.formData || null,
    updated_at: new Date().toISOString()
  }
  return res.json({
    success: true,
    draft: currentWizardDraft,
    request_id: req.requestId
  })
})

export default router;
