import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

function parseEnvPositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPlanSnapshotRetentionConfig() {
  return {
    maxFiles: parseEnvPositiveInt(process.env.PLAN_SNAPSHOT_MAX_FILES, DEFAULT_MAX_FILES),
    maxPayloadBytes: parseEnvPositiveInt(
      process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES,
      DEFAULT_MAX_PAYLOAD_BYTES
    )
  };
}

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

function utf8JsonFileBytes(payload) {
  const text = JSON.stringify(payload, null, 2);
  return Buffer.byteLength(text, 'utf8');
}

async function pruneSnapshotsBeyondLimit(maxKeep) {
  const items = await listSnapshots();
  if (items.length <= maxKeep) return { removed: 0 };
  const victims = items.slice(maxKeep);
  let removed = 0;
  for (const item of victims) {
    const r = await deleteSnapshot(item.token);
    if (r.ok) removed += 1;
  }
  return { removed };
}

export async function runPlanSnapshotRetention() {
  const { maxFiles } = getPlanSnapshotRetentionConfig();
  return pruneSnapshotsBeyondLimit(maxFiles);
}

export async function saveSnapshot(plan, optimization = null, token = null) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Некорректный план для сохранения snapshot');
  }

  const { maxFiles, maxPayloadBytes } = getPlanSnapshotRetentionConfig();

  const nextToken = isValidToken(token)
    ? token
    : crypto.randomUUID().replace(/-/g, '');

  const payload = {
    token: nextToken,
    saved_at: new Date().toISOString(),
    snapshot: {
      plan,
      optimization: optimization || null
    },
    summary: buildSnapshotSummary(plan, optimization)
  };

  const bytes = utf8JsonFileBytes(payload);
  if (bytes > maxPayloadBytes) {
    const err = new Error(
      `Снимок плана превышает лимит размера (${bytes} байт > ${maxPayloadBytes}). Упростите план или увеличьте PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES.`
    );
    err.code = 'PLAN_SNAPSHOT_TOO_LARGE';
    throw err;
  }

  await ensureSnapshotDir();
  await writeFile(buildSnapshotPath(nextToken), JSON.stringify(payload, null, 2), 'utf-8');

  await pruneSnapshotsBeyondLimit(maxFiles);

  return {
    token: nextToken,
    saved_at: payload.saved_at,
    summary: payload.summary
  };
}

export async function listSnapshots() {
  await ensureSnapshotDir();
  let names = [];
  try {
    names = await readdir(SNAPSHOT_DIR);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const jsonFiles = names.filter((name) => name.endsWith('.json'));
  const items = [];

  for (const name of jsonFiles) {
    const token = name.slice(0, -'.json'.length);
    if (!isValidToken(token)) continue;
    try {
      const raw = await readFile(join(SNAPSHOT_DIR, name), 'utf-8');
      const parsed = JSON.parse(raw);
      const snapshot = parsed?.snapshot || {};
      const plan = snapshot?.plan;
      if (!plan || typeof plan !== 'object') continue;
      const baseSummary =
        parsed?.summary || buildSnapshotSummary(plan, snapshot.optimization || null);
      items.push({
        token,
        saved_at: typeof parsed?.saved_at === 'string' ? parsed.saved_at : null,
        summary: {
          ...baseSummary,
          display_name: snapshotDisplayName(plan)
        }
      });
    } catch {
      // skip unreadable or invalid files
    }
  }

  items.sort((a, b) => {
    const ta = a.saved_at ? Date.parse(a.saved_at) : 0;
    const tb = b.saved_at ? Date.parse(b.saved_at) : 0;
    return tb - ta;
  });

  return items;
}

export async function loadSnapshot(token) {
  if (!isValidToken(token)) return null;
  try {
    const raw = await readFile(buildSnapshotPath(token), 'utf-8');
    const parsed = JSON.parse(raw);
    const snapshot = parsed?.snapshot || {};
    if (!snapshot?.plan || typeof snapshot.plan !== 'object') return null;
    const baseSummary =
      parsed?.summary || buildSnapshotSummary(snapshot.plan, snapshot.optimization || null);
    return {
      token,
      saved_at: parsed?.saved_at || null,
      summary: {
        ...baseSummary,
        display_name: snapshotDisplayName(snapshot.plan)
      },
      plan: snapshot.plan,
      optimization: snapshot.optimization || null
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    console.error('Ошибка загрузки snapshot плана:', error.message || error);
    return null;
  }
}

export async function deleteSnapshot(token) {
  if (!isValidToken(token)) {
    return { ok: false, reason: 'invalid_token' };
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
