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
