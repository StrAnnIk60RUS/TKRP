import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import telemetryRoutes from '../src/modules/telemetry/routes/telemetryRoutes.js';
import { attachRequestContext } from '../src/shared/http/security.js';
import { clearRecentErrors, getRecentErrors } from '../src/shared/logging/logger.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachRequestContext);
  app.use('/api/telemetry', telemetryRoutes);
  return app;
}

test('POST /api/telemetry/incident records client error and returns 200', async () => {
  clearRecentErrors();
  const app = createTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const payload = {
      trace_id: 'tr-client-12345',
      error: {
        name: 'TypeError',
        message: 'Cannot read properties of null',
        stack: 'TypeError: at Component.render'
      },
      breadcrumbs: [
        { type: 'ui', message: 'clicked button#submit' },
        { type: 'http', message: 'POST /api/enrich 500' }
      ],
      url: 'http://localhost:5173/content-plan',
      app_version: '1.0.0'
    };

    const res = await fetch(`http://127.0.0.1:${port}/api/telemetry/incident`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.trace_id, 'tr-client-12345');

    // Проверяем, что ошибка попала в ring buffer недавних ошибок
    const recent = getRecentErrors();
    assert.ok(recent.length > 0);
    const recorded = recent.find((e) => e.trace_id === 'tr-client-12345');
    assert.ok(recorded);
    assert.equal(recorded.module, 'frontend');
  } finally {
    server.close();
  }
});

test('GET /api/telemetry/recent-errors returns error history', async () => {
  const app = createTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/telemetry/recent-errors?limit=5`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.errors));
  } finally {
    server.close();
  }
});
