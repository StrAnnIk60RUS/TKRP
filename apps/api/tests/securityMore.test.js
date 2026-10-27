import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCorsOptions,
  createRateLimitMiddleware,
  requireLocalOrAdminApiKey,
  requireLocalOrApiKey,
  attachRequestContext
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

test('attachRequestContext ignores spoofed X-Forwarded-For when TRUST_PROXY is not enabled', () => {
  const prevTrust = process.env.TRUST_PROXY;
  delete process.env.TRUST_PROXY;
  try {
    const req = {
      headers: { 'x-forwarded-for': '127.0.0.1' },
      socket: { remoteAddress: '203.0.113.195' }
    };
    const res = { setHeader() {} };
    let nextCalled = false;
    attachRequestContext(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.clientIp, '203.0.113.195');
  } finally {
    if (prevTrust !== undefined) process.env.TRUST_PROXY = prevTrust;
    else delete process.env.TRUST_PROXY;
  }
});

test('requireLocalOrApiKey rejects 172.2.x.x and 172.200.x.x but allows RFC1918 172.16.x.x-172.31.x.x', () => {
  const prevKey = process.env.SERVER_API_KEY;
  process.env.SERVER_API_KEY = 'secret-key';
  try {
    // 172.2.0.1 is public, should be rejected without key
    const reqPublic1 = { clientIp: '172.2.0.1', headers: {}, requestId: 'r-pub1' };
    const resPublic1 = createMockRes();
    requireLocalOrApiKey(reqPublic1, resPublic1, () => {});
    assert.equal(resPublic1.statusCode, 401);

    // 172.200.1.1 is public, should be rejected without key
    const reqPublic2 = { clientIp: '172.200.1.1', headers: {}, requestId: 'r-pub2' };
    const resPublic2 = createMockRes();
    requireLocalOrApiKey(reqPublic2, resPublic2, () => {});
    assert.equal(resPublic2.statusCode, 401);

    // 172.16.0.1 is RFC 1918 private, allowed
    const reqPrivate1 = { clientIp: '172.16.0.1', headers: {}, requestId: 'r-priv1' };
    const resPrivate1 = createMockRes();
    let next1 = false;
    requireLocalOrApiKey(reqPrivate1, resPrivate1, () => { next1 = true; });
    assert.equal(next1, true);

    // 172.31.255.1 is RFC 1918 private, allowed
    const reqPrivate2 = { clientIp: '172.31.255.1', headers: {}, requestId: 'r-priv2' };
    const resPrivate2 = createMockRes();
    let next2 = false;
    requireLocalOrApiKey(reqPrivate2, resPrivate2, () => { next2 = true; });
    assert.equal(next2, true);
  } finally {
    if (prevKey !== undefined) process.env.SERVER_API_KEY = prevKey;
    else delete process.env.SERVER_API_KEY;
  }
});

test('applySecurityHeaders sets standard OWASP protection headers', () => {
  import('../src/shared/http/security.js').then(({ applySecurityHeaders }) => {
    const headers = {};
    const req = { headers: {} };
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      }
    };
    let nextCalled = false;
    applySecurityHeaders(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(headers['x-content-type-options'], 'nosniff');
    assert.equal(headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(headers['x-xss-protection'], '0');
    assert.equal(headers['cross-origin-opener-policy'], 'same-origin');
  });
});

test('requireLocalOrAdminApiKey in production strictly rejects local IP without key', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.ADMIN_API_KEY;
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_API_KEY = 'prod-secret-admin';

  try {
    const req = { clientIp: '127.0.0.1', headers: {}, requestId: 'r-prod-local' };
    const res = createMockRes();
    let nextCalled = false;
    requireLocalOrAdminApiKey(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error, 'Admin API key required for this endpoint.');

    // With valid admin key in production, it succeeds
    const reqWithKey = { clientIp: '127.0.0.1', headers: { authorization: 'Bearer prod-secret-admin' }, requestId: 'r-prod-ok' };
    const resOk = createMockRes();
    let nextOkCalled = false;
    requireLocalOrAdminApiKey(reqWithKey, resOk, () => { nextOkCalled = true; });

    assert.equal(nextOkCalled, true);
  } finally {
    if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv;
    else delete process.env.NODE_ENV;
    if (prevKey !== undefined) process.env.ADMIN_API_KEY = prevKey;
    else delete process.env.ADMIN_API_KEY;
  }
});

test('attachRequestContext prioritizes X-Real-IP when TRUST_PROXY is enabled', () => {
  const prevTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = 'true';
  try {
    const req = {
      headers: {
        'x-real-ip': '198.51.100.42',
        'x-forwarded-for': '127.0.0.1, 10.0.0.1'
      },
      socket: { remoteAddress: '172.18.0.2' }
    };
    const res = { setHeader() {} };
    let nextCalled = false;
    attachRequestContext(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.clientIp, '198.51.100.42');
  } finally {
    if (prevTrust !== undefined) process.env.TRUST_PROXY = prevTrust;
    else delete process.env.TRUST_PROXY;
  }
});
