import { performance } from 'node:perf_hooks';

/**
 * Однострочный structured log для grep/агрегации; request_id совпадает с заголовком ответа.
 */
export function logPlanStructured(req, fields) {
  const payload = {
    request_id: req?.requestId ?? null,
    ...fields
  };
  console.log(JSON.stringify(payload));
}

export async function timePlanPhase(req, phase, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    logPlanStructured(req, {
      event: 'plan_phase',
      phase,
      ms: Math.round(performance.now() - t0)
    });
    return result;
  } catch (err) {
    logPlanStructured(req, {
      event: 'plan_phase',
      phase,
      ms: Math.round(performance.now() - t0),
      failed: true,
      error: String(err?.message || err)
    });
    throw err;
  }
}
