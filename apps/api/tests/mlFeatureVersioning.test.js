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
