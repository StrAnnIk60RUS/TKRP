/**
 * Standardized pipeline error handling: uniform stage logging, bounded retries
 * with exponential backoff for retryable failures, and optional fallback values.
 *
 * All pipeline stages should route their fallible steps through `runPipelineStage`
 * so error surfaces and logs look identical across enrichment, draft generation,
 * and diversity passes.
 *
 * Env configuration (all optional):
 * - PIPELINE_ERROR_RETRY_ATTEMPTS — default retry count for retryable errors (default: 1).
 * - PIPELINE_ERROR_RETRY_BASE_DELAY_MS — first backoff delay (default: 2000).
 */

const DEFAULT_RETRY_ATTEMPTS = (() => {
  const raw = Number(process.env.PIPELINE_ERROR_RETRY_ATTEMPTS ?? 1);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1;
})();
const DEFAULT_RETRY_BASE_DELAY_MS = (() => {
  const raw = Number(process.env.PIPELINE_ERROR_RETRY_BASE_DELAY_MS ?? 2000);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2000;
})();

/**
 * Heuristic: transport/5xx/timeout failures are worth retrying; validation and
 * parse failures are not (the caller usually retries those at its own level).
 * @param {Error|Object|null} error
 * @returns {boolean}
 */
export function isRetryablePipelineError(error) {
  if (!error) return false;
  const status = error.responseStatus ?? error.statusCode;
  if (typeof status === 'number') {
    return status >= 500 && status < 600;
  }
  const code = error.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') return true;
  const message = String(error.message || '');
  return /timeout|network|socket hang up/i.test(message);
}

/**
 * Uniform structured log line for a failed pipeline stage.
 * @param {string} stageName
 * @param {Object} error
 * @param {Object} context - extra serializable fields
 */
export function logPipelineError(stageName, error, context = {}) {
  const payload = {
    stage: stageName,
    message: String(error?.message || error),
    response_status: error?.responseStatus ?? error?.statusCode ?? null,
    raw_content: typeof error?.raw_content === 'string'
      ? error.raw_content.slice(0, 3000)
      : null
  };
  if (context && Object.keys(context).length) {
    payload.context = context;
  }
  console.error(`[stage:${stageName}] ERROR`, JSON.stringify(payload));
}

/**
 * Runs a pipeline step with standardized logging, retries on retryable errors,
 * and an optional fallback when all attempts fail.
 *
 * @param {string} stageName - label used in logs and error decoration
 * @param {Function} stepFn - zero-arg (possibly async) step producer
 * @param {Object} options
 *  - retries {number} retry count for retryable errors (default from env)
 *  - baseDelayMs {number} first backoff delay (default from env)
 *  - retryPredicate {Function} override of isRetryablePipelineError
 *  - fallback {unknown} value returned when every attempt fails (when set,
 *    the error is logged but not rethrown)
 *  - context {Object} extra fields attached to error logs
 * @returns {Promise<unknown>} step result or fallback
 * @throws {Error} last error, decorated with `stage` property, when no fallback
 */
export async function runPipelineStage(stageName, stepFn, options = {}) {
  const retries = Number.isFinite(Number(options.retries))
    ? Math.max(0, Math.floor(Number(options.retries)))
    : DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = Number.isFinite(Number(options.baseDelayMs))
    ? Math.max(0, Math.floor(Number(options.baseDelayMs)))
    : DEFAULT_RETRY_BASE_DELAY_MS;
  const retryPredicate = options.retryPredicate || isRetryablePipelineError;
  const hasFallback = Object.prototype.hasOwnProperty.call(options, 'fallback');

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await stepFn();
    } catch (error) {
      lastError = error;
      const retryable = retryPredicate(error);
      if (!retryable || attempt === retries) break;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.log(
        `[stage:${stageName}] retryable error (attempt ${attempt + 1}/${retries + 1}); ` +
        `waiting ${delayMs} ms: ${String(error?.message || error)}`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  logPipelineError(stageName, lastError, options.context || {});
  if (hasFallback) return options.fallback;

  if (lastError && !lastError.stage) {
    lastError.stage = stageName;
  }
  throw lastError;
}
