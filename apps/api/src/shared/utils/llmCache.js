import crypto from 'crypto';
import fs from 'fs';

/**
 * Shared LLM response cache (TTL + LRU), keyed by sha256 of the normalized
 * request material (model + system prompt + user prompt + options).
 *
 * Env configuration (all optional):
 * - LLM_CACHE_ENABLED — 'false' disables caching entirely (default: enabled).
 * - LLM_CACHE_TTL_MS — entry lifetime in milliseconds; 0 = no expiry (default: 0).
 * - LLM_CACHE_MAX_ENTRIES — LRU capacity (default: 200).
 * - LLM_CACHE_FILE — optional JSON file for disk persistence (dev convenience).
 *
 * Backward-compatible fallbacks: SEMANTIC_ENRICHMENT_CACHE_MAX_ENTRIES and
 * SEMANTIC_ENRICHMENT_CACHE_FILE are used when the LLM_CACHE_* equivalents
 * are not set, so existing deployments keep working.
 */

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

// Env is resolved lazily (on first cache use) because dotenv may load .env
// only after this module is imported (openrouter.js loads .env in its body).
let config = null;

/** @returns {Object} resolved cache configuration (enabled, max, ttl, file). */
function resolveConfig() {
  if (config) return config;
  const enabled = (() => {
    const explicit = process.env.LLM_CACHE_ENABLED;
    if (explicit !== undefined && explicit !== '') return explicit !== 'false';
    return true;
  })();
  config = {
    enabled,
    maxEntries: readPositiveIntEnv(
      'LLM_CACHE_MAX_ENTRIES',
      readPositiveIntEnv('SEMANTIC_ENRICHMENT_CACHE_MAX_ENTRIES', 200)
    ),
    ttlMs: (() => {
      const raw = Number(process.env.LLM_CACHE_TTL_MS ?? 0);
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    })(),
    file: process.env.LLM_CACHE_FILE || process.env.SEMANTIC_ENRICHMENT_CACHE_FILE || null
  };
  return config;
}

/** @returns {boolean} whether caching is active for this process. */
export function isLlmCacheEnabled() {
  return resolveConfig().enabled;
}

/**
 * Builds a stable cache key from the full request material.
 * @param {Object} requestParts - { model, systemPrompt, userPrompt, options }
 * @returns {string} hex sha256 digest
 */
export function buildLlmCacheKey(requestParts = {}) {
  const material = JSON.stringify({
    model: requestParts?.model ?? null,
    systemPrompt: requestParts?.systemPrompt ?? '',
    userPrompt: requestParts?.userPrompt ?? '',
    options: requestParts?.options ?? null
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

const cacheEntries = new Map();
let diskLoaded = false;

function loadFromDisk() {
  const cfg = resolveConfig();
  if (diskLoaded || !cfg.file) return;
  diskLoaded = true;
  try {
    const raw = fs.readFileSync(cfg.file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([key, rawEntry]) => {
        if (cacheEntries.size >= cfg.maxEntries) return;
        const isWrapped =
          rawEntry !== null &&
          typeof rawEntry === 'object' &&
          !Array.isArray(rawEntry) &&
          Object.prototype.hasOwnProperty.call(rawEntry, 'value') &&
          typeof rawEntry.stored_at === 'number';
        cacheEntries.set(
          key,
          isWrapped
            ? { value: rawEntry.value, stored_at: rawEntry.stored_at }
            : { value: rawEntry, stored_at: Date.now() }
        );
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`[llmCache] Не могу读取 cache file: ${error.message}`);
    }
  }
}

function saveToDisk() {
  const cfg = resolveConfig();
  if (!cfg.file) return;
  try {
    fs.writeFileSync(cfg.file, JSON.stringify(Object.fromEntries(cacheEntries), null, 0), 'utf-8');
  } catch (error) {
    console.warn(`[llmCache] Не могу write cache file: ${error.message}`);
  }
}

function touchEntry(key) {
  const cfg = resolveConfig();
  if (!cacheEntries.has(key)) return false;
  const entry = cacheEntries.get(key);
  if (cfg.ttlMs > 0 && Date.now() - entry.stored_at > cfg.ttlMs) {
    cacheEntries.delete(key);
    return false;
  }
  cacheEntries.delete(key);
  cacheEntries.set(key, entry);
  return true;
}

/**
 * Looks up a cached value; expired entries are evicted transparently.
 * @param {string} key
 * @returns {unknown|null} cached value or null on miss
 */
export function llmCacheGet(key) {
  if (!resolveConfig().enabled || typeof key !== 'string') return null;
  loadFromDisk();
  if (!touchEntry(key)) return null;
  return cacheEntries.get(key).value;
}

/**
 * Stores a value with LRU eviction and TTL stamping.
 * @param {string} key
 * @param {unknown} value
 */
export function llmCacheSet(key, value) {
  const cfg = resolveConfig();
  if (!cfg.enabled || typeof key !== 'string') return;
  cacheEntries.set(key, { value, stored_at: Date.now() });
  while (cacheEntries.size > cfg.maxEntries) {
    const oldest = cacheEntries.keys().next().value;
    cacheEntries.delete(oldest);
  }
  saveToDisk();
}

/**
 * Cache-or-compute helper: returns a cached value for the key, otherwise
 * computes it with `computeFn` (may be async) and stores the result.
 * @param {string} key
 * @param {Function} computeFn - zero-arg (possibly async) producer
 * @returns {Promise<unknown>}
 */
export async function llmCacheOrCompute(key, computeFn) {
  const hit = llmCacheGet(key);
  if (hit !== null) return hit;
  const computed = await computeFn();
  llmCacheSet(key, computed);
  return computed;
}

/** @returns {Object} snapshot of cache counters (for tests/observability). */
export function llmCacheStats() {
  const cfg = resolveConfig();
  return {
    enabled: cfg.enabled,
    entries: cacheEntries.size,
    max_entries: cfg.maxEntries,
    ttl_ms: cfg.ttlMs,
    file: cfg.file
  };
}

/** Clears all entries (used by tests). */
export function llmCacheClear() {
  cacheEntries.clear();
}
