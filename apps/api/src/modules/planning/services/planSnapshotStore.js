import { mkdir, readFile, readdir, unlink, writeFile, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { normalizePlanPublicationsFields } from '../routes/shared/planUtils.js';
import { recordStorageSample, recordStorageError } from '../../../shared/runtime/storageMetrics.js';
import { isDatabaseEnabled, query } from '../../../shared/db/client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'data',
  'runtime',
  'api',
  'plan-snapshots'
);

function isValidToken(token) {
  return typeof token === 'string' && /^[a-zA-Z0-9_-]{10,128}$/.test(token);
}

async function ensureSnapshotDir() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
}

function buildSnapshotPath(token) {
  return join(SNAPSHOT_DIR, `${token}.json`);
}

function snapshotDisplayName(plan) {
  const raw = plan?.display_name;
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, 120);
  return t || null;
}

function buildSnapshotSummary(plan, optimization = null) {
  const publications = Array.isArray(plan?.publications) ? plan.publications : [];
  const formats = Array.from(new Set(publications.map((item) => item?.format).filter(Boolean)));
  return {
    plan_id: plan?.plan_id || 'unknown',
    display_name: snapshotDisplayName(plan),
    publications_count: publications.length,
    platforms: Array.isArray(plan?.platforms) ? plan.platforms : [],
    start_date: plan?.planning_horizon?.start_date || null,
    end_date: plan?.planning_horizon?.end_date || null,
    formats,
    avg_engagement_rate: plan?.kpi_targets?.avg_engagement_rate ?? null,
    estimated_conversions: plan?.kpi_targets?.estimated_conversions ?? null,
    has_notes: Boolean(plan?.notes),
    optimization_valid: optimization?.stage2?.constraints_check?.valid ?? null,
    optimization_messages: Array.isArray(optimization?.stage2?.constraints_check?.messages)
      ? optimization.stage2.constraints_check.messages
      : null
  };
}

function readPositiveIntEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const DEFAULT_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function snapshotExpiredAt(savedAtIso) {
  const ttlMs = readPositiveIntEnv('PLAN_SNAPSHOT_TTL_MS', DEFAULT_SNAPSHOT_TTL_MS);
  const savedAt = Date.parse(String(savedAtIso || ''));
  if (!Number.isFinite(savedAt)) return false;
  return Date.now() - savedAt > ttlMs;
}

// Per-token lock chain: concurrent writes to the same snapshot never overlap.
const lockChains = new Map();

async function withKeyLock(key, fn) {
  const previous = lockChains.get(key) ?? Promise.resolve();
  const current = previous.then(fn).catch(() => undefined);
  lockChains.set(key, current);
  current.then(() => {
    if (lockChains.get(key) === current) lockChains.delete(key);
  });
  await current;
}

async function atomicWriteFile(file, contents) {
  const tmpPath = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, contents, 'utf-8');
    await rename(tmpPath, file);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      /* tmp cleanup is best-effort */
    }
    throw err;
  }
}

function snapshotTtlMs() {
  return readPositiveIntEnv('PLAN_SNAPSHOT_TTL_MS', DEFAULT_SNAPSHOT_TTL_MS);
}

function isoDateValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? null : String(value);
}

async function dbSaveSnapshot(payload) {
  await query(
    'INSERT INTO plan_snapshots (token, owner, saved_at, snapshot, summary) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (token) DO UPDATE SET owner = EXCLUDED.owner, saved_at = EXCLUDED.saved_at, snapshot = EXCLUDED.snapshot, summary = EXCLUDED.summary',
    [payload.token, payload.owner, payload.saved_at, payload.snapshot, payload.summary]
  );
}

async function dbSweepExpiredSnapshots() {
  const cutoff = new Date(Date.now() - snapshotTtlMs()).toISOString();
  await query('DELETE FROM plan_snapshots WHERE saved_at < $1', [cutoff]);
}

async function dbDeleteSnapshot(token) {
  await query('DELETE FROM plan_snapshots WHERE token = $1', [token]);
}

async function dbLoadSnapshot(token) {
  const res = await query(
    'SELECT token, owner, saved_at, snapshot, summary FROM plan_snapshots WHERE token = $1',
    [token]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const savedAt = isoDateValue(row.saved_at);
  const snapshot = row.snapshot || {};
  if (!snapshot.plan || typeof snapshot.plan !== 'object') return null;
  if (snapshotExpiredAt(savedAt)) {
    await dbDeleteSnapshot(token);
    return null;
  }
  const optimization = snapshot.optimization || null;
  const baseSummary = row.summary || buildSnapshotSummary(snapshot.plan, optimization);
  return {
    token,
    saved_at: savedAt,
    owner: row.owner ?? null,
    summary: {
      ...baseSummary,
      display_name: snapshotDisplayName(snapshot.plan)
    },
    plan: snapshot.plan,
    optimization
  };
}

async function dbListSnapshots(max, owner = null) {
  const cutoff = new Date(Date.now() - snapshotTtlMs()).toISOString();
  let res;
  if (owner !== null && owner !== undefined) {
    res = await query(
      'SELECT token, saved_at, summary FROM plan_snapshots WHERE saved_at >= $1 AND owner = $2 ORDER BY saved_at DESC LIMIT $3',
      [cutoff, String(owner), max]
    );
  } else {
    res = await query(
      'SELECT token, saved_at, summary FROM plan_snapshots WHERE saved_at >= $1 ORDER BY saved_at DESC LIMIT $2',
      [cutoff, max]
    );
  }
  const entries = [];
  for (const row of res.rows) {
    const token = row.token;
    if (!isValidToken(token)) continue;
    const summary = row.summary || {};
    entries.push({
      token,
      saved_at: isoDateValue(row.saved_at),
      plan_id: summary.plan_id || null,
      publications_count: summary.publications_count ?? null,
      display_name: summary.display_name || null,
      summary
    });
  }
  return entries;
}

async function sweepExpiredSnapshots() {
  let names;
  try {
    names = await readdir(SNAPSHOT_DIR);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const token = name.replace(/\.json$/, '');
    if (!isValidToken(token)) continue;
    try {
      const raw = await readFile(buildSnapshotPath(token), 'utf-8');
      const parsed = JSON.parse(raw);
      if (!snapshotExpiredAt(parsed?.saved_at)) continue;
      await unlink(buildSnapshotPath(token));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.error('Ошибка sweep expired snapshot плана:', error.message || error);
      }
    }
  }
}

export async function saveSnapshot(plan, optimization = null, token = null, owner = null) {
  const started = Date.now();
  if (!plan || typeof plan !== 'object') {
    throw new Error('Некорректный план для сохранения snapshot');
  }

  const planToStore = {
    ...plan,
    publications: normalizePlanPublicationsFields(Array.isArray(plan.publications) ? plan.publications : [])
  };

  const nextToken = isValidToken(token)
    ? token
    : crypto.randomUUID().replace(/-/g, '');

  const payload = {
    token: nextToken,
    saved_at: new Date().toISOString(),
    owner: owner === null || owner === undefined ? null : String(owner),
    snapshot: {
      plan: planToStore,
      optimization: optimization || null
    },
    summary: buildSnapshotSummary(planToStore, optimization)
  };

  const jsonBody = JSON.stringify(payload, null, 2);
  const maxPayloadBytes = readPositiveIntEnv('PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD_BYTES);
  if (Buffer.byteLength(jsonBody, 'utf8') > maxPayloadBytes) {
    const err = new Error('Снимок плана превышает лимит PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES');
    err.code = 'PLAN_SNAPSHOT_TOO_LARGE';
    throw err;
  }

  if (isDatabaseEnabled()) {
    try {
      await withKeyLock(`db:${nextToken}`, async () => {
        await dbSaveSnapshot(payload);
      });
      await dbSweepExpiredSnapshots();
      recordStorageSample('snapshot.save', Date.now() - started);
      return {
        token: nextToken,
        saved_at: payload.saved_at,
        summary: payload.summary
      };
    } catch (error) {
      recordStorageError('snapshot.save');
      console.warn('Ошибка saving snapshot to DB, fallback JSON:', error.message || error);
    }
  }

  await ensureSnapshotDir();
  await withKeyLock(nextToken, async () => {
    await atomicWriteFile(buildSnapshotPath(nextToken), jsonBody);
  });
  await sweepExpiredSnapshots();

  recordStorageSample('snapshot.save', Date.now() - started);
  return {
    token: nextToken,
    saved_at: payload.saved_at,
    summary: payload.summary
  };
}

export async function loadSnapshot(token) {
  if (!isValidToken(token)) return null;
  const started = Date.now();
  if (isDatabaseEnabled()) {
    try {
      const loaded = await dbLoadSnapshot(token);
      if (loaded) {
        recordStorageSample('snapshot.load', Date.now() - started);
        return loaded;
      }
      // DB has no record for this token: fall through to JSON for back-compat.
    } catch (error) {
      recordStorageError('snapshot.load');
      console.warn('Ошибка loading snapshot from DB, fallback JSON:', error.message || error);
    }
  }
  try {
    const raw = await readFile(buildSnapshotPath(token), 'utf-8');
    const parsed = JSON.parse(raw);
    const snapshot = parsed?.snapshot || {};
    if (!snapshot?.plan || typeof snapshot.plan !== 'object') return null;
    if (snapshotExpiredAt(parsed?.saved_at)) {
      try {
        await unlink(buildSnapshotPath(token));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      return null;
    }
    const baseSummary =
      parsed?.summary || buildSnapshotSummary(snapshot.plan, snapshot.optimization || null);
    recordStorageSample('snapshot.load', Date.now() - started);
    return {
      token,
      saved_at: parsed?.saved_at || null,
      owner: parsed?.owner ?? null,
      summary: {
        ...baseSummary,
        display_name: snapshotDisplayName(snapshot.plan)
      },
      plan: snapshot.plan,
      optimization: snapshot.optimization || null
    };
  } catch (error) {
    recordStorageError('snapshot.load');
    if (error?.code === 'ENOENT') return null;
    console.error('Ошибка загрузки snapshot плана:', error.message || error);
    return null;
  }
}

/** @returns {{ ok: true } | { ok: false, reason: 'invalid_token' }} */
export async function deleteSnapshot(token) {
  if (!isValidToken(token)) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (isDatabaseEnabled()) {
    try {
      await dbDeleteSnapshot(token);
    } catch (error) {
      console.warn('Ошибка deleting snapshot from DB, fallback JSON:', error.message || error);
    }
  }
  try {
    await unlink(buildSnapshotPath(token));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return { ok: true };
}

/**
  * Lists saved plan snapshots sorted by saved_at descending.
  * @param {number} limit - max entries to return
  * @returns {Promise<Array<{ token, saved_at, plan_id, publications_count }>>}
  */
export async function listSnapshots(limit = 50, owner = null) {
  const max = Math.max(0, Math.floor(Number(limit)));
  if (max === 0) return [];
  if (isDatabaseEnabled()) {
    try {
      await dbSweepExpiredSnapshots();
      return dbListSnapshots(max, owner);
    } catch (error) {
      console.warn('Ошибка listing snapshots from DB, fallback JSON:', error.message || error);
    }
  }
  await sweepExpiredSnapshots();
  let names;
  try {
    names = await readdir(SNAPSHOT_DIR);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(buildSnapshotPath(name.replace(/\.json$/, '')), 'utf-8');
      const parsed = JSON.parse(raw);
      const token = parsed?.token || name.replace(/\.json$/, '');
      if (!isValidToken(token)) continue;
      if (owner !== null && owner !== undefined && String(parsed?.owner ?? '') !== String(owner)) continue;
      if (snapshotExpiredAt(parsed?.saved_at)) continue;
      entries.push({
        token,
        saved_at: parsed?.saved_at || null,
        plan_id: parsed?.summary?.plan_id || parsed?.snapshot?.plan?.plan_id || null,
        publications_count: parsed?.summary?.publications_count ?? null,
        display_name: parsed?.summary?.display_name || snapshotDisplayName(parsed?.snapshot?.plan) || null,
        summary: parsed?.summary || null
      });
    } catch (error) {
      console.error('Ошибка listing snapshot плана:', error.message || error);
    }
  }
  entries.sort((left, right) => String(right.saved_at || '').localeCompare(String(left.saved_at || '')));
  return entries.slice(0, max);
}
