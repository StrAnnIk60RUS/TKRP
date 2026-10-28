/**
 * In-process async job queue for long-running endpoints (GA, LLM).
 * Dependency-free: no BullMQ/Redis. Endpoints enqueue a job, return a job_id,
 * and clients poll GET /api/plan/jobs/:id.
 *
 * Env:
 * - JOB_QUEUE_MAX_CONCURRENCY (default 1; GA/LLM work is CPU/LLM-bound)
 * - JOB_RESULT_TTL_MS (default 3600000 — how long finished results are retained)
 * - JOB_QUEUE_MAX_RETAINED (default 200 — finished jobs kept in memory)
 */
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../logging/logger.js';
import { recordJobExecution, jobQueueActiveJobs, jobQueueQueuedJobs } from '../logging/metrics.js';
import { getTraceContext, runWithContext } from '../logging/requestContext.js';

export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(200);

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_RESULT_TTL_MS = 3600000;
const DEFAULT_MAX_RETAINED = 200;

const jobs = new Map();
const readyQueue = [];
let runningCount = 0;
let completedTotal = 0;
let failedTotal = 0;
let jobSeq = 0;

function readPositiveInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function nowMs() {
  return Date.now();
}

function jobStatusById(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    job_id: job.job_id,
    trace_id: job.traceId || null,
    kind: job.kind,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    error: job.error,
    error_stack: job.error_stack || null,
    result: job.result,
    progress: job.progress || null,
    userId: job.userId || null
  };
}

export function updateJobProgress(jobId, progressData) {
  const job = jobs.get(jobId);
  if (!job) return;
  const progressPayload =
    typeof progressData === 'object' && progressData !== null
      ? progressData
      : { message: String(progressData) };
  job.progress = {
    ...(job.progress || {}),
    ...progressPayload,
    updated_at: nowMs().toString()
  };

  logger.debug(`Job [${job.kind}] progress: ${progressPayload.phase || progressPayload.message || 'update'}`, {
    module: 'jobQueue',
    job_id: jobId,
    kind: job.kind,
    trace_id: job.traceId,
    progress: progressPayload
  });

  jobEvents.emit(`progress:${jobId}`, job.progress);
}

function sweepExpiredAndTrim() {
  const ttlMs = readPositiveInt('JOB_RESULT_TTL_MS', DEFAULT_RESULT_TTL_MS);
  const maxRetained = readPositiveInt('JOB_QUEUE_MAX_RETAINED', DEFAULT_MAX_RETAINED);
  const finished = [];
  for (const job of jobs.values()) {
    if (job.status === 'completed' || job.status === 'failed') {
      finished.push(job);
    }
  }
  finished.sort((left, right) => Number(right.finished_at || 0) - Number(left.finished_at || 0));
  for (let index = 0; index < finished.length; index += 1) {
    const job = finished[index];
    const expired = job.finished_at && nowMs() - job.finished_at > ttlMs;
    if (expired || index >= maxRetained) {
      logger.debug(`Swept job from memory: [${job.kind}] (id: ${job.job_id})`, {
        module: 'jobQueue',
        job_id: job.job_id,
        kind: job.kind,
        reason: expired ? 'ttl_expired' : 'max_retained_exceeded'
      });
      jobs.delete(job.job_id);
    }
  }
}

function pumpQueue() {
  const maxConcurrency = readPositiveInt('JOB_QUEUE_MAX_CONCURRENCY', DEFAULT_CONCURRENCY);
  while (runningCount < maxConcurrency && readyQueue.length > 0) {
    const job = readyQueue.shift();
    runningCount += 1;
    try { jobQueueActiveJobs.set({}, runningCount); jobQueueQueuedJobs.set({}, readyQueue.length); } catch {}
    job.status = 'running';
    job.started_at = nowMs().toString();
    jobEvents.emit(`status:${job.job_id}`, { status: 'running' });

    const runFn = job.runFn;
    const payload = job.payload;
    const progressReporter = (prog) => {
      updateJobProgress(job.job_id, prog);
    };

    const jobContext = {
      traceId: job.traceId,
      jobId: job.job_id,
      userId: job.userId
    };

    runWithContext(jobContext, async () => {
      const jobLog = logger.child({ module: 'jobQueue', job_id: job.job_id, kind: job.kind });
      jobLog.info(`Async job started: [${job.kind}]`);
      const startTime = Date.now();

      try {
        const result = await runFn(payload, progressReporter);
        job.status = 'completed';
        job.result = result;
        completedTotal += 1;
        const durationMs = Date.now() - startTime;
        try { recordJobExecution(job.kind, 'completed', durationMs / 1000); } catch {}
        jobLog.info(`Async job completed: [${job.kind}] in ${durationMs}ms`, { duration_ms: durationMs });
        jobEvents.emit(`completed:${job.job_id}`, { result });
      } catch (error) {
        job.status = 'failed';
        job.error = error?.message || String(error);
        job.error_stack = error?.stack || null;
        failedTotal += 1;
        const durationMs = Date.now() - startTime;
        try { recordJobExecution(job.kind, 'failed', durationMs / 1000); } catch {}
        jobLog.error(`Async job failed: [${job.kind}] in ${durationMs}ms: ${job.error}`, {
          duration_ms: durationMs,
          error
        });
        jobEvents.emit(`failed:${job.job_id}`, { error: job.error });
      } finally {
        job.finished_at = nowMs().toString();
        runningCount -= 1;
        sweepExpiredAndTrim();
        pumpQueue();
      }
    });
  }
}

export function enqueueJob(kind, runFn, payload = null, options = {}) {
  const activeTrace = getTraceContext();
  const traceId = options.traceId || activeTrace.traceId || activeTrace.requestId || crypto.randomUUID();

  const job = {
    job_id: crypto.randomUUID().replace(/-/g, ''),
    seq: ++jobSeq,
    traceId,
    kind,
    status: 'queued',
    created_at: nowMs().toString(),
    started_at: null,
    finished_at: null,
    error: null,
    error_stack: null,
    result: null,
    progress: null,
    runFn,
    payload,
    userId: options.userId || activeTrace.userId || null
  };
  jobs.set(job.job_id, job);
  readyQueue.push(job);

  logger.info(`Job enqueued: [${kind}] (id: ${job.job_id})`, {
    module: 'jobQueue',
    job_id: job.job_id,
    kind,
    trace_id: traceId,
    pending_count: readyQueue.length
  });

  pumpQueue();
  return job.job_id;
}

export function getJobStatus(jobId) {
  return jobStatusById(jobId);
}

export function listJobs(limit = 50, filterUserId = null) {
  const max = Math.max(0, Math.floor(Number(limit)));
  if (max === 0) return [];
  const entries = Array.from(jobs.values()).filter(j => !filterUserId || !j.userId || j.userId === filterUserId)
    .sort((left, right) => {
      const byCreated = String(right.created_at || '').localeCompare(String(left.created_at || ''));
      if (byCreated !== 0) return byCreated;
      return Number(right.seq || 0) - Number(left.seq || 0);
    })
    .map((job) => jobStatusById(job.job_id))
    .filter(Boolean)
    .slice(0, max);
  return entries;
}

export function getJobQueueStats() {
  let queued = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const job of jobs.values()) {
    if (job.status === 'queued') queued += 1;
    else if (job.status === 'running') running += 1;
    else if (job.status === 'completed') completed += 1;
    else if (job.status === 'failed') failed += 1;
  }
  return {
    queued,
    running,
    retained_completed: completed,
    retained_failed: failed,
    completed_total: completedTotal,
    failed_total: failedTotal,
    max_concurrency: readPositiveInt('JOB_QUEUE_MAX_CONCURRENCY', DEFAULT_CONCURRENCY)
  };
}
