import { Router } from 'express';

import { generateDraftPlanBatched } from '../services/draftPlanGenerationPipeline.js';
import { runHierarchicalOptimization } from '../services/evolutionary/hierarchicalGa.js';
import { searchPrecedents } from '../../precedents/repositories/precedentRepository.js';
import { buildRagQueryFromForm, mergePinnedPublications, normalizeDraftPlanResponse } from './shared/planUtils.js';
import { sendRouteError } from '../../../shared/http/routeUtils.js';
import { loadDraft, saveDraft } from '../services/draftStore.js';
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from '../services/planSnapshotStore.js';
import { resolveSession } from '../../auth/services/authStore.js';
import { requireSessionOrAdminApiKey } from '../../auth/services/sessionGate.js';
import { rejectInstagramIfForbidden } from '../../auth/services/instagramAccess.js';
import { enqueueJob, getJobStatus, listJobs, getJobQueueStats, jobEvents } from '../../../shared/runtime/jobQueue.js';
import {
  generatePublicationMedia,
  mediaKindForFormat,
  resolveStoredMediaPath
} from '../services/mediaGenerationService.js';
import { existsSync } from 'fs';

const router = Router();
const wizardDraftsByUser = new Map();

router.use(rejectInstagramIfForbidden);

function readBearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function resolveUserId(req) {
  const token = readBearerToken(req);
  if (!token) return null;
  return await resolveSession(token);
}

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

async function initDraftFromDisk(userId) {
  const key = userId ?? '__anonymous__';
  if (wizardDraftsByUser.has(key)) return;
  wizardDraftsByUser.set(key, await loadDraft(userId));
}

async function handleGeneratePlan(req, res, routeName) {
  const { form_input, rag_query, rag_limit, pinned_publications } = req.body || {};
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
  const searched = await searchPrecedents(query, {
    limit: ragLimit,
    platforms: Array.isArray(form_input.platforms) ? form_input.platforms : [],
    audience_segments: buildAudienceSegmentsFromForm(form_input)
  });
  const ragResults = mergePinnedPublications(searched, pinned_publications, ragLimit);

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

router.post('/generate', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    return await handleGeneratePlan(req, res, 'generate');
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/generate', error);
  }
});

router.post('/generate-batched', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    return await handleGeneratePlan(req, res, 'generate-batched');
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/generate-batched', error);
  }
});

router.post('/optimize', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    const { form_input, ragResults, ...rest } = req.body || {};
    const payload = {
      ...rest,
      form_input,
      ragResults
    };
    const result = await runHierarchicalOptimization(payload);
    return res.json({
      success: true,
      ...result,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 400, 'Некорректный запрос в /api/plan/optimize', error);
  }
});

// Async (job-queue) variants: POST returns 202 + job_id; poll GET /api/plan/jobs/:id.
// POST /api/plan/optimize stays synchronous for backward compatibility (frontend depends on it).
router.post('/optimize:async', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    const payload = req.body || {};
    const userId = await resolveUserId(req);
    const jobId = enqueueJob(
      'plan_optimize',
      (body, onProgress) => runHierarchicalOptimization({ ...body, onProgress }),
      payload,
      { userId }
    );
    return res.status(202).json({
      success: true,
      job_id: jobId,
      status: 'queued',
      status_url: `/api/plan/jobs/${jobId}`,
      stream_url: `/api/plan/jobs/${jobId}/events`,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Некорректный запрос в /api/plan/optimize:async', error);
  }
});

router.post('/media', requireSessionOrAdminApiKey, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const format = req.body?.format;
  const platform = req.body?.platform;
  if (!mediaKindForFormat(format)) {
    return res.status(400).json({
      success: false,
      error: 'Медиа генерируется для форматов image, video и combined',
      request_id: req.requestId
    });
  }
  if (!prompt) {
    return res.status(400).json({
      success: false,
      error: 'Промпт для генерации пуст',
      request_id: req.requestId
    });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({
      success: false,
      error: 'OPENROUTER_API_KEY не задан',
      request_id: req.requestId
    });
  }
  try {
    const userId = await resolveUserId(req);
    const jobId = enqueueJob(
      'media_generate',
      (body) => generatePublicationMedia(body),
      { prompt, format, platform },
      { userId }
    );
    return res.status(202).json({
      success: true,
      job_id: jobId,
      status: 'queued',
      status_url: `/api/plan/jobs/${jobId}`,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Не удалось поставить генерацию медиа в очередь', error);
  }
});

router.get('/media/files/:fileName', requireSessionOrAdminApiKey, (req, res) => {
  const filePath = resolveStoredMediaPath(req.params?.fileName);
  if (!filePath || !existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'Файл медиа не найден',
      request_id: req.requestId
    });
  }
  return res.sendFile(filePath);
});

router.get('/jobs/:jobId', requireSessionOrAdminApiKey, async (req, res) => {
  const job = getJobStatus(req.params?.jobId);
  const userId = await resolveUserId(req);
  if (!job || (job.userId && userId && job.userId !== userId)) {
    return res.status(404).json({
      success: false,
      error: 'Job не найден или уже expiring (TTL cleanup)',
      request_id: req.requestId
    });
  }
  return res.json({
    success: true,
    job,
    request_id: req.requestId
  });
});

router.get(['/jobs/:jobId/events', '/jobs/:jobId/stream'], requireSessionOrAdminApiKey, async (req, res) => {
  const jobId = req.params?.jobId;
  const job = getJobStatus(jobId);
  const userId = await resolveUserId(req);

  if (!job || (job.userId && userId && job.userId !== userId)) {
    return res.status(404).json({
      success: false,
      error: 'Job не найден или уже expiring',
      request_id: req.requestId
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');

  if (job.status === 'completed') {
    res.write(`event: completed\ndata: ${JSON.stringify({ status: 'completed', result: job.result })}\n\n`);
    res.end();
    return;
  }
  if (job.status === 'failed') {
    res.write(`event: failed\ndata: ${JSON.stringify({ status: 'failed', error: job.error })}\n\n`);
    res.end();
    return;
  }

  res.write(`event: status\ndata: ${JSON.stringify({ status: job.status, progress: job.progress || null })}\n\n`);

  const onProgress = (progress) => {
    try {
      if (!res.writableEnded) {
        res.write(`event: progress\ndata: ${JSON.stringify({ status: 'running', progress })}\n\n`);
      }
    } catch (_err) {
      cleanup();
    }
  };

  const onCompleted = (data) => {
    try {
      if (!res.writableEnded) {
        res.write(`event: completed\ndata: ${JSON.stringify({ status: 'completed', result: data?.result })}\n\n`);
      }
    } catch (_err) {
      // ignore
    } finally {
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    }
  };

  const onFailed = (data) => {
    try {
      if (!res.writableEnded) {
        res.write(`event: failed\ndata: ${JSON.stringify({ status: 'failed', error: data?.error })}\n\n`);
      }
    } catch (_err) {
      // ignore
    } finally {
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    }
  };

  const cleanup = () => {
    jobEvents.off(`progress:${jobId}`, onProgress);
    jobEvents.off(`completed:${jobId}`, onCompleted);
    jobEvents.off(`failed:${jobId}`, onFailed);
  };

  jobEvents.on(`progress:${jobId}`, onProgress);
  jobEvents.on(`completed:${jobId}`, onCompleted);
  jobEvents.on(`failed:${jobId}`, onFailed);

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

router.get('/jobs', requireSessionOrAdminApiKey, async (req, res) => {
  const limit = Number(req.query?.limit);
  return res.json({
    success: true,
    jobs: listJobs(Number.isFinite(limit) && limit > 0 ? limit : 50, await resolveUserId(req)),
    stats: getJobQueueStats(),
    request_id: req.requestId
  });
});

router.get('/draft/current', requireSessionOrAdminApiKey, async (req, res) => {
  const userId = await resolveUserId(req);
  await initDraftFromDisk(userId);
  const key = userId ?? '__anonymous__';
  return res.json({
    success: true,
    draft: wizardDraftsByUser.get(key),
    request_id: req.requestId
  });
});

router.put('/draft/current', requireSessionOrAdminApiKey, async (req, res) => {
  const userId = await resolveUserId(req);
  const payload = req.body || {};
  const draft = {
    formData: payload.formData || null,
    updated_at: new Date().toISOString()
  };
  wizardDraftsByUser.set(userId ?? '__anonymous__', draft);
  await saveDraft(draft, userId);
  return res.json({
    success: true,
    draft,
    request_id: req.requestId
  });
});

router.get('/snapshots', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    const userId = await resolveUserId(req);
    const limit = Number(req.query?.limit) || 50;
    const snapshots = await listSnapshots(limit, userId);
    return res.json({
      success: true,
      snapshots,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в GET /api/plan/snapshots', error);
  }
});

router.post('/snapshots', requireSessionOrAdminApiKey, async (req, res) => {
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

    const userId = await resolveUserId(req);
    const requestedToken = payload.token || null;
    if (requestedToken) {
      const existing = await loadSnapshot(requestedToken);
      if (existing && existing.owner !== userId) {
        return res.status(404).json({
          success: false,
          error: 'Snapshot не найден',
          request_id: req.requestId
        });
      }
    }
    const saved = await saveSnapshot(plan, optimization, requestedToken, userId);
    return res.json({
      success: true,
      snapshot: saved,
      request_id: req.requestId
    });
  } catch (error) {
    return sendRouteError(res, req, 500, 'Внутренняя ошибка сервера в /api/plan/snapshots', error);
  }
});

router.get('/snapshots/:token', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    const token = req.params?.token;
    if (typeof token === 'string' && token.startsWith('local_')) {
      return res.status(404).json({
        success: false,
        error: 'Локальный снимок плана сохраняется только в браузере клиента',
        is_local: true,
        request_id: req.requestId
      });
    }
    const userId = await resolveUserId(req);
    const snapshot = await loadSnapshot(token);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot не найден',
        request_id: req.requestId
      });
    }
    if (snapshot.owner !== userId) {
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

router.delete('/snapshots/:token', requireSessionOrAdminApiKey, async (req, res) => {
  try {
    const token = req.params?.token;
    if (typeof token === 'string' && token.startsWith('local_')) {
      return res.status(404).json({
        success: false,
        error: 'Локальный снимок плана сохраняется только в браузере клиента',
        is_local: true,
        request_id: req.requestId
      });
    }
    const userId = await resolveUserId(req);
    const snapshot = await loadSnapshot(token);
    if (snapshot && snapshot.owner !== userId) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot не найден',
        request_id: req.requestId
      });
    }
    const result = await deleteSnapshot(token);
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

export default router;


