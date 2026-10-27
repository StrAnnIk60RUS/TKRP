import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_SET_VERSION,
  LEGACY_FEATURE_SET_VERSION,
  getOntologyFeatureMode,
  isOntologyEnrichmentEnabled,
  buildPostFeatureMap,
  buildPostFeatureVectorWithMeta,
  buildPlanFeatureVectorWithMeta,
  buildPlanFeatureMap,
  buildMlTrainingDatasets,
  POST_FEATURE_NAMES
} from '../src/modules/ml/services/ml/ontologyFeatureEngineering.js';

test('feature set version constants', () => {
  assert.equal(FEATURE_SET_VERSION, 'v2');
  assert.equal(LEGACY_FEATURE_SET_VERSION, 'v1');
});

test('ontology enrichment gating defaults to off', () => {
  const mode = getOntologyFeatureMode();
  assert.equal(mode.enabled, false);
  assert.equal(isOntologyEnrichmentEnabled(), false);
});

test('ontology features ignored when enrichment disabled', () => {
  const publication = {
    url: 'https://vk.com/post1',
    content: 'Hello world',
    ontology_features: { creativity: 0.99 }
  };
  const featureMap = buildPostFeatureMap(publication, {});
  assert.notEqual(featureMap.creativity, 0.99);
});

test('buildPostFeatureVectorWithMeta carries version metadata', () => {
  const result = buildPostFeatureVectorWithMeta({ url: 'https://vk.com/p', content: 'x' }, {});
  assert.equal(result.featureSetVersion, FEATURE_SET_VERSION);
  assert.equal(result.ontologyFeaturesEnabled, false);
  assert.equal(result.vector.length, POST_FEATURE_NAMES.length);
});

test('buildPlanFeatureVectorWithMeta carries version metadata', () => {
  const result = buildPlanFeatureVectorWithMeta([{ url: 'https://vk.com/p', content: 'x' }], {});
  assert.equal(result.featureSetVersion, FEATURE_SET_VERSION);
  assert.equal(result.ontologyFeaturesEnabled, false);
});

test('buildMlTrainingDatasets emits version metadata', () => {
  const snapshot = {
    publications: [
      {
        competitor_id: 'comp1',
        platform: 'vk',
        url: 'https://vk.com/p1',
        content: 'Post one',
        raw_metrics: { likes: 10, shares: 2, views: 100 }
      }
    ],
    content_plans: []
  };
  const datasets = buildMlTrainingDatasets(snapshot, []);
  assert.equal(datasets.featureSetVersion, FEATURE_SET_VERSION);
  assert.equal(datasets.ontologyFeaturesEnabled, false);
  assert.equal(datasets.postDataset.features.length, 1);
  assert.equal(datasets.contentPlanDataset.features.length, 1);
});

test('optimized plan snapshots feed plan training samples', () => {
  const snapshot = { publications: [], content_plans: [] };
  const optimizedPlans = [
    {
      plan: {
        plan_id: 'plan-1',
        publications: [
          { url: 'https://vk.com/p1', content: 'Optimized post', raw_metrics: { likes: 1, shares: 1, views: 1 } }
        ]
      },
      optimization: {
        stage1: { ga: { best_meta: { fitness: 0.5, predicted_likes: 50, predicted_shares: 5, predicted_views: 500 } } },
        stage2: {
          items: [
            { ga: { best_meta: { fitness: 0.9, predicted_likes: 120, predicted_shares: 12, predicted_views: 1200 } } }
          ]
        }
      },
      saved_at: '2026-10-01T00:00:00.000Z'
    }
  ];
  const datasets = buildMlTrainingDatasets(snapshot, optimizedPlans);
  assert.equal(datasets.contentPlanDataset.features.length, 1);
  const meta = datasets.contentPlanDataset.sampleMeta[0];
  assert.equal(meta.source, 'ga_optimized');
  assert.equal(meta.optimized, true);
  assert.equal(meta.final_fitness, 0.9);
  assert.deepEqual(datasets.contentPlanDataset.targets[0], [120, 12, 1200]);
});

test('buildPlanFeatureMap recognizes published_at for timeline metrics', () => {
  const publications = [
    { published_at: '2026-03-01T10:00:00Z', topic: 'Topic 1', format: 'text', raw_metrics: { likes: 5 } },
    { published_at: '2026-03-11T10:00:00Z', topic: 'Topic 2', format: 'video', raw_metrics: { likes: 10 } },
    { published_at: '2026-03-21T10:00:00Z', topic: 'Topic 3', format: 'image', raw_metrics: { likes: 15 } }
  ];
  const featureMap = buildPlanFeatureMap(publications, {});
  assert.equal(featureMap.posts_count, 3);
  assert.ok(featureMap.duration_days > 15, `Expected duration_days > 15, got ${featureMap.duration_days}`);
  assert.ok(featureMap.timeline_density > 0, `Expected timeline_density > 0, got ${featureMap.timeline_density}`);
});

test('buildMlTrainingDatasets excludes ga_optimized synthetic targets when includeGaOptimized is false', () => {
  const snapshot = { publications: [], content_plans: [] };
  const optimizedPlans = [
    {
      plan: { plan_id: 'p1', publications: [{ topic: 'T', raw_metrics: { likes: 1 } }] },
      optimization: {
        stage1: { ga: { best_meta: { fitness: 0.8, predicted_likes: 99, predicted_shares: 9, predicted_views: 999 } } }
      }
    }
  ];
  const datasets = buildMlTrainingDatasets(snapshot, optimizedPlans, { includeGaOptimized: false });
  assert.equal(datasets.contentPlanDataset.features.length, 0);
  assert.equal(datasets.contentPlanDataset.targets.length, 0);
});


test('buildMlTrainingDatasets computes source baselines and platform reference baselines for relative normalization', () => {
  const snapshot = {
    publications: [
      {
        competitor_id: 'comp_vk',
        platform: 'vk',
        raw_metrics: { likes: 500, shares: 50, views: 5000 }
      },
      {
        competitor_id: 'comp_vk',
        platform: 'vk',
        raw_metrics: { likes: 700, shares: 70, views: 7000 }
      },
      {
        competitor_id: 'comp_b2b',
        platform: 'telegram',
        raw_metrics: { likes: 10, shares: 2, views: 100 }
      }
    ],
    content_plans: []
  };

  const datasets = buildMlTrainingDatasets(snapshot, []);
  assert.ok(Array.isArray(datasets.postDataset.baselines));
  assert.equal(datasets.postDataset.baselines.length, 3);
  // First two belong to VK competitor with median ~600
  assert.equal(datasets.postDataset.baselines[0][0], 600);
  assert.equal(datasets.postDataset.baselines[1][0], 600);
  // Third belongs to Telegram competitor with median ~10
  assert.equal(datasets.postDataset.baselines[2][0], 10);

  // Platform and reference baselines exist
  assert.ok(datasets.postDataset.platformBaselines.vk);
  assert.ok(datasets.postDataset.platformBaselines.telegram);
  assert.ok(Array.isArray(datasets.postDataset.referenceBaseline));
});
