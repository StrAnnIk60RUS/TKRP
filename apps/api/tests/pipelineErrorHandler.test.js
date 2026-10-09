import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryablePipelineError,
  runPipelineStage
} from '../src/shared/utils/pipelineErrorHandler.js';

test('isRetryablePipelineError classifies 5xx/transport as retryable, 4xx/validation as not', () => {
  const serverError = new Error('server boom');
  serverError.responseStatus = 503;
  assert.equal(isRetryablePipelineError(serverError), true);

  const clientError = new Error('bad request');
  clientError.responseStatus = 400;
  assert.equal(isRetryablePipelineError(clientError), false);

  const timeout = new Error('timeout');
  timeout.code = 'ETIMEDOUT';
  assert.equal(isRetryablePipelineError(timeout), true);

  const validation = new Error('LLM output failed schema validation');
  assert.equal(isRetryablePipelineError(validation), false);
  assert.equal(isRetryablePipelineError(null), false);
});

test('runPipelineStage retries retryable errors with backoff then rethrows decorated', async () => {
  let attempts = 0;
  try {
    await runPipelineStage(
      'retry_stage',
      async () => {
        attempts += 1;
        const error = new Error('flaky upstream');
        error.responseStatus = 502;
        throw error;
      },
      { retries: 1, baseDelayMs: 1 }
    );
  } catch (error) {
    assert.equal(attempts, 2);
    assert.equal(error.stage, 'retry_stage');
    return;
  }
  throw new Error('expected throw');
});

test('runPipelineStage returns fallback after exhausting retries', async () => {
  let attempts = 0;
  const value = await runPipelineStage(
    'fallback_stage',
    async () => {
      attempts += 1;
      const error = new Error('flaky upstream');
      error.responseStatus = 500;
      throw error;
    },
    { retries: 1, baseDelayMs: 1, fallback: 'partial' }
  );
  assert.equal(attempts, 2);
  assert.equal(value, 'partial');
});

test('runPipelineStage does not retry non-retryable errors', async () => {
  let attempts = 0;
  try {
    await runPipelineStage(
      'strict_stage',
      async () => {
        attempts += 1;
        throw new Error('validation failed: schema mismatch');
      },
      { retries: 3 }
    );
  } catch (error) {
    assert.equal(attempts, 1);
    assert.equal(error.stage, 'strict_stage');
    return;
  }
  throw new Error('expected throw');
});

test('runPipelineStage passes through success', async () => {
  const value = await runPipelineStage('ok_stage', async () => 42);
  assert.equal(value, 42);
});
