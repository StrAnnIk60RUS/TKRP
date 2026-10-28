/**
 * Zero-dependency Prometheus / OpenTelemetry Metrics Collector.
 * Выгружает системные, HTTP, фоновые (JobQueue), ML и LLM-метрики в стандартном
 * формате Prometheus text exposition format (text/plain; version=0.0.4).
 */

const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60
];

function escapeLabelValue(val) {
  return String(val ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function formatLabels(labels = {}) {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

function labelsKey(labels = {}) {
  const sortedKeys = Object.keys(labels).sort();
  return sortedKeys.map((k) => `${k}=${labels[k]}`).join('|');
}

export class Counter {
  constructor({ name, help }) {
    this.name = name;
    this.help = help;
    this.values = new Map(); // key -> { labels, value }
  }

  inc(labels = {}, amount = 1) {
    if (amount < 0) return;
    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += amount;
    } else {
      this.values.set(key, { labels: { ...labels }, value: amount });
    }
  }

  reset() {
    this.values.clear();
  }

  toPrometheusLines() {
    const lines = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const item of this.values.values()) {
        lines.push(`${this.name}${formatLabels(item.labels)} ${item.value}`);
      }
    }
    return lines;
  }
}

export class Gauge {
  constructor({ name, help, collect }) {
    this.name = name;
    this.help = help;
    this.collect = collect || null;
    this.values = new Map();
  }

  set(labels = {}, value = 0) {
    const key = labelsKey(labels);
    this.values.set(key, { labels: { ...labels }, value: Number(value) || 0 });
  }

  reset() {
    this.values.clear();
  }

  toPrometheusLines() {
    const lines = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);

    if (typeof this.collect === 'function') {
      try {
        const collected = this.collect();
        if (Array.isArray(collected)) {
          for (const item of collected) {
            lines.push(`${this.name}${formatLabels(item.labels || {})} ${item.value}`);
          }
        } else if (typeof collected === 'number') {
          lines.push(`${this.name} ${collected}`);
        }
      } catch (err) {
        lines.push(`${this.name} 0`);
      }
      return lines;
    }

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const item of this.values.values()) {
        lines.push(`${this.name}${formatLabels(item.labels)} ${item.value}`);
      }
    }
    return lines;
  }
}

export class Histogram {
  constructor({ name, help, buckets = DEFAULT_HISTOGRAM_BUCKETS }) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.series = new Map(); // key -> { labels, sum, count, bucketCounts: number[] }
  }

  observe(labels = {}, val = 0) {
    const num = Math.max(0, Number(val) || 0);
    const key = labelsKey(labels);
    let entry = this.series.get(key);
    if (!entry) {
      entry = {
        labels: { ...labels },
        sum: 0,
        count: 0,
        bucketCounts: new Array(this.buckets.length).fill(0)
      };
      this.series.set(key, entry);
    }

    entry.sum += num;
    entry.count += 1;

    for (let i = 0; i < this.buckets.length; i++) {
      if (num <= this.buckets[i]) {
        entry.bucketCounts[i] += 1;
      }
    }
  }

  reset() {
    this.series.clear();
  }

  toPrometheusLines() {
    const lines = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    if (this.series.size === 0) {
      lines.push(`${this.name}_count 0`);
      lines.push(`${this.name}_sum 0`);
      return lines;
    }

    for (const entry of this.series.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        const bucketLabels = { ...entry.labels, le: String(this.buckets[i]) };
        lines.push(`${this.name}_bucket${formatLabels(bucketLabels)} ${entry.bucketCounts[i]}`);
      }
      const infLabels = { ...entry.labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${entry.count}`);
      lines.push(`${this.name}_sum${formatLabels(entry.labels)} ${Number(entry.sum.toFixed(6))}`);
      lines.push(`${this.name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }

    return lines;
  }
}

// ==========================================
// Registry & Metrics Definitions
// ==========================================

export function normalizeRoute(path) {
  if (!path || path === '/') return '/';
  return path
    .split('?')[0]
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':uuid')
    .replace(/\b[0-9a-fA-F]{16,64}\b/g, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed by API'
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

export const jobQueueActiveJobs = new Gauge({
  name: 'job_queue_active_jobs',
  help: 'Current number of actively running background jobs'
});

export const jobQueueQueuedJobs = new Gauge({
  name: 'job_queue_queued_jobs',
  help: 'Current number of background jobs waiting in ready queue'
});

export const jobQueueJobsTotal = new Counter({
  name: 'job_queue_jobs_total',
  help: 'Total number of background jobs completed or failed'
});

export const jobQueueDurationSeconds = new Histogram({
  name: 'job_queue_duration_seconds',
  help: 'Background job execution duration in seconds',
  buckets: [0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120]
});

export const pythonWorkerRequestsTotal = new Counter({
  name: 'python_worker_requests_total',
  help: 'Total number of calls dispatched to persistent Python workers'
});

export const pythonWorkerDurationSeconds = new Histogram({
  name: 'python_worker_duration_seconds',
  help: 'Python worker request latency in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

export const pythonCircuitBreakerTripsTotal = new Counter({
  name: 'python_circuit_breaker_trips_total',
  help: 'Total times the Python worker circuit breaker tripped OPEN'
});

export const llmRequestsTotal = new Counter({
  name: 'llm_requests_total',
  help: 'Total number of OpenRouter LLM API calls'
});

export const llmRequestDurationSeconds = new Histogram({
  name: 'llm_request_duration_seconds',
  help: 'OpenRouter LLM API request duration in seconds',
  buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60]
});

export const llmTokensTotal = new Counter({
  name: 'llm_tokens_total',
  help: 'Total tokens consumed across OpenRouter calls'
});

// System metrics (dynamic gauges)
const processUptimeSeconds = new Gauge({
  name: 'process_uptime_seconds',
  help: 'Node.js process uptime in seconds',
  collect: () => Math.floor(process.uptime())
});

const processResidentMemoryBytes = new Gauge({
  name: 'process_resident_memory_bytes',
  help: 'Resident memory size (RSS) in bytes',
  collect: () => process.memoryUsage().rss
});

const processHeapUsedBytes = new Gauge({
  name: 'process_heap_used_bytes',
  help: 'V8 heap memory currently used in bytes',
  collect: () => process.memoryUsage().heapUsed
});

const processHeapTotalBytes = new Gauge({
  name: 'process_heap_total_bytes',
  help: 'V8 heap memory currently allocated in bytes',
  collect: () => process.memoryUsage().heapTotal
});

const processCpuUserSecondsTotal = new Gauge({
  name: 'process_cpu_user_seconds_total',
  help: 'Total user CPU time spent in seconds',
  collect: () => Number((process.cpuUsage().user / 1e6).toFixed(4))
});

const processCpuSystemSecondsTotal = new Gauge({
  name: 'process_cpu_system_seconds_total',
  help: 'Total system CPU time spent in seconds',
  collect: () => Number((process.cpuUsage().system / 1e6).toFixed(4))
});

const allMetrics = [
  // System metrics
  processUptimeSeconds,
  processResidentMemoryBytes,
  processHeapUsedBytes,
  processHeapTotalBytes,
  processCpuUserSecondsTotal,
  processCpuSystemSecondsTotal,

  // HTTP metrics
  httpRequestsTotal,
  httpRequestDurationSeconds,

  // JobQueue metrics
  jobQueueActiveJobs,
  jobQueueQueuedJobs,
  jobQueueJobsTotal,
  jobQueueDurationSeconds,

  // Python worker metrics
  pythonWorkerRequestsTotal,
  pythonWorkerDurationSeconds,
  pythonCircuitBreakerTripsTotal,

  // LLM metrics
  llmRequestsTotal,
  llmRequestDurationSeconds,
  llmTokensTotal
];

// ==========================================
// Public Helper Functions
// ==========================================

export function recordHttpRequest(method, path, status, durationSeconds) {
  const normRoute = normalizeRoute(path);
  const labels = {
    method: String(method || 'GET').toUpperCase(),
    route: normRoute,
    status: String(status || 200)
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationSeconds);
}

export function recordJobExecution(kind, status, durationSeconds) {
  const labels = { kind: String(kind || 'unknown'), status: String(status || 'completed') };
  jobQueueJobsTotal.inc(labels);
  jobQueueDurationSeconds.observe(labels, durationSeconds);
}

export function recordPythonWorkerExecution(worker, status, durationSeconds) {
  const labels = { worker: String(worker || 'default'), status: String(status || 'ok') };
  pythonWorkerRequestsTotal.inc(labels);
  pythonWorkerDurationSeconds.observe({ worker: String(worker || 'default') }, durationSeconds);
}

export function recordPythonCircuitBreaker(worker) {
  pythonCircuitBreakerTripsTotal.inc({ worker: String(worker || 'default') });
}

export function recordLlmCall(model, status, durationSeconds, tokenUsage = null) {
  const labels = { model: String(model || 'default'), status: String(status || 'ok') };
  llmRequestsTotal.inc(labels);
  llmRequestDurationSeconds.observe({ model: String(model || 'default') }, durationSeconds);

  if (tokenUsage && typeof tokenUsage === 'object') {
    if (typeof tokenUsage.prompt_tokens === 'number') {
      llmTokensTotal.inc({ model: String(model || 'default'), type: 'prompt' }, tokenUsage.prompt_tokens);
    }
    if (typeof tokenUsage.completion_tokens === 'number') {
      llmTokensTotal.inc({ model: String(model || 'default'), type: 'completion' }, tokenUsage.completion_tokens);
    }
    if (typeof tokenUsage.total_tokens === 'number') {
      llmTokensTotal.inc({ model: String(model || 'default'), type: 'total' }, tokenUsage.total_tokens);
    }
  }
}

/**
 * Сбрасывает все метрики (используется в тестах)
 */
export function resetMetrics() {
  for (const m of allMetrics) {
    m.reset();
  }
}

/**
 * Генерирует строку с метриками в формате Prometheus text format v0.0.4
 */
export function getMetricsAsPrometheusText() {
  const outputLines = [];
  for (const metric of allMetrics) {
    const lines = metric.toPrometheusLines();
    outputLines.push(...lines);
    outputLines.push('');
  }
  return outputLines.join('\n');
}
