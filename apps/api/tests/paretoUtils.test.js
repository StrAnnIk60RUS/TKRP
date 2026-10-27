import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dominates,
  fastNonDominatedSort,
  calculateCrowdingDistances,
  extractParetoArchetypes
} from '../src/modules/planning/services/evolutionary/paretoUtils.js';

test('dominates: identifies Pareto dominance correctly', () => {
  // A dominates B if all >= and at least one >
  assert.strictEqual(dominates([0.8, 0.9, 0.7], [0.7, 0.8, 0.6]), true);
  // Equal is not strictly dominating
  assert.strictEqual(dominates([0.8, 0.8], [0.8, 0.8]), false);
  // Tradeoff: A better on f1, worse on f2 -> neither dominates
  assert.strictEqual(dominates([0.9, 0.4], [0.5, 0.8]), false);
  assert.strictEqual(dominates([0.5, 0.8], [0.9, 0.4]), false);
});

test('fastNonDominatedSort: partitions into Pareto fronts', () => {
  const population = [
    { id: 'p1', objectives: [1.0, 0.1, 0.5] }, // extreme f1
    { id: 'p2', objectives: [0.1, 1.0, 0.5] }, // extreme f2
    { id: 'p3', objectives: [0.8, 0.8, 0.8] }, // strong all-around
    { id: 'p4', objectives: [0.2, 0.2, 0.2] }, // strictly dominated
    { id: 'p5', objectives: [0.7, 0.7, 0.7] }  // dominated by p3
  ];

  const fronts = fastNonDominatedSort(population, (item) => item.objectives);
  assert.ok(fronts.length >= 2, 'Should have multiple fronts');
  const front1Ids = fronts[0].map((item) => item.id);
  assert.ok(front1Ids.includes('p1'), 'p1 is non-dominated');
  assert.ok(front1Ids.includes('p2'), 'p2 is non-dominated');
  assert.ok(front1Ids.includes('p3'), 'p3 is non-dominated');
  assert.ok(!front1Ids.includes('p4'), 'p4 must not be in front 1');
  assert.ok(!front1Ids.includes('p5'), 'p5 must not be in front 1 (dominated by p3)');
});

test('calculateCrowdingDistances: boundaries get infinity, interior gets finite distances', () => {
  const front = [
    { id: 'a', objectives: [0.1, 0.9] },
    { id: 'b', objectives: [0.5, 0.5] },
    { id: 'c', objectives: [0.9, 0.1] }
  ];

  const scored = calculateCrowdingDistances(front, (item) => item.objectives);
  assert.strictEqual(scored.length, 3);
  assert.strictEqual(scored[0].distance, Infinity);
  assert.strictEqual(scored[2].distance, Infinity);
  assert.ok(Number.isFinite(scored[1].distance));
  assert.ok(scored[1].distance > 0);
});

test('extractParetoArchetypes: selects viral, conversion, and balanced archetypes', () => {
  const front = [
    { id: 'viral_champ', objectives: [0.95, 0.2, 0.3] },
    { id: 'conversion_champ', objectives: [0.25, 0.95, 0.2] },
    { id: 'balanced_champ', objectives: [0.75, 0.70, 0.85] }
  ];

  const archetypes = extractParetoArchetypes(front, (item) => item.objectives);
  assert.ok(archetypes);
  assert.strictEqual(archetypes.viral_reach.id, 'viral_champ');
  assert.strictEqual(archetypes.conversion.id, 'conversion_champ');
  assert.strictEqual(archetypes.balanced.id, 'balanced_champ');
});
