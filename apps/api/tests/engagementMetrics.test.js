import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEngagementRate,
  computePostEngagementMetrics
} from '../openrouter.js';

test('computePostEngagementMetrics uses views when present', () => {
  const r = computePostEngagementMetrics({ likes: 5, comments: 1, shares: 0, views: 100 });
  assert.equal(r.metrics_quality, 'views_based');
  assert.equal(r.rate, 0.06);
});

test('computePostEngagementMetrics uses interaction proxy when views missing', () => {
  const r = computePostEngagementMetrics({ likes: 10, comments: 0, shares: 0, views: 0 });
  assert.equal(r.metrics_quality, 'interaction_proxy');
  assert.ok(r.rate > 0 && r.rate <= 1);
  assert.equal(calculateEngagementRate({ likes: 10, views: 0 }), r.rate);
});

test('computePostEngagementMetrics unknown when no signal', () => {
  const r = computePostEngagementMetrics({ likes: 0, views: 0 });
  assert.equal(r.metrics_quality, 'unknown');
  assert.equal(r.rate, 0);
});
