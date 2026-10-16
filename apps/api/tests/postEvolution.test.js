import test from 'node:test';
import assert from 'node:assert/strict';

import {
  optimizePublicationsEvolution,
  fillPlanWithBestPublication
} from '../src/modules/planning/services/evolutionary/postEvolution.js';

const BASE_PUBLICATIONS = [
  {
    publication_id: 'pub_001',
    platform: 'telegram',
    topic: 'Автоматизация CRM',
    format: 'text',
    objective: 'inform',
    tone: 'expert'
  }
];

test('optimizePublicationsEvolution returns empty result for empty publications', async () => {
  const result = await optimizePublicationsEvolution([], {}, {});
  assert.ok(Array.isArray(result.publicationResults));
  assert.equal(result.publicationResults.length, 0);
  assert.equal(result.bestPublication, null);
  assert.ok(Array.isArray(result.archetypes));
  assert.equal(result.archetypes.length, 0);
});

test('fillPlanWithBestPublication passes publications through when no archetypes exist', async () => {
  const result = await fillPlanWithBestPublication(BASE_PUBLICATIONS, [], {}, {});
  assert.ok(Array.isArray(result.publications));
  assert.equal(result.publications.length, BASE_PUBLICATIONS.length);
  assert.equal(result.publications[0].publication_id, 'pub_001');
  assert.equal(result.ctaTargetCount, 0);
  assert.equal(result.ctaAssignedCount, 0);
});

test('fillPlanWithBestPublication returns empty plan for empty inputs', async () => {
  const result = await fillPlanWithBestPublication([], [], {}, {});
  assert.equal(result.publications.length, 0);
  assert.equal(result.ctaTargetCount, 0);
  assert.equal(result.ctaAssignedCount, 0);
});

test('fillPlanWithBestPublication propagates GA-evolved tone gene into final publication', async () => {
  process.env.TEST_MODE = 'true';
  const evolvedFeatureMap = {
    has_cta: 0,
    creativity: 0.5,
    tone_onehot_0: 0,
    tone_onehot_1: 0,
    tone_onehot_2: 0,
    tone_onehot_3: 1,
    tone_onehot_4: 0
  };
  const publicationResults = [
    {
      optimizedPublication: {
        publication_id: 'pub_001',
        platform: 'telegram',
        topic: 'Автоматизация CRM',
        format: 'text',
        objective: 'inform',
        tone: 'expert',
        ontology_features: evolvedFeatureMap
      },
      featureMap: evolvedFeatureMap,
      predictedLikes: 100,
      predictedShares: 10,
      predictedViews: 1000,
      fitness: 0.4
    }
  ];
  const result = await fillPlanWithBestPublication(BASE_PUBLICATIONS, publicationResults, {}, {});
  assert.equal(result.publications[0].tone, 'inspiring');
  assert.equal(result.publications[0].media_prompt, '');
});

test('fillPlanWithBestPublication keeps the LLM media prompt on visual posts', async () => {
  process.env.TEST_MODE = 'true';
  const publication = { ...BASE_PUBLICATIONS[0], format: 'image', platform: 'instagram' };
  const evolvedFeatureMap = {
    has_cta: 0,
    creativity: 0.5,
    tone_onehot_0: 0,
    tone_onehot_1: 0,
    tone_onehot_2: 0,
    tone_onehot_3: 1,
    tone_onehot_4: 0
  };
  const publicationResults = [
    {
      optimizedPublication: {
        ...publication,
        ontology_features: evolvedFeatureMap
      },
      featureMap: evolvedFeatureMap,
      predictedLikes: 100,
      predictedShares: 10,
      predictedViews: 1000,
      fitness: 0.4
    }
  ];
  const result = await fillPlanWithBestPublication([publication], publicationResults, {}, {});
  assert.equal(result.publications[0].media_prompt, 'Test media prompt');
  assert.equal(result.publications[0].media, null);
});
