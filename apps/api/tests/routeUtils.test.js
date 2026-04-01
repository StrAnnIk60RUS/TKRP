import test from 'node:test';
import assert from 'node:assert/strict';
import { sendRouteError } from '../src/shared/http/routeUtils.js';

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test('sendRouteError prefers error message for 4xx in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = createMockRes();
    const req = { requestId: 'req-400' };
    sendRouteError(res, req, 400, 'Bad', new Error('client detail'));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'client detail');
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('sendRouteError hides Error message for 5xx in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = createMockRes();
    const req = { requestId: 'req-500' };
    sendRouteError(res, req, 500, 'Внутренняя ошибка', new Error('db connection leaked'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Внутренняя ошибка');
    assert.notEqual(res.body.error, 'db connection leaked');
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('sendRouteError exposes Error message for 5xx outside production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const res = createMockRes();
    const req = { requestId: 'req-dev' };
    sendRouteError(res, req, 500, 'fallback', new Error('stack visible'));
    assert.equal(res.body.error, 'stack visible');
  } finally {
    process.env.NODE_ENV = prev;
  }
});
