import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueJob, getJobStatus } from '../src/shared/runtime/jobQueue.js';
import { runWithContext } from '../src/shared/logging/requestContext.js';
import { getRecentErrors, clearRecentErrors } from '../src/shared/logging/logger.js';
import { createPythonJsonWorker } from '../src/shared/runtime/pythonJsonWorker.js';

test('jobQueue propagates trace_id and records error details on failure', async () => {
  clearRecentErrors();
  const testTraceId = 'tr-test-async-123';

  let capturedTraceInsideJob = null;
  const jobId = await runWithContext({ traceId: testTraceId }, async () => {
    return enqueueJob('test_fail_job', async (payload, onProgress) => {
      onProgress({ phase: 'init', percent: 10 });
      capturedTraceInsideJob = testTraceId;
      throw new Error('intentional_job_failure');
    });
  });

  // Wait for the async job to run
  await new Promise((resolve) => setTimeout(resolve, 50));

  const status = getJobStatus(jobId);
  assert.equal(status.status, 'failed');
  assert.equal(status.trace_id, testTraceId);
  assert.equal(status.error, 'intentional_job_failure');
  assert.ok(status.error_stack.includes('intentional_job_failure'));
  assert.equal(capturedTraceInsideJob, testTraceId);

  // Check recent errors ring buffer
  const errors = getRecentErrors();
  const recorded = errors.find((e) => e.trace_id === testTraceId);
  assert.ok(recorded, 'Recent errors buffer must contain the failed job error');
  assert.equal(recorded.module, 'jobQueue');
  assert.ok(recorded.message.includes('intentional_job_failure'));
});

test('pythonJsonWorker logs and handles lifecycle cleanly', async () => {
  const worker = createPythonJsonWorker({
    scriptPath: 'test-script.py',
    description: 'test-unit-worker',
    startupTimeoutMs: 200,
    maxRetries: 0
  });

  // Test disposing an unstarted or stopped worker doesn't throw
  assert.doesNotThrow(() => {
    worker.dispose();
  });
});
