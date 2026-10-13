import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  persistPrecedents,
  getPrecedentsSummary,
  searchPrecedents
} from '../src/modules/precedents/repositories/precedentRepositoryDb.js';
import { query, closePool } from '../src/shared/db/client.js';

function loadDatabaseUrlFromRootEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match) process.env.DATABASE_URL = match[1];
  }
}

loadDatabaseUrlFromRootEnv();
process.env.USE_DATABASE = 'true';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const pubId = `test-pub-${suffix}`;
const planId = `test-plan-${suffix}`;

function syntheticCompetitor(postHasModel) {
  return {
    competitors: [
      {
        competitor_id: `test-comp-${suffix}`,
        name: 'Test Competitor',
        platform: 'vk',
        posts: [
          {
            url: 'https://vk.com/test-post',
            content: 'Test content for DB live test.',
            metrics: { likes: 1, comments: 0 },
            publication_model: postHasModel
              ? { publication_id: pubId, platform: 'vk', text: 'Test content' }
              : null
          }
        ],
        content_plan_model: { plan_id: planId, platform: 'vk', summary: 'test plan' }
      }
    ]
  };
}

test('live persist inserts synthetic publication and plan', async () => {
  const before = await getPrecedentsSummary();
  await persistPrecedents(syntheticCompetitor(true));
  const after = await getPrecedentsSummary();
  assert.equal(after.publications_count, before.publications_count + 1);
  assert.equal(after.content_plans_count, before.content_plans_count + 1);
});

test('live re-persist is idempotent (no duplicates)', async () => {
  const before = await getPrecedentsSummary();
  await persistPrecedents(syntheticCompetitor(true));
  const after = await getPrecedentsSummary();
  assert.equal(after.publications_count, before.publications_count);
  assert.equal(after.content_plans_count, before.content_plans_count);
});

test('live persist stores record with embedding null or current-dim vector (env-agnostic)', async () => {
  const res = await query(
    'SELECT embedding IS NOT NULL AS has_embedding, COALESCE(vector_dims(embedding), 0) AS dim, COALESCE(embedding_model_version, embedding_model) AS model_version FROM publications WHERE publication_id = $1',
    [pubId]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  if (row.has_embedding) {
    assert.equal(row.dim, 1024);
    assert.ok(row.model_version);
  }
});

test('live persist with empty competitors changes nothing (negative)', async () => {
  const before = await getPrecedentsSummary();
  await persistPrecedents({ competitors: [] });
  const after = await getPrecedentsSummary();
  assert.equal(after.publications_count, before.publications_count);
  assert.equal(after.content_plans_count, before.content_plans_count);
});

test('live persist skips post without publication_model (negative)', async () => {
  const before = await getPrecedentsSummary();
  await persistPrecedents(syntheticCompetitor(false));
  const after = await getPrecedentsSummary();
  assert.equal(after.publications_count, before.publications_count);
});

test('live search with empty query returns empty result (negative)', async () => {
  const res = await searchPrecedents('   ');
  assert.equal(res.query, '');
  assert.equal(res.publications.length, 0);
  assert.equal(res.content_plans.length, 0);
});

test('cleanup removes synthetic records', async () => {
  await query('DELETE FROM publications WHERE publication_id = $1', [pubId]);
  await query('DELETE FROM content_plans WHERE plan_id = $1', [planId]);
  const pubRes = await query('SELECT COUNT(1) FROM publications WHERE publication_id = $1', [pubId]);
  const planRes = await query('SELECT COUNT(1) FROM content_plans WHERE plan_id = $1', [planId]);
  assert.equal(Number(pubRes.rows[0].count), 0);
  assert.equal(Number(planRes.rows[0].count), 0);
  await closePool();
});
