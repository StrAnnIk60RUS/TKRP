/**
 * Long-lived Python JSON worker (stdin/stdout line protocol) with resilience:
 * - per-request timeout (requestTimeoutMs);
 * - retry with exponential backoff on failure (maxRetries, backoffBaseMs) —
 *   a failed request restarts the worker before the next attempt;
 * - circuit breaker: after breakerMaxConsecutiveFailures consecutive failures
 *   the worker refuses new requests for breakerCooldownMs (prevents hammering
 *   a broken Python process).
 *
 * Env overrides: PYWORKER_REQUEST_TIMEOUT_MS, PYWORKER_MAX_RETRIES,
 * PYWORKER_BACKOFF_BASE_MS, PYWORKER_BREAKER_MAX_FAILURES, PYWORKER_BREAKER_COOLDOWN_MS.
 */
import { spawn } from 'child_process';
import readline from 'readline';
import { logger } from '../logging/logger.js';
import { recordPythonWorkerExecution, recordPythonCircuitBreaker } from '../logging/metrics.js';
import { getTraceContext } from '../logging/requestContext.js';

const DEFAULT_PYTHON_BIN = process.env.PYTHON_BIN || 'python';

function toError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  return new Error(fallbackMessage || String(error));
}

function readPositiveIntEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPythonJsonWorker({
  scriptPath,
  args = [],
  cwd,
  env = {},
  description = 'python json worker',
  startupTimeoutMs = 10000,
  requestTimeoutMs = readPositiveIntEnv('PYWORKER_REQUEST_TIMEOUT_MS', 30000),
  maxRetries = readPositiveIntEnv('PYWORKER_MAX_RETRIES', 2),
  backoffBaseMs = readPositiveIntEnv('PYWORKER_BACKOFF_BASE_MS', 250),
  breakerMaxFailures = readPositiveIntEnv('PYWORKER_BREAKER_MAX_FAILURES', 3),
  breakerCooldownMs = readPositiveIntEnv('PYWORKER_BREAKER_COOLDOWN_MS', 30000),
  spawnArgs = ['-u', scriptPath, ...args]
}) {
  const workerLog = logger.child({ module: 'pythonWorker', worker: description });
  let child = null;
  let nextRequestId = 1;
  let running = false;
  const pending = new Map();
  let startupPromise = null;
  let startupResolve = null;
  let startupReject = null;

  let consecutiveFailures = 0;
  let breakerOpenedAt = 0;

  function syncRefState() {
    if (!child) return;
    if (pending.size > 0) {
      child.ref();
      child.stdout?.ref?.();
      child.stderr?.ref?.();
    } else {
      child.unref();
      child.stdout?.unref?.();
      child.stderr?.unref?.();
    }
  }

  function breakerOpen() {
    return (
      breakerMaxFailures > 0 &&
      consecutiveFailures >= breakerMaxFailures &&
      Date.now() - breakerOpenedAt < breakerCooldownMs
    );
  }

  function rejectAllPending(error) {
    for (const [, handlers] of pending) {
      handlers.reject(error);
    }
    pending.clear();
  }

  function stopWorker(error) {
    running = false;
    if (child) {
      child.removeAllListeners();
      if (!child.killed) child.kill('SIGTERM');
    }
    child = null;
    if (error) {
      workerLog.warn(`Stopping worker: ${error.message}`, { error: error.message });
      rejectAllPending(error);
    }
  }

  function ensureStarted() {
    if (running && child) return Promise.resolve();
    if (startupPromise) return startupPromise;

    startupPromise = new Promise((resolve, reject) => {
      startupResolve = resolve;
      startupReject = reject;
    });

    const pythonBin = process.env.PYTHON_BIN || DEFAULT_PYTHON_BIN;
    workerLog.info(`Starting Python worker process: ${description}`, { scriptPath, startupTimeoutMs });
    child = spawn(pythonBin, spawnArgs, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const timeout = setTimeout(() => {
      const error = new Error(`${description} startup timed out after ${startupTimeoutMs} ms`);
      workerLog.error(`Startup timeout: ${description}`, { startupTimeoutMs });
      if (startupReject) startupReject(error);
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(error);
    }, startupTimeoutMs);

    let stderrBuffer = '';
    const lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on('line', (line) => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        const malformed = new Error(`${description} produced invalid JSON line: ${line}`);
        workerLog.error(`Malformed JSON line from worker: ${description}`, { line: line.slice(0, 300) });
        stopWorker(malformed);
        return;
      }

      if (parsed?.type === 'ready') {
        running = true;
        clearTimeout(timeout);
        workerLog.info(`Python worker is ready: ${description}`, { pid: child?.pid });
        if (startupResolve) startupResolve();
        startupPromise = null;
        startupResolve = null;
        startupReject = null;
        syncRefState();
        return;
      }

      const requestId = parsed?.id;
      if (!requestId || !pending.has(requestId)) return;
      const handlers = pending.get(requestId);
      pending.delete(requestId);
      syncRefState();

      if (parsed?.success) {
        handlers.resolve(parsed.result);
      } else {
        handlers.reject(new Error(parsed?.error || `${description} request failed`));
      }
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      const startupError = toError(error, `${description} failed to start`);
      workerLog.error(`Worker error: ${description}`, { error: startupError.message });
      if (startupReject) startupReject(startupError);
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(startupError);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const details = stderrBuffer.trim();
      const closeError = new Error(
        `${description} exited (code=${code ?? 'unknown'})${details ? `: ${details}` : ''}`
      );
      workerLog.debug(`Worker process closed: ${description}`, { code, details: details.slice(0, 500) });
      if (!running && startupReject) {
        startupReject(closeError);
      }
      startupPromise = null;
      startupResolve = null;
      startupReject = null;
      stopWorker(closeError);
    });

    return startupPromise;
  }

  async function requestOnce(payload) {
    await ensureStarted();
    if (!child || !running) {
      throw new Error(`${description} is not running`);
    }

    const id = String(nextRequestId++);
    const envelope = { id, ...payload };
    const traceCtx = getTraceContext();
    const startTime = Date.now();

    workerLog.debug(`Dispatching request #${id} to worker`, {
      requestId: id,
      action: payload?.action,
      trace_id: traceCtx.traceId
    });

    const response = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      syncRefState();
      try {
        child.stdin.write(`${JSON.stringify(envelope)}\n`);
      } catch (error) {
        pending.delete(id);
        syncRefState();
        reject(toError(error, `${description} failed to write request`));
      }
    });

    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      const res = await response;
      try { recordPythonWorkerExecution(description, 'ok', (Date.now() - startTime) / 1000); } catch {}
      workerLog.debug(`Request #${id} finished in ${Date.now() - startTime}ms`, {
        requestId: id,
        duration_ms: Date.now() - startTime,
        trace_id: traceCtx.traceId
      });
      return res;
    }

    const timeoutError = new Error(`${description} request timed out after ${requestTimeoutMs} ms`);
    const timer = setTimeout(() => {
      const handlers = pending.get(id);
      if (handlers) {
        pending.delete(id);
        syncRefState();
        handlers.reject(timeoutError);
      }
      try { recordPythonWorkerExecution(description, 'timeout', (Date.now() - startTime) / 1000); } catch {}
      workerLog.warn(`Request #${id} timed out after ${requestTimeoutMs}ms, restarting worker`, {
        requestId: id,
        trace_id: traceCtx.traceId
      });
      // Stream state is unknown after a timeout — restart the worker.
      stopWorker(timeoutError);
    }, requestTimeoutMs);
    try {
      const res = await response;
      workerLog.debug(`Request #${id} finished in ${Date.now() - startTime}ms`, {
        requestId: id,
        duration_ms: Date.now() - startTime,
        trace_id: traceCtx.traceId
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestWithRetry(payload) {
    const traceCtx = getTraceContext();
    if (breakerOpen()) {
      workerLog.warn(`Circuit breaker is OPEN for ${description}, rejecting request`, {
        consecutiveFailures,
        breakerCooldownMs,
        trace_id: traceCtx.traceId
      });
      throw new Error(
        `${description} circuit breaker is open (${consecutiveFailures} consecutive failures; retry in ${breakerCooldownMs} ms)`
      );
    }

    const attempts = (Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.floor(maxRetries) : 0) + 1;
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await requestOnce(payload);
        if (consecutiveFailures > 0) {
          workerLog.info(`Circuit breaker reset for ${description} after successful request`);
        }
        consecutiveFailures = 0;
        return result;
      } catch (error) {
        lastError = toError(error, `${description} request failed`);
        consecutiveFailures += 1;
        workerLog.warn(`Request attempt ${attempt + 1}/${attempts} failed: ${lastError.message}`, {
          attempt: attempt + 1,
          maxRetries,
          consecutiveFailures,
          trace_id: traceCtx.traceId
        });
        if (consecutiveFailures >= breakerMaxFailures && breakerMaxFailures > 0) {
          breakerOpenedAt = Date.now();
          try { recordPythonCircuitBreaker(description); } catch {}
          workerLog.error(`Circuit breaker OPENED for ${description} after ${consecutiveFailures} failures`, {
            breakerCooldownMs,
            trace_id: traceCtx.traceId
          });
        }
        if (breakerOpen()) break;
        if (attempt < attempts - 1) {
          const delayMs = backoffBaseMs * 2 ** attempt;
          if (delayMs > 0) await sleep(delayMs);
        }
      }
    }
    throw lastError;
  }

  function dispose() {
    workerLog.info(`Disposing Python worker: ${description}`);
    stopWorker();
  }

  return {
    request: requestWithRetry,
    dispose
  };
}
