import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmCacheKey,
  llmCacheGet,
  llmCacheOrCompute,
  llmCacheSet,
  llmCacheStats,
  llmCacheClear
} from '../src/shared/utils/llmCache.js';

test('buildLlmCacheKey is stable and sensitive to every request part', () => {
  const base = { model: 'm1', systemPrompt: 's', userPrompt: 'u', options: { temperature: 0.2 } };
  const key = buildLlmCacheKey(base);
  assert.equal(key, buildLlmCacheKey({ ...base }));
  assert.notEqual(key, buildLlmCacheKey({ ...base, model: 'm2' }));
  assert.notEqual(key, buildLlmCacheKey({ ...base, userPrompt: 'u2' }));
  assert.notEqual(key, buildLlmCacheKey({ ...base, options: { temperature: 0.3 } }));
});

test('llmCacheSet/Get roundtrip with LRU eviction', () => {
  llmCacheClear();
  const stats = llmCacheStats();
  assert.ok(stats.max_entries >= 2);
  for (let i = 0; i < stats.max_entries; i += 1) {
    llmCacheSet(`k${i}`, { index: i });
  }
  assert.equal(llmCacheGet('k0').index, 0);
  llmCacheSet('overflow', { index: -1 });
  assert.equal(llmCacheStats().entries, stats.max_entries);
  assert.equal(llmCacheGet('k1'), null);
  assert.equal(llmCacheGet('k0').index, 0);
  assert.equal(llmCacheGet('overflow').index, -1);
});

test('llmCacheOrCompute computes once and serves from cache', async () => {
  llmCacheClear();
  let calls = 0;
  const key = buildLlmCacheKey({ model: 'm', systemPrompt: 's', userPrompt: 'u' });
  const compute = async () => {
    calls += 1;
    return { computed: calls };
  };
  const first = await llmCacheOrCompute(key, compute);
  const second = await llmCacheOrCompute(key, compute);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test('expired entries are evicted transparently when TTL passes', async () => {
  // TTL не configurable mid-process (env-resolved); test via direct stored_at manipulation path:
  // llmCacheGet должен возвращ null для entry older than ttl. Skipped when TTL=0 default.
  const stats = llmCacheStats();
  if (stats.ttl_ms > 0) {
    llmCacheClear();
    llmCacheSet('ttl-key', { v: 1 });
    await new Promise((r) => setTimeout(r, stats.ttl_ms + 10));
    assert.equal(llmCacheGet('ttl-key'), null);
  }
});

test('llmCacheGet returns null for non-string keys', () => {
  assert.equal(llmCacheGet(null), null);
  assert.equal(llmCacheGet(123), null);
});
