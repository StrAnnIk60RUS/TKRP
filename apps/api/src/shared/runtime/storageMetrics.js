/**
 * Storage latency metrics (in-process, dependency-free).
 * Records operation latencies as an EWMA + counters per operation name,
 * consumable by /health for infrastructure monitoring.
 */
const ALPHA = 0.2;

const stats = new Map();

export function recordStorageSample(operation, latencyMs) {
  const value = Number(latencyMs);
  if (!Number.isFinite(value) || value < 0) return;
  const entry = stats.get(operation) || { count: 0, errors: 0, ewmaMs: 0, maxMs: 0 };
  entry.count += 1;
  entry.ewmaMs = entry.count === 1 ? value : ALPHA * value + (1 - ALPHA) * entry.ewmaMs;
  if (value > entry.maxMs) entry.maxMs = value;
  stats.set(operation, entry);
}

export function recordStorageError(operation) {
  const entry = stats.get(operation) || { count: 0, errors: 0, ewmaMs: 0, maxMs: 0 };
  entry.errors += 1;
  stats.set(operation, entry);
}

export async function timedStorageOperation(operation, fn) {
  const started = process.hrtime.bigint();
  try {
    const result = await fn();
    recordStorageSample(operation, Number(process.hrtime.bigint() - started) / 1e6);
    return result;
  } catch (error) {
    recordStorageSample(operation, Number(process.hrtime.bigint() - started) / 1e6);
    recordStorageError(operation);
    throw error;
  }
}

export function getStorageMetricsSnapshot() {
  const operations = {};
  for (const [operation, entry] of stats) {
    operations[operation] = {
      count: entry.count,
      errors: entry.errors,
      ewma_ms: Math.round(entry.ewmaMs * 100) / 100,
      max_ms: Math.round(entry.maxMs * 100) / 100
    };
  }
  return { operations };
}

export function resetStorageMetrics() {
  stats.clear();
}
