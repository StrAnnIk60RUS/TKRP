import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import apiRoutes from '../src/app/apiRoutes.js';
import { attachRequestContext, applySecurityHeaders } from '../src/shared/http/security.js';
import { apiNotFoundHandler, globalErrorHandler } from '../src/shared/http/expressHttp.js';
import { requireSessionOrAdminApiKey } from '../src/modules/auth/services/sessionGate.js';

function buildTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(applySecurityHeaders);
  app.use(attachRequestContext);
  app.use(express.json({ limit: '1mb' }));
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

function uniqueUsername(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test('expired session token is rejected with 401', async () => {
  const prevTtl = process.env.SESSION_TTL_MS;
  // 80ms TTL
  process.env.SESSION_TTL_MS = '80';
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api/auth`;
  try {
    const username = uniqueUsername('exp');
    const password = 'secret-pass-exp';

    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(reg.status, 200);
    const regBody = await reg.json();
    const token = regBody.token;

    // Immediately check /me: should be 200
    const meImmediate = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(meImmediate.status, 200);

    // Wait 120ms so session expires
    await new Promise((r) => setTimeout(r, 120));

    const meExpired = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(meExpired.status, 401);
    const expiredBody = await meExpired.json();
    assert.equal(expiredBody.success, false);
    assert.match(expiredBody.error, /Сессия не найдена или истекла/);
  } finally {
    if (prevTtl !== undefined) process.env.SESSION_TTL_MS = prevTtl;
    else delete process.env.SESSION_TTL_MS;
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('requireSessionOrAdminApiKey constant-time key validation', async () => {
  const prevAdmin = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'super-secret-admin-token';
  try {
    // 1. Valid admin key via Bearer
    let nextCalled = false;
    const reqValid = { headers: { authorization: 'Bearer super-secret-admin-token' } };
    const resMock = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(p) { this.payload = p; return this; }
    };
    await requireSessionOrAdminApiKey(reqValid, resMock, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // 2. Tampered key (different character)
    nextCalled = false;
    const reqTampered = { headers: { authorization: 'Bearer super-secret-admin-tokex' } };
    await requireSessionOrAdminApiKey(reqTampered, resMock, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(resMock.statusCode, 401);

    // 3. Different length key
    nextCalled = false;
    const reqDiffLen = { headers: { authorization: 'Bearer super-secret' } };
    await requireSessionOrAdminApiKey(reqDiffLen, resMock, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(resMock.statusCode, 401);
  } finally {
    if (prevAdmin !== undefined) process.env.ADMIN_API_KEY = prevAdmin;
    else delete process.env.ADMIN_API_KEY;
    const { closePool } = await import('../src/shared/db/client.js');
    await closePool();
  }
});
