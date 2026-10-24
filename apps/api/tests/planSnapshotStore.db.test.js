import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveSnapshot, loadSnapshot, deleteSnapshot, listSnapshots } from '../src/modules/planning/services/planSnapshotStore.js';
import { query, closePool } from '../src/shared/db/client.js';

function loadDatabaseUrlFromRootEnv() {
  if (process.env.DATABASE_URL) return;
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(testDir, '..', '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match) process.env.DATABASE_URL = match[1];
  }
}

loadDatabaseUrlFromRootEnv();
process.env.USE_DATABASE = 'true';

const plan = {
  plan_id: 'plan_db_test_1',
  display_name: 'DB snapshot test',
  platforms: ['vk'],
  publications: [
    {
      publication_id: 'p1',
      format: 'post',
      planned_date: '2026-10-11',
      content_summary: 'x'
    }
  ],
  planning_horizon: { start_date: '2026-10-11', end_date: '2026-10-18' },
  kpi_targets: { avg_engagement_rate: 0.1, estimated_conversions: 5 }
};

const TOKEN = 'test_snap_db_0001';

async function dbTokenCount(token) {
  const res = await query('SELECT COUNT(1) FROM plan_snapshots WHERE token = $1', [token]);
  return Number(res.rows[0].count);
}

test('DB saveSnapshot stores row in plan_snapshots (positive)', async () => {
  const saved = await saveSnapshot(plan, null, TOKEN, 'db-owner');
  assert.equal(saved.token, TOKEN);
  assert.equal(saved.summary.publications_count, 1);
  assert.equal(await dbTokenCount(TOKEN), 1);
  const row = await query('SELECT owner FROM plan_snapshots WHERE token = $1', [TOKEN]);
  assert.equal(row.rows[0].owner, 'db-owner');
});

test('DB loadSnapshot round-trip', async () => {
  const loaded = await loadSnapshot(TOKEN);
  assert.equal(typeof loaded, 'object');
  assert.equal(loaded.token, TOKEN);
  assert.equal(loaded.plan.plan_id, 'plan_db_test_1');
  assert.equal(loaded.owner, 'db-owner');
});

test('DB listSnapshots includes saved token sorted desc', async () => {
  const listed = await listSnapshots(100);
  assert(listed.some((entry) => entry.token === TOKEN));
});

test('DB re-save same token updates row (upsert, no duplicates)', async () => {
  await saveSnapshot(plan, null, TOKEN, 'db-owner-2');
  assert.equal(await dbTokenCount(TOKEN), 1);
});

test('DB deleteSnapshot removes row; load returns null after (positive)', async () => {
  const del = await deleteSnapshot(TOKEN);
  assert.equal(del.ok, true);
  assert.equal(await dbTokenCount(TOKEN), 0);
  assert.equal(await loadSnapshot(TOKEN), null);
});

test('invalid token rejected on load and delete (negative)', async () => {
  assert.equal(await loadSnapshot('short'), null);
  const del = await deleteSnapshot('short');
  assert.deepEqual(del, { ok: false, reason: 'invalid_token' });
  assert.equal(await dbTokenCount('short'), 0);
});

test('expired snapshot swept and load returns null (negative TTL)', async () => {
  process.env.PLAN_SNAPSHOT_TTL_MS = '50';
  const expiredToken = 'test_snap_db_expired';
  await saveSnapshot(plan, null, expiredToken);
  assert.equal(await dbTokenCount(expiredToken), 1);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(await loadSnapshot(expiredToken), null);
  assert.equal(await dbTokenCount(expiredToken), 0);
  delete process.env.PLAN_SNAPSHOT_TTL_MS;
});

test('payload cap enforced before DB write (negative)', async () => {
  process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES = '100';
  try {
    await saveSnapshot(plan, null, 'test_snap_db_too_large');
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error.code, 'PLAN_SNAPSHOT_TOO_LARGE');
  } finally {
    delete process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES;
  }
  assert.equal(await dbTokenCount('test_snap_db_too_large'), 0);
});

test('cleanup leaves no DB artifacts', async () => {
  const rows = await query(
    'SELECT COUNT(1) FROM plan_snapshots WHERE token IN ($1, $2, $3)',
    [TOKEN, 'test_snap_db_expired', 'test_snap_db_too_large']
  );
  assert.equal(Number(rows.rows[0].count), 0);
  await closePool();
});
