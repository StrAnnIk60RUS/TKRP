import test from 'node:test';
import assert from 'node:assert/strict';
import { GA_UTILS, runGeneticAlgorithm } from '../src/modules/planning/services/evolutionary/gaCore.js';

function makeOptions(overrides = {}) {
  return {
    seed: 42,
    populationSize: 24,
    maxGenerations: 40,
    stagnationGenerations: 8,
    eliteSize: 2,
    tournamentSize: 3,
    crossoverProbability: 0.8,
    mutationProbability: 0.15,
    direction: 'max',
    createIndividual: (rng) => ({ x: Math.round(rng() * 100) }),
    cloneIndividual: (item) => ({ ...item }),
    fitness: (item) => item.x,
    crossover: (left, right, rng) => {
      const alpha = rng();
      return [
        { x: Math.round(left.x * alpha + right.x * (1 - alpha)) },
        { x: Math.round(right.x * alpha + left.x * (1 - alpha)) }
      ];
    },
    mutate: (item, rng) => ({ x: Math.max(0, Math.min(100, item.x + (rng() < 0.5 ? -1 : 1))) }),
    ...overrides
  };
}

test('runGeneticAlgorithm validates required callbacks', () => {
  assert.throws(
    () => runGeneticAlgorithm({ fitness: () => 1 }),
    /createIndividual must be a function/
  );
  assert.throws(
    () => runGeneticAlgorithm({ createIndividual: () => ({}) }),
    /fitness must be a function/
  );
});

test('runGeneticAlgorithm is deterministic with same seed', () => {
  const options = makeOptions();
  const first = runGeneticAlgorithm(options);
  const second = runGeneticAlgorithm(options);

  assert.deepEqual(first.best, second.best);
  assert.equal(first.best_score, second.best_score);
  assert.deepEqual(first.history, second.history);
  assert.ok(first.generations >= 1);
});

test('runGeneticAlgorithm stops with stagnation reason', () => {
  const result = runGeneticAlgorithm(
    makeOptions({
      maxGenerations: 200,
      stagnationGenerations: 3,
      fitness: () => 7,
      mutationProbability: 0
    })
  );

  assert.equal(result.stop_reason, 'stagnation');
  assert.equal(result.generations, 4);
  assert.equal(result.best_score, 7);
});

test('runGeneticAlgorithm minimizes score for direction=min', () => {
  const result = runGeneticAlgorithm(
    makeOptions({
      seed: 7,
      direction: 'min',
      fitness: (item) => Math.abs(item.x - 5),
      mutate: (item, rng) => ({ x: Math.max(0, Math.min(100, item.x + (rng() < 0.5 ? -4 : 4))) })
    })
  );

  assert.ok(result.best_score <= 1, `expected score near zero, got ${result.best_score}`);
  assert.ok(Math.abs(result.best.x - 5) <= 1, `expected best x near 5, got ${result.best.x}`);
});

test('GA_UTILS helpers clamp and produce deterministic RNG', () => {
  assert.equal(GA_UTILS.clampInt('15.8', 1, 10), 10);
  assert.equal(GA_UTILS.clampInt('oops', 2, 9), 2);

  const rngA = GA_UTILS.makeRng('seeded-string');
  const rngB = GA_UTILS.makeRng('seeded-string');
  const seqA = [rngA(), rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB(), rngB()];
  assert.deepEqual(seqA, seqB);

  const picked = GA_UTILS.pickOne(['a', 'b', 'c'], () => 0.99);
  assert.equal(picked, 'c');
});
