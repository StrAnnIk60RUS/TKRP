import test from 'node:test';
import assert from 'node:assert/strict';
import { computePublicationReliability, enrichSearchResultsWithReliability, getReliabilityDistribution, calibrateWeights, precedentRankSignals } from '../src/modules/precedents/services/precedentReliabilityService.js';
import { hasUsablePrecedentSemantics, scoreRetrievalHit } from '../src/modules/precedents/repositories/precedentRepositoryShared.js';

function richPublicationItem() {
  return {
    type: 'publication',
    score: 1,
    data: {
      source_url: 'https://vk.com/post/1',
      parsed_at: '2026-01-01T00:00:00.000Z',
      competitor_name: 'Acme',
      engagement_rate: 0.42,
      raw_content: 'x'.repeat(80),
      publication_model: {
        topic: 'rsc',
        format: 'post',
        audience_segments: ['dev-team'],
        summary: 'a'.repeat(30),
        spcj: { dimensions: { tone: 0.5 } }
      }
    }
  };
}

test('computePublicationReliability on rich item = 1', () => {
  const { reliability, factors } = computePublicationReliability(richPublicationItem());
  assert.equal(reliability, 1);
  assert.equal(factors.retrieval_score, 1);
  assert.equal(factors.completeness, 1);
  assert.equal(factors.source_trust, 1);
});

test('precedentRankSignals ranks comment-heavy posts above like-only posts with the same views', () => {
  const discussed = precedentRankSignals({
    raw_metrics: { likes: 10, comments: 30, shares: 0, views: 100 },
    engagement_rate: null
  });
  const liked = precedentRankSignals({
    raw_metrics: { likes: 10, comments: 0, shares: 0, views: 100 },
    engagement_rate: null
  });
  assert.ok(discussed.engagement > liked.engagement);
  const discussedScore = scoreRetrievalHit({ embeddingScore: 0.4, tokenScore: 0.2, engagementSignal: discussed.engagement, trustSignal: 0.4 });
  const likedScore = scoreRetrievalHit({ embeddingScore: 0.4, tokenScore: 0.2, engagementSignal: liked.engagement, trustSignal: 0.4 });
  assert.ok(discussedScore > likedScore);
});

test('hasUsablePrecedentSemantics rejects unspecified topics', () => {
  assert.equal(hasUsablePrecedentSemantics({ publication_model: { topic: 'unspecified', summary: 'x'.repeat(40) } }), false);
  assert.equal(hasUsablePrecedentSemantics({ publication_model: { topic: 'Сервис', summary: 'x'.repeat(40) } }), true);
});

test('computePublicationReliability on empty item = 0', () => {
  const { reliability } = computePublicationReliability({ type: 'publication', score: 0, data: {} });
  assert.equal(reliability, 0);
});

test('enrichSearchResultsWithReliability adds reliability fields', () => {
  const result = {
    publications: [richPublicationItem()],
    content_plans: []
  };
  const enriched = enrichSearchResultsWithReliability(result);
  assert.equal(enriched.publications.length, 1);
  assert.equal(typeof enriched.publications[0].reliability, 'number');
  assert.ok(enriched.publications[0].reliability_factors);
});

test('getReliabilityDistribution counts samples', () => {
  const before = getReliabilityDistribution();
  computePublicationReliability(richPublicationItem());
  const after = getReliabilityDistribution();
  assert.equal(after.count_publications, before.count_publications + 1);
  assert.equal(after.buckets.publications.length, 10);
});

test('calibrateWeights returns normalized weights near target mean', () => {
  const distributionInput = {
    stats: {
      retrieval_score: { mean: 0.7, std: 0.2 },
      completeness: { mean: 0.5, std: 0.1 },
      source_trust: { mean: 0.8, std: 0.05 }
    },
    buckets: { publications: [], content_plans: [], factors: {} },
    count_publications: 100,
    count_content_plans: 0
  };
  const { weights, projected_mean } = calibrateWeights(distributionInput, 0.65);
  const sum = weights.retrieval + weights.completeness + weights.source_trust;
  assert.ok(Math.abs(sum - 1) < 0.01);
  assert.ok(Math.abs(projected_mean - 0.65) < 0.02);
});
