/**
 * LRU cache для часты RAG запросов (query + filters + embedding model version).
 * Key включает backend и modelVersion — результаты никогда shared cross model versions.
 * Env: RAG_CACHE_ENABLED (default true), RAG_CACHE_MAX_ENTRIES (128),
 * RAG_CACHE_TTL_MS (300000).
 */

function readPositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

const RAG_CACHE_ENABLED = process.env.RAG_CACHE_ENABLED !== 'false';
const RAG_CACHE_MAX_ENTRIES = readPositiveInt(process.env.RAG_CACHE_MAX_ENTRIES, 128);
const RAG_CACHE_TTL_MS = readPositiveInt(process.env.RAG_CACHE_TTL_MS, 300000);

const cache = new Map();
let hits = 0;
let misses = 0;
let evictions = 0;

function normalizeList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => (typeof item === 'string' ? item : String(item || '')).trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

export function getRagCacheConfig() {
  return {
    enabled: RAG_CACHE_ENABLED,
    maxEntries: RAG_CACHE_MAX_ENTRIES,
    ttlMs: RAG_CACHE_TTL_MS
  };
}

export function isRagCacheEnabled() {
  return RAG_CACHE_ENABLED;
}

/**
 * Cache key: backend + embedding model version + normalized query + limit +
 * platforms + audience segments. Different model versions never share entries.
 */
export function buildRagCacheKey(query, options = {}, modelVersion = '', backend = '') {
  const normalizedQuery = String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 20));
  const platforms = normalizeList(options.platforms ?? options.platform);
  const audience = normalizeList(options.audience_segments);
  return [
    backend,
    String(modelVersion || ''),
    normalizedQuery,
    String(limit),
    platforms.join(','),
    audience.join(',')
  ].join('|');
}

export function getCachedRagSearch(key, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry) {
    misses += 1;
    return null;
  }
  if (now > entry.expiresAt) {
    cache.delete(key);
    misses += 1;
    return null;
  }
  // LRU touch: re-insert to move to the tail (most-recently-used).
  cache.delete(key);
  cache.set(key, entry);
  hits += 1;
  return entry.value;
}

export function setCachedRagSearch(key, value, ttlMs = RAG_CACHE_TTL_MS, now = Date.now()) {
  while (cache.size >= RAG_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    evictions += 1;
  }
  cache.set(key, { value, expiresAt: now + ttlMs });
}

export function clearRagQueryCache() {
  cache.clear();
}

export function getRagCacheStats() {
  return {
    enabled: RAG_CACHE_ENABLED,
    entries: cache.size,
    max_entries: RAG_CACHE_MAX_ENTRIES,
    ttl_ms: RAG_CACHE_TTL_MS,
    hits,
    misses,
    evictions
  };
}
