import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FITNESS_WEIGHTS,
  capPredictedMetrics,
  normalizeAgainstTarget,
  kpiScore,
  combineFitness,
  estimateCommentsFromBase
} from '../src/modules/planning/services/evolutionary/fitnessUtils.js';

const PLAN_METADATA = {
  target_summary: {
    total_likes: { max: 100 },
    total_shares: { max: 10 },
    total_views: { max: 1000 }
  }
};

const POST_METADATA = {
  target_summary: {
    likes: { max: 50 },
    shares: { max: 5 },
    views: { max: 500 }
  }
};

test('capPredictedMetrics caps against historical maxima with plan-level prefix', () => {
  const capped = capPredictedMetrics([150, 20, 2000], PLAN_METADATA, 'total_');
  assert.equal(capped.cappedLikes, 100);
  assert.equal(capped.cappedShares, 10);
  assert.equal(capped.cappedViews, 1000);
});

test('capPredictedMetrics passes through when no maxima known', () => {
  const capped = capPredictedMetrics([150, 20, 2000], null, 'total_');
  assert.equal(capped.cappedLikes, 150);
  assert.equal(capped.cappedShares, 20);
  assert.equal(capped.cappedViews, 2000);
});

test('normalizeAgainstTarget is monotonic, zero at zero, soft-capped at 1', () => {
  assert.equal(normalizeAgainstTarget(0, 100), 0);
  const atMax = normalizeAgainstTarget(100, 100);
  const aboveMax = normalizeAgainstTarget(200, 100);
  assert.ok(atMax > 0 && atMax < 1);
  assert.ok(aboveMax > atMax && aboveMax <= 1);
  const fallback = normalizeAgainstTarget(100, 0);
  assert.ok(fallback > 0 && fallback < 1);
});

test('kpiScore uses shared weights and prefix-aware metadata keys', () => {
  const planLevel = kpiScore([100, 0, 0], PLAN_METADATA, { keyPrefix: 'total_' });
  const expectedPlan = DEFAULT_FITNESS_WEIGHTS.likes * normalizeAgainstTarget(100, 100);
  assert.ok(Math.abs(planLevel - expectedPlan) < 1e-9);

  const postLevel = kpiScore([50, 0, 0], POST_METADATA, { keyPrefix: '' });
  const expectedPost = DEFAULT_FITNESS_WEIGHTS.likes * normalizeAgainstTarget(50, 50);
  assert.ok(Math.abs(postLevel - expectedPost) < 1e-9);
});

test('kpiScore includes observed comments when a fourth metric is present', () => {
  const withoutComments = kpiScore([50, 0, 0], POST_METADATA, { keyPrefix: '' });
  const withComments = kpiScore([50, 0, 0, 25], POST_METADATA, { keyPrefix: '' });
  assert.ok(withComments > withoutComments);
  assert.equal(estimateCommentsFromBase(40, { likes: 20, comments: 10 }), 20);
  assert.equal(estimateCommentsFromBase(40, { likes: 20, comments: 0 }), null);
});

test('kpiScore is deterministic for identical inputs', () => {
  assert.equal(
    kpiScore([80, 5, 800], PLAN_METADATA, { keyPrefix: 'total_' }),
    kpiScore([80, 5, 800], PLAN_METADATA, { keyPrefix: 'total_' })
  );
});

test('combineFitness without bonuses: optimization equals display kpi', () => {
  const combined = combineFitness({ kpi: 0.5 });
  assert.equal(combined.optimization, 0.5);
  assert.equal(combined.display, 0.5);
});

test('combineFitness blends diversity convexly by weight', () => {
  const combined = combineFitness({ kpi: 0.5, diversity: 0.8, diversityWeight: 0.5 });
  assert.ok(Math.abs(combined.optimization - 0.65) < 1e-9);
  assert.equal(combined.display, 0.5);
});

test('combineFitness clamps penalty into [0..1] optimization band', () => {
  const combined = combineFitness({ kpi: 0.5, penalty: 1 });
  assert.equal(combined.optimization, 0);
  assert.equal(combined.display, 0.5);
});
