import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isDatabaseEnabled, getPool, query, withTransaction, closePool } from '../src/shared/db/client.js';

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

test('isDatabaseEnabled false when DATABASE_URL missing', () => {
  delete process.env.DATABASE_URL;
  assert.equal(isDatabaseEnabled(), false);
});

test('isDatabaseEnabled true with PRECEDENT_STORAGE=pg', () => {
  process.env.DATABASE_URL = 'postgresql://x/y';
  process.env.PRECEDENT_STORAGE = 'pg';
  assert.equal(isDatabaseEnabled(), true);
  delete process.env.PRECEDENT_STORAGE;
});

test('isDatabaseEnabled true with USE_DATABASE=true', () => {
  process.env.PRECEDENT_STORAGE = 'json';
  process.env.USE_DATABASE = 'true';
  assert.equal(isDatabaseEnabled(), true);
  delete process.env.PRECEDENT_STORAGE;
});

test('isDatabaseEnabled true with APP_ENV=production', () => {
  delete process.env.USE_DATABASE;
  process.env.APP_ENV = 'production';
  assert.equal(isDatabaseEnabled(), true);
  delete process.env.APP_ENV;
});

test('isDatabaseEnabled false with USE_DATABASE=false (negative)', () => {
  process.env.USE_DATABASE = 'false';
  delete process.env.APP_ENV;
  delete process.env.PRECEDENT_STORAGE;
  assert.equal(isDatabaseEnabled(), false);
});

test('getPool throws when database disabled (negative)', () => {
  delete process.env.USE_DATABASE;
  delete process.env.DATABASE_URL;
  try {
    getPool();
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /DATABASE_URL/);
  }
});

test('closePool is idempotent when pool never created', async () => {
  await closePool();
});

test('query fails on unreachable DATABASE_URL (negative)', async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.USE_DATABASE = 'true';
  process.env.DATABASE_URL = 'postgresql://postgres:300725@127.0.0.1:59999/tkrp';
  try {
    await query('SELECT 1');
    assert.fail('expected connection error');
  } catch (error) {
    assert.match(error.message, /connect|ECONNREFUSED|Unable to connect/i);
  } finally {
    if (previousUrl) process.env.DATABASE_URL = previousUrl;
    else delete process.env.DATABASE_URL;
    await closePool();
  }
});

test('live SELECT roundtrip with params', async () => {
  loadDatabaseUrlFromRootEnv();
  process.env.USE_DATABASE = 'true';
  const res = await query('SELECT $1 AS value, $2 AS label', [41, 'tkrp']);
  assert.equal(Number(res.rows[0].value), 41);
  assert.equal(res.rows[0].label, 'tkrp');
});

test('live withTransaction commits mutation', async () => {
  const marker = `__dbtest_commit_${Date.now()}`;
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO precedents_metadata VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [marker, JSON.stringify({ ok: true })]
    );
  });
  const res = await query('SELECT value FROM precedents_metadata WHERE key = $1', [marker]);
  assert.equal(res.rows.length, 1);
  await query('DELETE FROM precedents_metadata WHERE key = $1', [marker]);
});

test('live withTransaction rolls back on throw (negative)', async () => {
  const marker = `__dbtest_rollback_${Date.now()}`;
  try {
    await withTransaction(async (client) => {
      await client.query(
        'INSERT INTO precedents_metadata VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [marker, JSON.stringify({ ok: true })]
      );
      throw new Error('abort');
    });
  } catch (error) {
    assert.match(error.message, /abort/);
  }
  const res = await query('SELECT COUNT(1) FROM precedents_metadata WHERE key = $1', [marker]);
  assert.equal(Number(res.rows[0].count), 0);
  await closePool();
});
