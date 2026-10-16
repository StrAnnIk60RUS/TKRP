import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveDraft, loadDraft } from '../src/modules/planning/services/draftStore.js';
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

test('DB saveDraft/loadDraft round-trip for user key (positive)', async () => {
  const userId = 'test_draft_db_a';
  const ok = await saveDraft({ formData: { marker: 'DB-A' } }, userId);
  assert.equal(ok, true);
  const draft = await loadDraft(userId);
  assert.deepEqual(draft, { formData: { marker: 'DB-A' } });
  const row = await query('SELECT draft_key FROM wizard_drafts WHERE draft_key = $1', [userId]);
  assert.equal(row.rows.length, 1);
  await query('DELETE FROM wizard_drafts WHERE draft_key = $1', [userId]);
});

test('DB saveDraft overwrites same key (upsert, no duplicate rows)', async () => {
  const userId = 'test_draft_db_b';
  await saveDraft({ formData: { n: 1 } }, userId);
  await saveDraft({ formData: { n: 2 } }, userId);
  const draft = await loadDraft(userId);
  assert.deepEqual(draft, { formData: { n: 2 } });
  const rows = await query('SELECT COUNT(1) FROM wizard_drafts WHERE draft_key = $1', [userId]);
  assert.equal(Number(rows.rows[0].count), 1);
  await query('DELETE FROM wizard_drafts WHERE draft_key = $1', [userId]);
});

test('invalid userId maps to shared global DB key (negative path)', async () => {
  const escaped = await loadDraft('../escape');
  const shared = await loadDraft(null);
  assert.deepEqual(escaped, shared);
  const rows = await query('SELECT COUNT(1) FROM wizard_drafts WHERE draft_key = $1', ['global']);
  assert.equal(Number(rows.rows[0].count), 0);
});

test('loadDraft returns null for missing DB record (negative)', async () => {
  const draft = await loadDraft('test_draft_db_missing');
  assert.equal(draft, null);
});

test('DB disabled: JSON fallback path still works', async () => {
  delete process.env.USE_DATABASE;
  delete process.env.DATABASE_URL;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const draftFile = path.join(repoRoot, 'data', 'runtime', 'api', 'drafts', 'test_draft_db_json.json');
  const ok = await saveDraft({ formData: { via: 'json' } }, 'test_draft_db_json');
  assert.equal(ok, true);
  const draft = await loadDraft('test_draft_db_json');
  assert.deepEqual(draft, { formData: { via: 'json' } });
  await fs.promises.rm(draftFile, { force: true });
});

test('cleanup leaves no DB artifacts', async () => {
  loadDatabaseUrlFromRootEnv();
  process.env.USE_DATABASE = 'true';
  const rows = await query(
    'SELECT COUNT(1) FROM wizard_drafts WHERE draft_key IN ($1, $2, $3)',
    ['test_draft_db_a', 'test_draft_db_b', 'global']
  );
  assert.equal(Number(rows.rows[0].count), 0);
  await closePool();
});
