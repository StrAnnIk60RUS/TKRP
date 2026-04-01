import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
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

export async function saveSnapshot(plan, optimization = null, token = null) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Некорректный план для сохранения snapshot');
  }

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

  await ensureSnapshotDir();
  await writeFile(buildSnapshotPath(nextToken), JSON.stringify(payload, null, 2), 'utf-8');

  return {
    token: nextToken,
    saved_at: payload.saved_at,
    summary: payload.summary
  };
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

/** @returns {{ ok: true } | { ok: false, reason: 'invalid_token' }} */
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
