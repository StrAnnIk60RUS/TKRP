import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import enrichmentRoutes from '../src/modules/enrichment/routes/enrichmentRoutes.js';
import { createUser } from '../src/modules/auth/services/authStore.js';

function uniqueUsername(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function attachRequestContext(req, res, next) {
  req.requestId = 'test-enrich-req';
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(attachRequestContext);
  app.use('/api', enrichmentRoutes);
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

test('POST /api/enrich: missing competitors_data returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/enrich', {}, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('POST /api/enrich: competitors not an array returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/enrich', {
      competitors_data: { competitors: 'not-array' }
    }, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('POST /api/enrich: max batch exceeds MAX_ENRICH_REQUEST_BYTES returns 413', async () => {
  const prevMax = process.env.MAX_ENRICH_REQUEST_BYTES;
  process.env.MAX_ENRICH_REQUEST_BYTES = '400';
  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const bigContent = 'x'.repeat(800);
    const { res, json } = await postJson(port, '/api/enrich', {
      competitors_data: {
        competitors: [
          {
            competitor_id: 'c1',
            platform: 'vk',
            posts: [{ content: bigContent, url: 'https://example.com/p1' }]
          }
        ]
      }
    }, token);
    assert.equal(res.status, 413);
    assert.equal(json.success, false);
    assert.ok(json.request_guardrails);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
    if (prevMax === undefined) delete process.env.MAX_ENRICH_REQUEST_BYTES;
    else process.env.MAX_ENRICH_REQUEST_BYTES = prevMax;
  }
});

test('POST /api/enrich: auto-batch off and multiple batches returns 413', async () => {
  const prevAuto = process.env.ENRICH_AUTO_BATCH;
  const prevMaxPosts = process.env.MAX_POSTS_PER_ENRICH_REQUEST;
  process.env.ENRICH_AUTO_BATCH = 'false';
  process.env.MAX_POSTS_PER_ENRICH_REQUEST = '1';

  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/enrich', {
      competitors_data: {
        competitors: [
          {
            competitor_id: 'c1',
            platform: 'vk',
            posts: [
              { content: 'a', url: 'https://example.com/1' },
              { content: 'b', url: 'https://example.com/2' }
            ]
          }
        ]
      }
    }, token);
    assert.equal(res.status, 413);
    assert.match(json.error || '', /автоматическ|batching/i);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
    if (prevAuto === undefined) delete process.env.ENRICH_AUTO_BATCH;
    else process.env.ENRICH_AUTO_BATCH = prevAuto;
    if (prevMaxPosts === undefined) delete process.env.MAX_POSTS_PER_ENRICH_REQUEST;
    else process.env.MAX_POSTS_PER_ENRICH_REQUEST = prevMaxPosts;
  }
});

test('POST /api/parse: missing url returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/parse', {}, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('POST /api/parse-and-enrich: missing url returns 400', async () => {
  const token = (await createUser(uniqueUsername('test-enrich'), 'secret'))?.token;
  const app = buildApp();
  const { srv, port } = await startServer(app);
  try {
    const { res, json } = await postJson(port, '/api/parse-and-enrich', {}, token);
    assert.equal(res.status, 400);
    assert.equal(json.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});
