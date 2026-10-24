import test from 'node:test';
import assert from 'node:assert/strict';

import {
  optimizePublicationsEvolution,
  fillPlanWithBestPublication
} from '../src/modules/planning/services/evolutionary/postEvolution.js';
import {
  generatePlanAnglesMatrix
} from '../src/modules/planning/services/llmPostGeneration.js';

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

test('generatePlanAnglesMatrix generates fallback matrix with unique slot hooks', async () => {
  const slots = [
    { index: 0, topic: 'Облачная безопасность', hook: 'question', objective: 'inform', format: 'text' },
    { index: 1, topic: 'DevOps оптимизация', hook: 'case', objective: 'educate', format: 'carousel' },
    { index: 2, topic: 'Миграция в Kubernetes', hook: 'contrast', objective: 'convert', format: 'video' }
  ];
  const matrix = await generatePlanAnglesMatrix(slots, { projectName: 'CloudSaaS' }, {});
  assert.equal(matrix.length, 3);
  assert.equal(matrix[0].index, 0);
  assert.equal(matrix[1].index, 1);
  assert.equal(matrix[2].index, 2);
  assert.ok(matrix[0].hook_opening.includes('вопрос'));
  assert.ok(matrix[1].hook_opening.includes('случай'));
  assert.ok(matrix[2].hook_opening.includes('контраст'));
  assert.notEqual(matrix[0].angle_title, matrix[1].angle_title);
});

test('fillPlanWithBestPublication executes batch-parallel generation for multi-slot plan', async () => {
  process.env.TEST_MODE = 'true';
  const publications = [
    { publication_id: 'pub_1', platform: 'telegram', topic: 'K8s Cluster', format: 'text', objective: 'inform' },
    { publication_id: 'pub_2', platform: 'linkedin', topic: 'CI/CD Pipelines', format: 'text', objective: 'educate' },
    { publication_id: 'pub_3', platform: 'vk', topic: 'FinOps Monitoring', format: 'image', objective: 'convert' }
  ];
  const evolvedFeatureMap = {
    has_cta: 1,
    creativity: 0.6,
    tone_onehot_0: 1,
    tone_onehot_1: 0,
    tone_onehot_2: 0,
    tone_onehot_3: 0,
    tone_onehot_4: 0
  };
  const publicationResults = publications.map((pub, idx) => ({
    optimizedPublication: { ...pub, ontology_features: evolvedFeatureMap },
    featureMap: evolvedFeatureMap,
    predictedLikes: 50 + idx * 10,
    predictedShares: 5 + idx,
    predictedViews: 500 + idx * 100,
    fitness: 0.5
  }));

  const result = await fillPlanWithBestPublication(publications, publicationResults, {}, {});
  assert.equal(result.publications.length, 3);
  assert.equal(result.publications[0].publication_id, 'pub_1');
  assert.equal(result.publications[1].publication_id, 'pub_2');
  assert.equal(result.publications[2].publication_id, 'pub_3');
  assert.ok(result.publications[2].media_prompt);
});
