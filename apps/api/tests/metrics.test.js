import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  Counter,
  Gauge,
  Histogram,
  normalizeRoute,
  recordHttpRequest,
  recordJobExecution,
  recordPythonWorkerExecution,
  recordPythonCircuitBreaker,
  recordLlmCall,
  getMetricsAsPrometheusText,
  resetMetrics
} from '../src/shared/logging/metrics.js';
import telemetryRoutes from '../src/modules/telemetry/routes/telemetryRoutes.js';
import { attachRequestContext } from '../src/shared/http/security.js';

test('normalizeRoute collapses variable IDs and UUIDs to prevent cardinality explosion', () => {
  assert.equal(normalizeRoute('/health'), '/health');
  assert.equal(normalizeRoute('/api/plan/draft/current'), '/api/plan/draft/current');
  assert.equal(
    normalizeRoute('/api/plan/draft/c9bf9e57-1685-4c89-bafb-ff5af830be8a'),
    '/api/plan/draft/:uuid'
  );
  assert.equal(
    normalizeRoute('/api/auth/users/99812'),
    '/api/auth/users/:id'
  );
  assert.equal(
    normalizeRoute('/api/plan/snapshot/a1b2c3d4e5f67890a1b2c3d4e5f67890'),
    '/api/plan/snapshot/:id'
  );
  assert.equal(
    normalizeRoute('/api/enrich?param=123'),
    '/api/enrich'
  );
});

test('Counter tracks increments and renders Prometheus text lines', () => {
  const c = new Counter({ name: 'test_counter_total', help: 'A test counter' });
  c.inc({ method: 'GET', status: '200' });
  c.inc({ method: 'GET', status: '200' }, 4);
  c.inc({ method: 'POST', status: '500' }, 2);

  const lines = c.toPrometheusLines();
  assert.ok(lines.includes('# HELP test_counter_total A test counter'));
  assert.ok(lines.includes('# TYPE test_counter_total counter'));
  assert.ok(lines.some((l) => l.includes('test_counter_total{method="GET",status="200"} 5')));
  assert.ok(lines.some((l) => l.includes('test_counter_total{method="POST",status="500"} 2')));
});

test('Gauge supports static values and dynamic collectors', () => {
  const g = new Gauge({ name: 'test_gauge', help: 'A test gauge' });
  g.set({ queue: 'ready' }, 12);
  let lines = g.toPrometheusLines();
  assert.ok(lines.some((l) => l.includes('test_gauge{queue="ready"} 12')));

  const dynamicG = new Gauge({
    name: 'test_dynamic_gauge',
    help: 'Dynamic metric',
    collect: () => 42
  });
  lines = dynamicG.toPrometheusLines();
  assert.ok(lines.some((l) => l.includes('test_dynamic_gauge 42')));
});

test('Histogram accumulates latencies into buckets, sum, and count', () => {
  const h = new Histogram({
    name: 'test_latency_seconds',
    help: 'Latency histogram',
    buckets: [0.05, 0.1, 0.5, 1.0]
  });

  h.observe({ route: '/test' }, 0.02); // falls into 0.05, 0.1, 0.5, 1.0, +Inf
  h.observe({ route: '/test' }, 0.08); // falls into 0.1, 0.5, 1.0, +Inf
  h.observe({ route: '/test' }, 0.6);  // falls into 1.0, +Inf
  h.observe({ route: '/test' }, 2.5);  // falls into +Inf

  const lines = h.toPrometheusLines();
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_bucket{le="0.05",route="/test"} 1')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_bucket{le="0.1",route="/test"} 2')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_bucket{le="0.5",route="/test"} 2')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_bucket{le="1",route="/test"} 3')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_bucket{le="+Inf",route="/test"} 4')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_count{route="/test"} 4')));
  assert.ok(lines.some((l) => l.includes('test_latency_seconds_sum{route="/test"} 3.2')));
});

test('Public record helpers populate Prometheus metrics payload', () => {
  resetMetrics();

  recordHttpRequest('GET', '/health', 200, 0.005);
  recordJobExecution('test_job', 'completed', 0.25);
  recordPythonWorkerExecution('relevance_model', 'ok', 0.08);
  recordPythonCircuitBreaker('relevance_model');
  recordLlmCall('gpt-4o-mini', 'ok', 1.2, { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 });

  const text = getMetricsAsPrometheusText();

  assert.ok(text.includes('# TYPE http_requests_total counter'));
  assert.ok(text.includes('http_requests_total{method="GET",route="/health",status="200"} 1'));
  assert.ok(text.includes('job_queue_jobs_total{kind="test_job",status="completed"} 1'));
  assert.ok(text.includes('python_worker_requests_total{status="ok",worker="relevance_model"} 1'));
  assert.ok(text.includes('python_circuit_breaker_trips_total{worker="relevance_model"} 1'));
  assert.ok(text.includes('llm_requests_total{model="gpt-4o-mini",status="ok"} 1'));
  assert.ok(text.includes('llm_tokens_total{model="gpt-4o-mini",type="total"} 140'));
  assert.ok(text.includes('process_uptime_seconds'));
  assert.ok(text.includes('process_resident_memory_bytes'));
  assert.ok(text.includes('process_heap_used_bytes'));
});

test('GET /api/telemetry/metrics responds with Prometheus text/plain format', async () => {
  const app = express();
  app.use(express.json());
  app.use(attachRequestContext);
  app.use('/api/telemetry', telemetryRoutes);

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/telemetry/metrics`);
    assert.equal(res.status, 200);

    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('text/plain'));
    assert.ok(contentType.includes('version=0.0.4'));

    const body = await res.text();
    assert.ok(body.includes('# HELP process_uptime_seconds'));
    assert.ok(body.includes('# TYPE process_uptime_seconds gauge'));
    assert.ok(body.includes('# HELP http_requests_total'));
    assert.ok(body.includes('# HELP job_queue_jobs_total'));
  } finally {
    server.close();
  }
});
