import { Router } from 'express';

import {
  getMlModelMetadata,
  predictContentPlanLikes,
  predictPostLikesForPublications,
  predictEngagementRatesForGeneratedPublications,
  trainContentPlanLikesModel,
  trainPostLikesModel,
  trainRelevanceModel
} from '../services/relevancePredictionService.js';
import { reembedPrecedentsWithWrongDimension } from '../repositories/precedentRepository.js';
import { requireLocalOrAdminApiKey } from '../http/security.js';
import { sendRouteError } from './shared/routeUtils.js';

const router = Router();

router.post('/relevance/reembed-and-train', requireLocalOrAdminApiKey, async (req, res) => {
  try {
    const reembedResult = await reembedPrecedentsWithWrongDimension();
    const trainResult = await trainRelevanceModel();
    return res.json({
      success: true,
      reembed: reembedResult,
      models: trainResult?.models || null,
      metadata: trainResult?.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/relevance/reembed-and-train', error);
  }
});

router.post('/relevance/train', requireLocalOrAdminApiKey, async (req, res) => {
  try {
    const result = await trainRelevanceModel();
    return res.json({
      success: true,
      models: result?.models || null,
      metadata: result?.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/relevance/train', error);
  }
});

router.post('/relevance/predict', async (req, res) => {
  try {
    const { publications } = req.body || {};
    if (!Array.isArray(publications) || publications.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Некорректное поле publications: ожидается non-empty array',
        request_id: req.requestId
      });
    }

    const result = await predictEngagementRatesForGeneratedPublications(publications, { forceTrain: false });
    return res.json({
      success: true,
      avgEngagementRate: result.avgEngagementRate,
      updatedPublications: result.updatedPublications,
      predictedLikes: result.predictedLikes,
      totalPredictedLikes: result.totalPredictedLikes,
      modelMetadata: result.modelMetadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/relevance/predict', error);
  }
});

router.get('/models/metadata', (req, res) => {
  return res.json({
    success: true,
    metadata: getMlModelMetadata(),
    request_id: req.requestId
  });
});

router.post('/post/train', requireLocalOrAdminApiKey, async (req, res) => {
  try {
    const result = await trainPostLikesModel();
    return res.json({
      success: true,
      model: result?.model_path || undefined,
      metadata: result?.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/post/train', error);
  }
});

router.post('/content-plan/train', requireLocalOrAdminApiKey, async (req, res) => {
  try {
    const result = await trainContentPlanLikesModel();
    return res.json({
      success: true,
      model: result?.model_path || undefined,
      metadata: result?.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/content-plan/train', error);
  }
});

router.post('/post/predict', async (req, res) => {
  try {
    const { publications } = req.body || {};
    if (!Array.isArray(publications) || publications.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Некорректное поле publications: ожидается non-empty array',
        request_id: req.requestId
      });
    }

    const result = await predictPostLikesForPublications(publications, { forceTrain: false });
    return res.json({
      success: true,
      predictions: result.predictions,
      normalizedScores: result.normalizedScores,
      planFeatureMap: result.planFeatureMap,
      modelMetadata: result.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/post/predict', error);
  }
});

router.post('/content-plan/predict', async (req, res) => {
  try {
    const payload = req.body || {};
    const candidate = payload.draft_content_plan || payload.draftContentPlan || payload;
    const result = await predictContentPlanLikes(candidate, { forceTrain: false });
    return res.json({
      success: true,
      predictedLikes: result.predictedLikes,
      normalizedScore: result.normalizedScore,
      featureMap: result.featureMap,
      modelMetadata: result.metadata || null,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/content-plan/predict', error);
  }
});

export default router;
