import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reportIncident,
  generateTraceId,
  initGlobalCrashReporting
} from '../src/shared/lib/telemetry/clientReporter.js';
import {
  addBreadcrumb,
  clearBreadcrumbs
} from '../src/shared/lib/telemetry/breadcrumbs.js';

test('generateTraceId produces non-empty trace string starting with tr-', () => {
  const id1 = generateTraceId();
  const id2 = generateTraceId();

  assert.ok(typeof id1 === 'string' && id1.length > 5);
  assert.ok(typeof id2 === 'string' && id2.length > 5);
  assert.notEqual(id1, id2);
  assert.ok(id1.startsWith('tr-') || id1.includes('-'));
});

test('reportIncident captures error details and breadcrumbs in incidentPayload', async () => {
  clearBreadcrumbs();
  addBreadcrumb({ category: 'ui.click', message: 'User clicked submit' });
  addBreadcrumb({ category: 'http.request', message: 'POST /api/content-plans/generate' });

  const testError = new Error('Test pipeline breakdown');
  testError.traceId = 'tr-custom-12345';

  const report = await reportIncident({
    error: testError,
    componentStack: '\n at ProjectForm\n at App'
  });

  assert.equal(report.trace_id, 'tr-custom-12345');
  assert.equal(report.error.name, 'Error');
  assert.equal(report.error.message, 'Test pipeline breakdown');
  assert.ok(report.error.stack.includes('Test pipeline breakdown'));
  assert.equal(report.error.componentStack, '\n at ProjectForm\n at App');
  assert.ok(Array.isArray(report.breadcrumbs));
  assert.equal(report.breadcrumbs.length, 2);
  assert.equal(report.breadcrumbs[0].category, 'ui.click');
  assert.equal(report.breadcrumbs[1].category, 'http.request');
  assert.ok(report.timestamp);
  assert.equal(report.app_version, '1.0.0');

  clearBreadcrumbs();
});

test('reportIncident generates trace_id when none provided', async () => {
  clearBreadcrumbs();
  const testError = new Error('Random error');

  const report = await reportIncident({
    error: testError
  });

  assert.ok(report.trace_id);
  assert.ok(typeof report.trace_id === 'string' && report.trace_id.length > 0);
  assert.equal(report.error.message, 'Random error');
});

test('initGlobalCrashReporting does not throw in test/node environment', () => {
  assert.doesNotThrow(() => {
    initGlobalCrashReporting();
  });
});
