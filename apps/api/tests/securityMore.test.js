import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCorsOptions,
  createRateLimitMiddleware,
  requireLocalOrAdminApiKey,
  requireLocalOrApiKey
} from '../src/shared/http/security.js';

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test('createCorsOptions rejects unknown origin', async () => {
  const corsOptions = createCorsOptions();
  await assert.rejects(
    async () =>
      new Promise((resolve, reject) => {
        corsOptions.origin('https://unknown-origin.example', (err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
    /not allowed by CORS/
  );
});

test('requireLocalOrApiKey accepts valid bearer key for remote client', () => {
  const prev = process.env.SERVER_API_KEY;
  process.env.SERVER_API_KEY = 'server-key';
  try {
    const req = {
      clientIp: '8.8.8.8',
      headers: { authorization: 'Bearer server-key' },
      path: '/x',
      requestId: 'r1'
    };
    const res = createMockRes();
    let nextCalled = false;
    requireLocalOrApiKey(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  } finally {
    if (prev === undefined) delete process.env.SERVER_API_KEY;
    else process.env.SERVER_API_KEY = prev;
  }
});

test('requireLocalOrAdminApiKey accepts x-server-api-key header', () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = 'admin-key';
  try {
    const req = {
      clientIp: '8.8.4.4',
      headers: { 'x-server-api-key': 'admin-key' },
      path: '/admin',
      requestId: 'r2'
    };
    const res = createMockRes();
    let nextCalled = false;
    requireLocalOrAdminApiKey(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = prev;
  }
});

test('createRateLimitMiddleware limits repeated remote requests', () => {
  const limiter = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 2 });
  const req = { method: 'GET', clientIp: '8.8.8.8', headers: {}, path: '/api/heavy', requestId: 'r3' };

  const res1 = createMockRes();
  limiter(req, res1, () => {});
  assert.equal(res1.statusCode, 200);

  const res2 = createMockRes();
  limiter(req, res2, () => {});
  assert.equal(res2.statusCode, 200);

  const res3 = createMockRes();
  limiter(req, res3, () => {});
  assert.equal(res3.statusCode, 429);
  assert.equal(res3.payload.error, 'Too many requests. Retry later.');
});
