import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeContentPlanEvolution, scorePlanTemporalCadence } from '../src/modules/planning/services/evolutionary/planEvolution.js';

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
  process.env.ML_CONTENT_PLAN_PREDICT_STUB = '1';
  try {
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
  } finally {
    delete process.env.ML_CONTENT_PLAN_PREDICT_STUB;
  }
});

test('optimizeContentPlanEvolution normalizes invalid and locale-formatted GA params', async () => {
  process.env.ML_CONTENT_PLAN_PREDICT_STUB = '1';
  try {
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
  } finally {
    delete process.env.ML_CONTENT_PLAN_PREDICT_STUB;
  }
});

test('optimizeContentPlanEvolution evolves temporal slot genes (planned_date, day_of_week, day_offset)', async () => {
  process.env.ML_CONTENT_PLAN_PREDICT_STUB = '1';
  try {
    const result = await optimizeContentPlanEvolution(BASE_PLAN, {
      ga: {
        seed: 42,
        populationSize: 8,
        maxGenerations: 2,
        stagnationGenerations: 2
      }
    });

    assert.ok(result);
    const pub = result.optimizedPlan.publications[0];
    assert.ok(pub.planned_date, 'Expected planned_date on evolved publication');
    assert.ok(pub.day_of_week, 'Expected day_of_week on evolved publication');
    assert.equal(typeof pub.day_offset, 'number', 'Expected numeric day_offset');
    assert.ok(result.ga?.best_meta?.lcb_likes !== undefined, 'Expected lcb_likes in best_meta');
  } finally {
    delete process.env.ML_CONTENT_PLAN_PREDICT_STUB;
  }
});

test('scorePlanTemporalCadence rewards midweek analytical content and penalizes date collisions', () => {
  const midweekPlan = [
    { format: 'longread', objective: 'inform', day_of_week: 'wed', planned_date: '2026-03-04' },
    { format: 'digest', objective: 'engage', day_of_week: 'fri', planned_date: '2026-03-06' }
  ];
  const weekendAnalyticalPlan = [
    { format: 'longread', objective: 'inform', day_of_week: 'sun', planned_date: '2026-03-08' },
    { format: 'digest', objective: 'engage', day_of_week: 'mon', planned_date: '2026-03-09' }
  ];
  const collidingPlan = [
    { format: 'longread', objective: 'inform', day_of_week: 'wed', planned_date: '2026-03-04' },
    { format: 'digest', objective: 'engage', day_of_week: 'wed', planned_date: '2026-03-04' }
  ];

  const midweekScore = scorePlanTemporalCadence(midweekPlan);
  const weekendScore = scorePlanTemporalCadence(weekendAnalyticalPlan);
  const collidingScore = scorePlanTemporalCadence(collidingPlan);

  assert.ok(midweekScore > weekendScore, "Expected midweekScore > weekendScore");
  assert.ok(midweekScore > collidingScore, "Expected midweekScore > collidingScore");
});

test('optimizeContentPlanEvolution extracts 3 Pareto archetype strategies (NSGA-II)', async () => {
  const draft = {
    platforms: ['vk'],
    planning_horizon: { start_date: '2026-03-01', end_date: '2026-03-14', duration_days: 14 },
    publications: [
      {
        slot_id: 'slot_1',
        title: 'Post 1',
        topic: 'AI Architecture',
        format: 'article',
        objective: 'educate',
        tone: 'expert',
        planned_date: '2026-03-02'
      },
      {
        slot_id: 'slot_2',
        title: 'Post 2',
        topic: 'New Release',
        format: 'news',
        objective: 'sell',
        tone: 'business',
        planned_date: '2026-03-05'
      }
    ]
  };

  const result = await optimizeContentPlanEvolution(draft, {
    ga: { maxGenerations: 2, populationSize: 6, seed: 42 }
  });

  assert.ok(result.paretoStrategies, 'Must include paretoStrategies');
  assert.ok(result.paretoStrategies.balanced, 'Must include balanced strategy');
  assert.ok(result.paretoStrategies.viral_reach, 'Must include viral_reach strategy');
  assert.ok(result.paretoStrategies.conversion, 'Must include conversion strategy');
  assert.strictEqual(result.paretoStrategies.balanced.strategy_key, 'balanced');
  assert.strictEqual(result.paretoStrategies.viral_reach.strategy_key, 'viral_reach');
  assert.strictEqual(result.paretoStrategies.conversion.strategy_key, 'conversion');
});
