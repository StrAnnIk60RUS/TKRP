import test from 'node:test';
import assert from 'node:assert/strict';
import { apiNotFoundHandler, globalErrorHandler } from '../src/shared/http/expressHttp.js';

function createMockRes() {
  return {
    statusCode: 200,
    payload: null,
    headersSent: false,
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

test('apiNotFoundHandler returns 404 payload with request id', () => {
  const req = { requestId: 'req-404' };
  const res = createMockRes();
  apiNotFoundHandler(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.success, false);
  assert.equal(res.payload.error, 'Not found');
  assert.equal(res.payload.request_id, 'req-404');
});

test('globalErrorHandler maps CORS deny to 403', () => {
  const req = { requestId: 'req-cors' };
  const res = createMockRes();
  globalErrorHandler(new Error('Origin https://evil is not allowed by CORS'), req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'Origin not allowed');
});

test('globalErrorHandler delegates when headers already sent', () => {
  const req = { requestId: 'req-next' };
  const res = createMockRes();
  res.headersSent = true;
  let forwarded = null;
  const err = new Error('already-sent');
  globalErrorHandler(err, req, res, (nextErr) => {
    forwarded = nextErr;
  });
  assert.equal(forwarded, err);
});

test('globalErrorHandler uses status from error object', () => {
  const req = { requestId: 'req-418' };
  const res = createMockRes();
  globalErrorHandler({ statusCode: 418, message: 'teapot' }, req, res, () => {});
  assert.equal(res.statusCode, 418);
  assert.equal(res.payload.error, 'teapot');
  assert.equal(res.payload.request_id, 'req-418');
});
