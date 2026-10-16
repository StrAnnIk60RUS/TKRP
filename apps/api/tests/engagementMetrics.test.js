import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEngagementRate,
  computePostEngagementMetrics
} from '../openrouter.js';
import { rankParsedPosts } from '../src/modules/enrichment/services/parserPipeline.js';

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

test('rankParsedPosts prefers engaging posts over the raw parser order', () => {
  const ranked = rankParsedPosts([
    { text: 'old quiet', datetime: '2026-01-01 10:00:00', likes: 1, comments: 0, reposts: 0, views: 10 },
    { text: 'new discussed', datetime: '2026-01-03 10:00:00', likes: 5, comments: 20, reposts: 1, views: 40 },
    { text: 'new quiet', datetime: '2026-01-03 11:00:00', likes: 1, comments: 0, reposts: 0, views: 10 }
  ]);
  assert.equal(ranked[0].text, 'new discussed');
  assert.notEqual(ranked[0].text, 'old quiet');
});

test('computePostEngagementMetrics unknown when no signal', () => {
  const r = computePostEngagementMetrics({ likes: 0, views: 0 });
  assert.equal(r.metrics_quality, 'unknown');
  assert.equal(r.rate, 0);
});
