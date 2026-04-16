import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeContentPlanEvolution } from '../src/modules/planning/services/evolutionary/planEvolution.js';

const BASE_PLAN = {
  planning_horizon: {
    start_date: '2026-01-01',
    end_date: '2026-01-07',
    duration_days: 7
  },
  platforms: ['telegram'],
  allowed_formats: ['text'],
  target_audience: ['b2b'],
  publications: [
    {
      publication_id: 'pub_001',
      platform: 'telegram',
      topic: 'Автоматизация CRM',
      format: 'text',
      objective: 'inform',
      tone: 'expert',
      key_message: 'Показываем, как автоматизация сокращает рутину в CRM.',
      summary: 'Короткий разбор шагов внедрения автоматизации CRM для B2B-команды.',
      cta: 'Напишите в комментариях ваш кейс.',
      expected_kpi: {
        engagement_rate: 0.1,
        conversion_potential: 0.08,
        reach_potential: 0.2
      }
    }
  ]
};

test('optimizeContentPlanEvolution supports inversion mutation strategy', async () => {
  const result = await optimizeContentPlanEvolution(BASE_PLAN, {
    ga: {
      seed: 1,
      populationSize: 8,
      maxGenerations: 3,
      stagnationGenerations: 2,
      tournamentSize: 3,
      eliteSize: 2,
      crossoverProbability: 0.9,
      mutationProbability: 1,
      mutationMethod: 'inversion'
    }
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.optimizedPlan?.publications));
  assert.ok(result.optimizedPlan.publications.length > 0);
  assert.equal(result.ga?.stop_reason === 'max_generations' || result.ga?.stop_reason === 'stagnation', true);
});

test('optimizeContentPlanEvolution normalizes invalid and locale-formatted GA params', async () => {
  const result = await optimizeContentPlanEvolution(BASE_PLAN, {
    ga: {
      seed: 'demo-seed',
      populationSize: 'bad',
      maxGenerations: '-10',
      stagnationGenerations: 'oops',
      eliteSize: 'NaN',
      tournamentSize: '1',
      crossoverProbability: '0,9',
      mutationProbability: '1,5',
      selectionMethod: 'unsupported',
      crossoverMethod: 'UNIFORM',
      mutationMethod: 'UNKNOWN'
    }
  });

  assert.ok(result);
  assert.ok(result.ga);
  assert.equal(result.ga.generations, 1);
  assert.ok(Number.isFinite(result.ga.best_score));
  assert.ok(Array.isArray(result.optimizedPlan?.publications));
  assert.ok(result.optimizedPlan.publications.length > 0);
});
