import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import precedentRoutes from '../src/modules/precedents/routes/precedentRoutes.js';
import { createUser } from '../src/modules/auth/services/authStore.js';

function uniqueUsername(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function attachRequestContext(req, res, next) {
  req.requestId = 'test-prec-req';
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(attachRequestContext);
  app.use('/api/precedents', precedentRoutes);
  return app;
}

async function startServer(app) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, port: srv.address().port });
    });
    srv.on('error', reject);
  });
}

async function postJson(port, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { res, json };
}

test('POST /api/precedents/search: missing query returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-prec'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/precedents/search', {}, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
    assert.match(json.error || '', /query/i);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('POST /api/precedents/search: blank query returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-prec'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/precedents/search', { query: '   ' }, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('GET /api/precedents/summary without auth returns 401', async () => {
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/precedents/summary`);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.match(json.error || '', /log in|register|Authentication/i);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('GET /api/precedents/summary returns 200', async () => {
  const token = (await createUser(uniqueUsername('test-prec'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/precedents/summary`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(typeof json.summary === 'object');
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});
