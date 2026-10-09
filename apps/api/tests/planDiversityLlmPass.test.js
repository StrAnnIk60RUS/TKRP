import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFitnessRollbackGuard,
  mergePublicationsRewrite
} from '../src/modules/planning/services/planDiversityLlmPass.js';

test('mergePublicationsRewrite keeps originals when rewrite list is empty', () => {
  const original = [{ publication_id: 'p1', summary: 'same' }];
  const merged = mergePublicationsRewrite(original, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].summary, 'same');
});

test('applyFitnessRollbackGuard rolls back when fitness decreases beyond epsilon', async () => {
  const original = [{ publication_id: 'p1', summary: 'good' }];
  const merged = [{ publication_id: 'p1', summary: 'worse' }];
  const fitness = (pubs) => (pubs[0].summary === 'good' ? 10 : 4);
  const guarded = await applyFitnessRollbackGuard(original, merged, { fitnessFn: fitness, epsilon: 0.5 });
  assert.equal(guarded.meta.reason, 'rollback');
  assert.equal(guarded.meta.fitness_before, 10);
  assert.equal(guarded.meta.fitness_after, 4);
  assert.equal(guarded.publications, original);
});

test('applyFitnessRollbackGuard keeps merged when fitness improves', async () => {
  const original = [{ publication_id: 'p1', summary: 'bad' }];
  const merged = [{ publication_id: 'p1', summary: 'good' }];
  const guarded = await applyFitnessRollbackGuard(original, merged, {
    fitnessFn: async (pubs) => (pubs[0].summary === 'good' ? 10 : 4)
  });
  assert.equal(guarded.publications, merged);
  assert.notEqual(guarded.meta.reason, 'rollback');
  assert.equal(guarded.meta.fitness_before, 4);
  assert.equal(guarded.meta.fitness_after, 10);
});

test('applyFitnessRollbackGuard tolerates within-epsilon fitness drop', async () => {
  const guarded = await applyFitnessRollbackGuard(
    [{ v: 10 }],
    [{ v: 9 }],
    { fitnessFn: (pubs) => pubs[0].v, epsilon: 2 }
  );
  assert.notEqual(guarded.meta.reason, 'rollback');
});

test('applyFitnessRollbackGuard keeps merged when fitness is non-finite', async () => {
  const guarded = await applyFitnessRollbackGuard(
    [{ v: 1 }],
    [{ v: 2 }],
    { fitnessFn: () => Number.NaN }
  );
  assert.notEqual(guarded.meta.reason, 'rollback');
});
