import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueJob,
  getJobStatus,
  jobEvents
} from '../src/shared/runtime/jobQueue.js';

test('jobQueue: tracks progress and emits SSE-compatible events', async () => {
  const eventsCaptured = [];

  const runFn = async (_payload, onProgress) => {
    await new Promise((r) => setTimeout(r, 10));
    onProgress({ phase: 'stage1', generation: 1, max_generations: 10, best_score: 0.45 });
    await new Promise((r) => setTimeout(r, 10));
    onProgress({ phase: 'stage1', generation: 5, max_generations: 10, best_score: 0.58 });
    return { plan: 'optimized' };
  };

  let testJobId;
  const progressHandler = (progress) => {
    eventsCaptured.push({ type: 'progress', progress });
  };
  const completedHandler = (data) => {
    eventsCaptured.push({ type: 'completed', data });
  };

  testJobId = enqueueJob('test_sse', runFn, { foo: 'bar' });

  jobEvents.on(`progress:${testJobId}`, progressHandler);
  jobEvents.on(`completed:${testJobId}`, completedHandler);

  // Wait for job to finish
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const status = getJobStatus(testJobId);
    if (status?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const finalStatus = getJobStatus(testJobId);
  assert.strictEqual(finalStatus?.status, 'completed');
  assert.deepStrictEqual(finalStatus?.result, { plan: 'optimized' });
  assert.ok(finalStatus?.progress, 'Job should retain latest progress');
  assert.strictEqual(finalStatus.progress.generation, 5);
  assert.strictEqual(finalStatus.progress.best_score, 0.58);

  // Cleanup listeners
  jobEvents.off(`progress:${testJobId}`, progressHandler);
  jobEvents.off(`completed:${testJobId}`, completedHandler);

  assert.ok(eventsCaptured.length >= 2, 'Should capture progress events');
  assert.ok(eventsCaptured.some((e) => e.type === 'progress' && e.progress.generation === 1));
  assert.ok(eventsCaptured.some((e) => e.type === 'progress' && e.progress.generation === 5));
  assert.ok(eventsCaptured.some((e) => e.type === 'completed'));
});
