import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migrationsDir = path.join(repoRoot, 'apps', 'api', 'migrations');
const applyScript = path.join(repoRoot, 'apps', 'api', 'scripts', 'apply-migrations.js');

test('apply-migrations run on applied DB is idempotent (positive)', (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  const run = spawnSync(process.execPath, [applyScript], { cwd: repoRoot, encoding: 'utf-8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Все миграции применены/);
  assert.match(run.stdout, /уже применена/);
});

test('apply-migrations fails on unreachable DATABASE_URL (negative)', () => {
  const run = spawnSync(process.execPath, [applyScript], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: { ...process.env, DATABASE_URL: 'postgresql://postgres:300725@127.0.0.1:59999/tkrp' }
  });
  assert.notEqual(run.status, 0);
  assert.match(`${run.stderr}\n${run.stdout}`, /Ошибка применения миграций|unable to connect|ECONNREFUSED|connection/i);
});

test('schema_migrations covers every .sql file in migrations dir', async (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  process.env.USE_DATABASE = 'true';
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const res = await query('SELECT name FROM schema_migrations');
  const applied = new Set(res.rows.map((row) => row.name));
  for (const file of files) {
    assert.ok(applied.has(file), `migration ${file} not recorded in schema_migrations`);
  }
});

test('publications embedding column is vector(1024) with data', async (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  const res = await query(
    'SELECT COALESCE(vector_dims(embedding), 0) AS dim FROM publications WHERE embedding IS NOT NULL LIMIT 1'
  );
  assert.ok(res.rows.length > 0, 'no embeddings in DB');
  assert.equal(Number(res.rows[0].dim), 1024);
});

test('pgvector ANN cosine query works on publications (positive)', async (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  const vectorLiteral = `[${Array(Array(1024).fill(0.1)).join(',')}]`;
  const res = await query(
    'SELECT publication_id FROM publications WHERE embedding IS NOT NULL ORDER BY embedding <-> $1 NULLS LAST LIMIT 1',
    [vectorLiteral]
  );
  assert.equal(res.rows.length, 1);
  assert.ok(res.rows[0].publication_id);
});

test('DB backend tables wizard_drafts + plan_snapshots exist (migration 004)', async (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  const drafts = await query('SELECT draft_key FROM wizard_drafts LIMIT 0');
  assert.equal(drafts.rows.length, 0);
  const snapshots = await query('SELECT token FROM plan_snapshots LIMIT 0');
  assert.equal(snapshots.rows.length, 0);
  await closePool();
});

test('missing migration file would be picked up (negative: unknown name not recorded)', async (t) => {
  loadDatabaseUrlFromRootEnv();
  if (!process.env.DATABASE_URL) {
    t.skip('Пропуск: DATABASE_URL не задан');
    return;
  }
  process.env.USE_DATABASE = 'true';
  const res = await query('SELECT name FROM schema_migrations WHERE name = $1', ['999_nonexistent.sql']);
  assert.equal(res.rows.length, 0);
  await closePool();
});
