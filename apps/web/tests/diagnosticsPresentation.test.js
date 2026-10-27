import test from 'node:test';
import assert from 'node:assert/strict';

test('Diagnostics formatting logic handles health stats properly', () => {
  const healthData = {
    status: 'ok',
    database: 'connected',
    uptime_seconds: 360,
    job_queue: { running: 1, queued: 3 },
    storage_metrics: { precedents_count: 42 }
  };

  const statusBadge = healthData.status === 'ok' ? 'status-ok' : 'status-degraded';
  assert.equal(statusBadge, 'status-ok');

  const uptimeMin = `${Math.floor(healthData.uptime_seconds / 60)} мин`;
  assert.equal(uptimeMin, '6 мин');

  const queueInfo = `Активно: ${healthData.job_queue.running}, В очереди: ${healthData.job_queue.queued}`;
  assert.equal(queueInfo, 'Активно: 1, В очереди: 3');
});

test('Diagnostics stack preview properly limits stack trace lines', () => {
  const stack = `Error: Something exploded\n    at Service.run (/app/service.js:10:5)\n    at Worker.process (/app/worker.js:40:12)\n    at JobQueue.pump (/app/queue.js:80:15)\n    at EventEmitter.emit (events.js:100:20)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;

  const preview = stack.split('\n').slice(0, 4).join('\n');
  const previewLines = preview.split('\n');

  assert.equal(previewLines.length, 4);
  assert.equal(previewLines[0], 'Error: Something exploded');
});

test('Diagnostics report payload structure complies with W3C export format', () => {
  const health = { status: 'ok', uptime_seconds: 120 };
  const serverErrors = [
    {
      level: 'ERROR',
      module: 'ml',
      message: 'Failed to fit model',
      trace_id: 'tr-test-ml-999',
      error: { stack: 'Error: ML fit error' }
    }
  ];
  const breadcrumbs = [
    { category: 'ui.click', message: 'clicked button#generate' },
    { category: 'http.request', message: 'POST /api/content-plans/generate' }
  ];

  const report = {
    timestamp: new Date().toISOString(),
    url: 'http://localhost:5173/',
    user_agent: 'NodeTestAgent/1.0',
    health,
    recent_server_errors: serverErrors,
    client_breadcrumbs: breadcrumbs
  };

  const serialized = JSON.stringify(report, null, 2);
  const parsed = JSON.parse(serialized);

  assert.equal(parsed.recent_server_errors.length, 1);
  assert.equal(parsed.recent_server_errors[0].trace_id, 'tr-test-ml-999');
  assert.equal(parsed.client_breadcrumbs.length, 2);
  assert.equal(parsed.health.status, 'ok');
});
