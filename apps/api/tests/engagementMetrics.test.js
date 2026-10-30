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

test('calculateComplexEngagementRate computes weighted reactions over views', async () => {
  const { calculateComplexEngagementRate } = await import(
    '../src/modules/ml/services/relevancePredictionService.js'
  );
  // likes=10 (weight 1), comments=5 (weight 2 -> 10), shares=2 (weight 3 -> 6) => 26 / 100 = 0.26
  const rate = calculateComplexEngagementRate({ likes: 10, comments: 5, shares: 2, views: 100 });
  assert.equal(rate, 0.26);
});

test('calculateComplexEngagementRate uses saturation proxy when views are missing', async () => {
  const { calculateComplexEngagementRate } = await import(
    '../src/modules/ml/services/relevancePredictionService.js'
  );
  // likes=10, comments=5 (10), shares=2 (6) => interactions = 26. proxy = 26 / 76 ~= 0.3421
  const rate = calculateComplexEngagementRate({ likes: 10, comments: 5, shares: 2, views: 0 });
  assert.ok(rate > 0.3 && rate < 0.4);
});

test('predictPlanMetricsByFeatureVectors returns valid predictions array and metadata', async () => {
  const { predictPlanMetricsByFeatureVectors } = await import(
    '../src/modules/ml/services/relevancePredictionService.js'
  );
  const sampleVector = [10, 4, 0.5, 0.2, 10, 14, 0.5, 0.5, 1.0, 0.5, 0.05, 0.1];
  const result = await predictPlanMetricsByFeatureVectors([sampleVector]);
  assert.ok(Array.isArray(result?.predictions));
  assert.equal(result.predictions.length, 1);
  assert.equal(result.predictions[0].length, 3);
  assert.ok(result.predictions[0][0] >= 0);
  assert.ok(result.predictions[0][1] >= 0);
  assert.ok(result.predictions[0][2] >= 0);
});

test('predictPostMetricsByFeatureVectors returns valid predictions array and metadata', async () => {
  const { predictPostMetricsByFeatureVectors } = await import(
    '../src/modules/ml/services/relevancePredictionService.js'
  );
  const sampleVector = new Array(36).fill(0.5);
  const result = await predictPostMetricsByFeatureVectors([sampleVector]);
  assert.ok(Array.isArray(result?.predictions));
  assert.equal(result.predictions.length, 1);
  assert.equal(result.predictions[0].length, 3);
  assert.ok(result.predictions[0][0] >= 0);
  assert.ok(result.predictions[0][1] >= 0);
  assert.ok(result.predictions[0][2] >= 0);
});



test('applyDeterministicPostProcessing extracts multi-platform CTA and emoji metrics', async () => {
  const { applyDeterministicPostProcessing } = await import(
    '../src/modules/enrichment/services/postDeterministicFeatures.js'
  );
  const data = {
    competitors: [
      {
        posts: [
          {
            content: '🚀 Новый релиз! Подписывайтесь на наш канал https://t.me/tech_channel чтобы не пропустить.',
            metrics: { likes: 100, comments: 5, views: 1500 }
          },
          {
            content: 'Ссылка в шапке профиля! Сохраняй пост и отправь другу 🔥✨',
            metrics: { likes: 250, comments: 12 }
          }
        ]
      }
    ]
  };
  const processed = applyDeterministicPostProcessing(data);
  const post1 = processed.competitors[0].posts[0];
  const post2 = processed.competitors[0].posts[1];

  assert.equal(post1.analysis.cta.has_cta, 1);
  assert.equal(post1.analysis.cta.cta_type, 'telegram');
  assert.equal(post1.analysis.emojis.count, 1);
  assert.ok(post1.analysis.emojis.density > 0);

  assert.equal(post2.analysis.cta.has_cta, 1);
  assert.equal(post2.analysis.cta.cta_type, 'instagram');
  assert.equal(post2.analysis.emojis.count, 2);
});
