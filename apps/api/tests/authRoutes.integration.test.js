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

test('auth register/login/logout/me flow', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api/auth`;
  try {
    const username = uniqueUsername('reg');
    const password = 'secret-pass-1';

    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(reg.status, 200);
    const regBody = await reg.json();
    assert.equal(regBody.success, true);
    assert.equal(regBody.user.username, username);
    assert.ok(typeof regBody.token === 'string' && regBody.token.length >= 64);

    const dup = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(dup.status, 409);
    const dupBody = await dup.json();
    assert.equal(dupBody.success, false);

    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.success, true);
    assert.equal(loginBody.user.username, username);

    const badLogin = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password-9' })
    });
    assert.equal(badLogin.status, 400);
    const badLoginBody = await badLogin.json();
    assert.equal(badLoginBody.success, false);

    const token = loginBody.token;
    const me = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.success, true);
    assert.equal(meBody.user.username, username);

    const logout = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    assert.equal(logout.status, 200);
    const logoutBody = await logout.json();
    assert.equal(logoutBody.success, true);
    assert.equal(logoutBody.removed, true);

    const meAfter = await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(meAfter.status, 401);
    const meAfterBody = await meAfter.json();
    assert.equal(meAfterBody.success, false);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('wizard drafts are scoped per user', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api`;
  try {
    const password = 'secret-pass-1';
    const regA = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('user-a'), password })
    });
    assert.equal(regA.status, 200);
    const bodyA = await regA.json();
    const regB = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('user-b'), password })
    });
    assert.equal(regB.status, 200);
    const bodyB = await regB.json();

    const put = await fetch(`${base}/plan/draft/current`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ formData: { producerName: 'User A producer' } })
    });
    assert.equal(put.status, 200);

    const getA = await fetch(`${base}/plan/draft/current`, {
      headers: { Authorization: `Bearer ${bodyA.token}` }
    });
    assert.equal(getA.status, 200);
    const getABody = await getA.json();
    assert.equal(getABody.success, true);
    assert.equal(getABody.draft.formData.producerName, 'User A producer');

    const getB = await fetch(`${base}/plan/draft/current`, {
      headers: { Authorization: `Bearer ${bodyB.token}` }
    });
    assert.equal(getB.status, 200);
    const getBBody = await getB.json();
    assert.equal(getBBody.success, true);
    assert.equal(getBBody.draft, null);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('plan snapshots enforce ownership for authenticated users', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api`;
  try {
    const password = 'secret-pass-1';
    const regA = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('snap-a'), password })
    });
    assert.equal(regA.status, 200);
    const bodyA = await regA.json();
    const regB = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('snap-b'), password })
    });
    assert.equal(regB.status, 200);
    const bodyB = await regB.json();

    const plan = {
      plan_id: 'auth-test-plan',
      display_name: 'Auth test snapshot',
      publications: [],
      platforms: []
    };
    const saved = await fetch(`${base}/plan/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ plan })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.success, true);
    const snapshotToken = savedBody.snapshot.token;

    const getOwn = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      headers: { Authorization: `Bearer ${bodyA.token}` }
    });
    assert.equal(getOwn.status, 200);
    const getOwnBody = await getOwn.json();
    assert.equal(getOwnBody.success, true);
    assert.equal(getOwnBody.snapshot.plan.plan_id, 'auth-test-plan');

    const getForeign = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      headers: { Authorization: `Bearer ${bodyB.token}` }
    });
    assert.equal(getForeign.status, 404);
    const getForeignBody = await getForeign.json();
    assert.equal(getForeignBody.success, false);

    const delForeign = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bodyB.token}` }
    });
    assert.equal(delForeign.status, 404);

    const delOwn = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bodyA.token}` }
    });
    assert.equal(delOwn.status, 200);
    const delOwnBody = await delOwn.json();
    assert.equal(delOwnBody.success, true);
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('plan snapshots reject token reuse by another user', async () => {
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api`;
  try {
    const password = 'secret-pass-1';
    const regA = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('clobber-a'), password })
    });
    assert.equal(regA.status, 200);
    const bodyA = await regA.json();
    const regB = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('clobber-b'), password })
    });
    assert.equal(regB.status, 200);
    const bodyB = await regB.json();

    const plan = {
      plan_id: 'clobber-test-plan',
      display_name: 'Clobber test snapshot',
      publications: [],
      platforms: []
    };
    const saved = await fetch(`${base}/plan/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bodyA.token}` },
      body: JSON.stringify({ plan })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.success, true);
    const snapshotToken = savedBody.snapshot.token;

    const clobber = await fetch(`${base}/plan/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bodyB.token}` },
      body: JSON.stringify({ plan: { ...plan, plan_id: 'stolen-plan' }, token: snapshotToken })
    });
    assert.equal(clobber.status, 404);
    const clobberBody = await clobber.json();
    assert.equal(clobberBody.success, false);

    const getOwn = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      headers: { Authorization: `Bearer ${bodyA.token}` }
    });
    assert.equal(getOwn.status, 200);
    const getOwnBody = await getOwn.json();
    assert.equal(getOwnBody.snapshot.plan.plan_id, 'clobber-test-plan');
  } finally {
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});

test('ownerless snapshots are invisible to authenticated users', async () => {
  const previousAdminKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'test-admin-key-1234567890';
  const app = buildTestApp();
  const { srv, port } = await listen(app);
  const base = `http://127.0.0.1:${port}/api`;
  try {
    const password = 'secret-pass-1';
    const regA = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uniqueUsername('ownerless'), password })
    });
    assert.equal(regA.status, 200);
    const bodyA = await regA.json();

    const plan = {
      plan_id: 'ownerless-plan',
      display_name: 'Ownerless snapshot',
      publications: [],
      platforms: []
    };
    const saved = await fetch(`${base}/plan/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-server-api-key': 'test-admin-key-1234567890' },
      body: JSON.stringify({ plan })
    });
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.success, true);
    const snapshotToken = savedBody.snapshot.token;

    const getUser = await fetch(`${base}/plan/snapshots/${snapshotToken}`, {
      headers: { Authorization: `Bearer ${bodyA.token}` }
    });
    assert.equal(getUser.status, 404);
    const getUserBody = await getUser.json();
    assert.equal(getUserBody.success, false);
  } finally {
    if (previousAdminKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = previousAdminKey;
    }
    srv.close();
    await new Promise((r) => srv.once('close', r));
  }
});
