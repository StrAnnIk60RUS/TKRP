import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import apiRoutes from '../src/app/apiRoutes.js';
import { attachRequestContext } from '../src/shared/http/security.js';
import { apiNotFoundHandler, globalErrorHandler } from '../src/shared/http/expressHttp.js';

function buildTestApp() {
  const app = express();
  app.use(attachRequestContext);
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/__error_probe', () => {
    throw new Error('probe_failure');
  });
  app.use('/api', apiRoutes);
  app.use('/api', apiNotFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve({ srv, port: addr.port });
    });
    srv.on('error', reject);
  });
}

test('unknown /api route returns 404 JSON', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/no-such-route-${Date.now()}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Not found');
    assert.ok(typeof body.request_id === 'string');
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('uncaught error in /api handler returns 500 JSON with request_id', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/__error_probe`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(typeof body.request_id === 'string');
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});
