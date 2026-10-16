import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRagCacheKey, getCachedRagSearch, setCachedRagSearch, clearRagQueryCache, getRagCacheStats, isRagCacheEnabled, getRagCacheConfig } from '../src/modules/precedents/services/ragQueryCacheService.js';

test('cache is enabled by default', () => {
  assert.equal(isRagCacheEnabled(), true);
  const config = getRagCacheConfig();
  assert.equal(config.maxEntries, 128);
  assert.equal(config.ttlMs, 300000);
});

test('buildRagCacheKey normalizes query case/whitespace', () => {
  const a = buildRagCacheKey('  Hello   World!  ', {}, 'v1', 'json');
  const b = buildRagCacheKey('hello world', {}, 'v1', 'json');
  assert.equal(a, b);
});

test('buildRagCacheKey differs by model version', () => {
  const a = buildRagCacheKey('query', {}, 'model-a', 'json');
  const b = buildRagCacheKey('query', {}, 'model-b', 'json');
  assert.notEqual(a, b);
});

test('buildRagCacheKey differs by platforms', () => {
  const a = buildRagCacheKey('query', { platforms: ['vk'] }, 'v1', 'json');
  const b = buildRagCacheKey('query', { platforms: ['linkedin'] }, 'v1', 'json');
  assert.notEqual(a, b);
});

test('set/get hit returns cached value', () => {
  const key = buildRagCacheKey('hit me', {}, 'v1', 'json');
  setCachedRagSearch(key, { publications: [] });
  const hit = getCachedRagSearch(key);
  assert.ok(hit);
  assert.deepEqual(hit, { publications: [] });
});

test('expired entry is a miss (injected clock)', () => {
  const key = buildRagCacheKey('ttl me', {}, 'v1', 'json');
  setCachedRagSearch(key, { publications: [] }, 10, 0);
  const miss = getCachedRagSearch(key, 20);
  assert.equal(miss, null);
});

test('unknown key is a miss', () => {
  const miss = getCachedRagSearch('no-such-key');
  assert.equal(miss, null);
});

test('LRU eviction caps entries at max', () => {
  for (let i = 0; i < 130; i += 1) {
    setCachedRagSearch(`fill-key-${i}`, { index: i });
  }
  const stats = getRagCacheStats();
  assert.ok(stats.entries <= 128);
  assert.ok(stats.evictions >= 2);
});

test('clearRagQueryCache empties cache', () => {
  clearRagQueryCache();
  const stats = getRagCacheStats();
  assert.equal(stats.entries, 0);
});
