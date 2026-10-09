import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, buildVectorLiteral, needsReembed, topKByCosine, getEmbeddingConfig } from '../src/modules/precedents/services/embeddingService.js';

test('cosineSimilarity identical vectors = 1, orthogonal = 0', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
});

test('buildVectorLiteral formats pgvector literal', () => {
  assert.equal(buildVectorLiteral([1, 2, 3]), '[1,2,3]');
  assert.equal(buildVectorLiteral([]), null);
  assert.equal(buildVectorLiteral(null), null);
});

test('needsReembed detects missing embedding', () => {
  assert.equal(needsReembed({ embedding_model_version: 'v1' }, 'v1', 2), true);
});

test('needsReembed detects model version mismatch', () => {
  assert.equal(needsReembed({ embedding: [1, 2], embedding_model_version: 'v2' }, 'v1', 2), true);
});

test('needsReembed falls back to embedding_model for pre-versioning records', () => {
  assert.equal(needsReembed({ embedding: [1, 2], embedding_model: 'v1' }, 'v1', 2), false);
});

test('needsReembed detects dimension mismatch', () => {
  assert.equal(needsReembed({ embedding: [1, 2, 3], embedding_model_version: 'v1' }, 'v1', 2), true);
});

test('needsReembed returns false for matching version and dim', () => {
  assert.equal(needsReembed({ embedding: [1, 2], embedding_model_version: 'v1' }, 'v1', 2), false);
});

test('getEmbeddingConfig modelVersion defaults to model name', () => {
  delete process.env.EMBEDDING_MODEL_VERSION;
  const config = getEmbeddingConfig();
  assert.equal(config.modelVersion, config.model);
  process.env.EMBEDDING_MODEL_VERSION = 'custom-v2';
  const overridden = getEmbeddingConfig();
  assert.equal(overridden.modelVersion, 'custom-v2');
  delete process.env.EMBEDDING_MODEL_VERSION;
});

test('topKByCosine matches brute-force sort', () => {
  const query = [1, 0, 0];
  const items = [
    { id: 'a', embedding: [0.1, 0.9, 0.1] },
    { id: 'b', embedding: [0.95, 0.05, 0.2] },
    { id: 'c', embedding: [0.5, 0.5, 0.0] },
    { id: 'd', embedding: [1, 0, 0] },
    { id: 'e', embedding: [0.2, 0.2, 0.8] }
  ];
  const top = topKByCosine(query, items, 3);
  assert.equal(top.length, 3);
  assert.equal(top[0].id, 'd');
  assert.equal(top[1].id, 'b');
  assert.equal(top[2].id, 'c');
  const brute = items
    .map((item) => ({ id: item.id, score: cosineSimilarity(query, item.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.id);
  assert.deepEqual(top.map((item) => item.id), brute);
});

test('topKByCosine k=0 returns empty', () => {
  assert.deepEqual(topKByCosine([1, 0], [{ embedding: [1, 0] }], 0), []);
});
