import { Router } from 'express';

import {
  predictEngagementRatesForGeneratedPublications,
  trainRelevanceModel
} from '../services/relevancePredictionService.js';
import { requireLocalOrAdminApiKey } from '../http/security.js';
import { sendRouteError } from './shared/routeUtils.js';

const router = Router();

router.post('/relevance/train', requireLocalOrAdminApiKey, async (req, res) => {
  try {
    const result = await trainRelevanceModel();
    return res.json({
      success: true,
      model: result?.model_path || undefined,
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
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Internal error in /api/ml/relevance/predict', error);
  }
});

export default router;
