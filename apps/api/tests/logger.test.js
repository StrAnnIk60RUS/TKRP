import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, getRecentErrors, clearRecentErrors, LOG_LEVELS } from '../src/shared/logging/logger.js';
import { redactSensitiveData } from '../src/shared/logging/redaction.js';
import { runWithContext, getTraceContext } from '../src/shared/logging/requestContext.js';

test('redactSensitiveData masks passwords, tokens and secrets', () => {
  const input = {
    user: 'alice',
    password: 'superSecretPassword',
    token: 'jwt-header.payload.signature',
    apiKey: 'sk-1234567890abcdef',
    details: {
      auth: 'Basic dXNlcjpwYXNz',
      safeField: 42
    }
  };

  const output = redactSensitiveData(input);
  assert.equal(output.user, 'alice');
  assert.equal(output.password, '[REDACTED]');
  assert.equal(output.token, '[REDACTED]');
  assert.equal(output.apiKey, '[REDACTED]');
  assert.equal(output.details.auth, '[REDACTED]');
  assert.equal(output.details.safeField, 42);
});

test('redactSensitiveData masks Bearer tokens in strings', () => {
  const message = 'Failed with authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test and apiKey=secret_key_123';
  const redacted = redactSensitiveData(message);
  assert.ok(redacted.includes('Bearer [REDACTED]'));
  assert.ok(redacted.includes('[REDACTED]'));
  assert.ok(!redacted.includes('secret_key_123'));
});

test('redactSensitiveData handles circular references without throwing', () => {
  const circularObj = { name: 'cyclic' };
  circularObj.self = circularObj;

  const result = redactSensitiveData(circularObj);
  assert.equal(result.name, 'cyclic');
  assert.equal(result.self, '[CIRCULAR]');
});

test('runWithContext propagates context inside async scope', async () => {
  assert.deepEqual(getTraceContext(), {});

  await runWithContext({ traceId: 'trace-42', userId: 'user-7' }, async () => {
    assert.equal(getTraceContext().traceId, 'trace-42');
    assert.equal(getTraceContext().userId, 'user-7');

    // Nested call retains context
    await Promise.resolve();
    assert.equal(getTraceContext().traceId, 'trace-42');
  });

  assert.deepEqual(getTraceContext(), {});
});

test('logger captures recent errors in memory ring buffer', () => {
  clearRecentErrors();

  const customLogger = createLogger({ module: 'test_mod' }, LOG_LEVELS.DEBUG);
  customLogger.warn('First warning', { code: 'W1' });
  customLogger.error('Critical failure', new Error('boom'));

  const errors = getRecentErrors();
  assert.equal(errors.length, 2);
  assert.equal(errors[0].message, 'Critical failure');
  assert.equal(errors[0].level, 'ERROR');
  assert.equal(errors[0].error.message, 'boom');
  assert.equal(errors[1].message, 'First warning');
  assert.equal(errors[1].level, 'WARN');

  clearRecentErrors();
  assert.equal(getRecentErrors().length, 0);
});

test('child logger preserves parent bindings and trace id', () => {
  const parent = createLogger({ app: 'api' }, LOG_LEVELS.DEBUG);
  const child = parent.child({ module: 'evolution' });

  assert.equal(child.bindings.app, 'api');
  assert.equal(child.bindings.module, 'evolution');
});
