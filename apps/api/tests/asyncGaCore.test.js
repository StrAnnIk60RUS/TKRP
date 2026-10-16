import test from 'node:test';
import assert from 'node:assert/strict';
import { runAsyncGeneticAlgorithm } from '../src/modules/planning/services/evolutionary/asyncGaCore.js';

function makeBaseOptions(overrides = {}) {
  return {
    seed: 123,
    populationSize: 16,
    maxGenerations: 30,
    stagnationGenerations: 10,
    eliteSize: 2,
    tournamentSize: 3,
    crossoverProbability: 0.8,
    mutationProbability: 0.1,
    direction: 'max',
    createIndividual: (rng) => ({ v: Math.floor(rng() * 20) }),
    cloneIndividual: (x) => ({ ...x }),
    scorePopulation: async (population) => population.map((x) => ({ score: x.v, meta: { v: x.v } })),
    crossover: (left, right, rng) => {
      const mid = rng() < 0.5 ? left.v : right.v;
      return [{ v: mid }, { v: mid }];
    },
    mutate: (x, rng) => ({ v: Math.max(0, Math.min(20, x.v + (rng() < 0.5 ? -1 : 1))) }),
    ...overrides
  };
}

test('runAsyncGeneticAlgorithm is deterministic with fixed seed', async () => {
  const options = makeBaseOptions();
  const first = await runAsyncGeneticAlgorithm(options);
  const second = await runAsyncGeneticAlgorithm(options);
  assert.equal(first.best_score, second.best_score);
  assert.deepEqual(first.best, second.best);
  assert.deepEqual(first.history.map((h) => h.best_score), second.history.map((h) => h.best_score));
});

test('runAsyncGeneticAlgorithm can stop by low_improvement', async () => {
  const result = await runAsyncGeneticAlgorithm(
    makeBaseOptions({
      maxGenerations: 100,
      minImprovementEpsilon: 0,
      minImprovementGenerations: 3,
      scorePopulation: async (population) => population.map(() => ({ score: 5 }))
    })
  );
  assert.equal(result.stop_reason, 'low_improvement');
  assert.ok(result.generations >= 4);
});

test('runAsyncGeneticAlgorithm caches repeated individuals with cacheKeyForIndividual', async () => {
  let scoreCalls = 0;
  const result = await runAsyncGeneticAlgorithm(
    makeBaseOptions({
      maxGenerations: 1,
      createIndividual: () => ({ v: 7 }),
      cacheKeyForIndividual: (individual) => `v:${individual.v}`,
      scorePopulation: async (population) => {
        scoreCalls += population.length;
        return population.map((x) => ({ score: x.v }));
      }
    })
  );
  assert.equal(result.history[0].cache_misses_unique, 1);
  assert.equal(scoreCalls, 1);
});

test('runAsyncGeneticAlgorithm supports roulette and rank selection paths', async () => {
  const roulette = await runAsyncGeneticAlgorithm(
    makeBaseOptions({
      selectionMethod: 'roulette',
      maxGenerations: 3
    })
  );
  const rank = await runAsyncGeneticAlgorithm(
    makeBaseOptions({
      selectionMethod: 'rank',
      maxGenerations: 3
    })
  );
  assert.ok(Number.isFinite(roulette.best_score));
  assert.ok(Number.isFinite(rank.best_score));
  assert.equal(roulette.history.length, 3);
  assert.equal(rank.history.length, 3);
});
