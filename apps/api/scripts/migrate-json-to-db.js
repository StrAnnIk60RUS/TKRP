import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PRECEDENTS = path.resolve(__dirname, '..', '..', '..', 'data', 'precedents');

const PUBLICATION_COLUMNS = [
  'publication_id',
  'competitor_id',
  'competitor_name',
  'platform',
  'source_url',
  'parsed_at',
  'collected_at',
  'publication_model',
  'raw_content',
  'raw_metrics',
  'engagement_rate',
  'content_strategy_snapshot',
  'embedding',
  'embedding_model',
  'embedding_model_version',
  'embedded_at',
  'created_at',
  'updated_at'
];

const CONTENT_PLAN_COLUMNS = [
  'plan_id',
  'competitor_id',
  'competitor_name',
  'platform',
  'collected_at',
  'content_plan_model',
  'content_strategy_snapshot',
  'ontology_support',
  'embedding',
  'embedding_model',
  'embedding_model_version',
  'embedded_at',
  'created_at',
  'updated_at'
];

const INGESTION_RUN_COLUMNS = [
  'run_id',
  'created_at',
  'source',
  'competitors_count',
  'publications_processed',
  'content_plans_processed',
  'inserted_publications',
  'updated_publications',
  'inserted_content_plans',
  'updated_content_plans',
  'dedup_stats',
  'embedding_stats'
];

function resolveDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  try {
    const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
    const content = fs.readFileSync(envFile, 'utf-8');
    const match = content.match(/^DATABASE_URL=(.*)$/m);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    // ignore
  }
  throw new Error('DATABASE_URL не задан (env или .env в корне репозитория)');
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn('[migrate-json-to-db] Failed to read JSON:', filePath, error?.message || error);
    return fallback;
  }
}

function toVectorLiteral(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((item) => {
    const numeric = Number(item);
    return Number.isFinite(numeric) ? numeric : 0;
  });
  return `[${parts.join(',')}]`;
}

function publicationRecordToRow(record) {
  return [
    record.publication_id,
    record.competitor_id,
    record.competitor_name,
    record.platform,
    record.source_url,
    record.parsed_at,
    record.collected_at,
    record.publication_model,
    record.raw_content,
    record.raw_metrics,
    record.engagement_rate,
    record.content_strategy_snapshot,
    toVectorLiteral(record.embedding),
    record.embedding_model,
    record.embedding_model_version || record.embedding_model || null,
    record.embedded_at,
    record.created_at || record.updated_at,
    record.updated_at
  ];
}

function contentPlanRecordToRow(record) {
  return [
    record.plan_id,
    record.competitor_id,
    record.competitor_name,
    record.platform,
    record.collected_at,
    record.content_plan_model,
    record.content_strategy_snapshot,
    record.ontology_support,
    toVectorLiteral(record.embedding),
    record.embedding_model,
    record.embedding_model_version || record.embedding_model || null,
    record.embedded_at,
    record.created_at || record.updated_at,
    record.updated_at
  ];
}

function ingestionRunRecordToRow(record) {
  return [
    record.run_id,
    record.created_at,
    record.source,
    record.competitors_count,
    record.publications_processed,
    record.content_plans_processed,
    record.inserted_publications,
    record.updated_publications,
    record.inserted_content_plans,
    record.updated_content_plans,
    record.dedup,
    record.embedding
  ];
}

function buildBulkUpsertSql(table, keyField, columns, rows) {
  if (!rows.length) return null;
  const parts = [];
  let paramIndex = 1;
  const valuesChunks = [];

  for (const row of rows) {
    const placeholders = columns.map(() => `$${paramIndex++}`);
    valuesChunks.push(`(${placeholders.join(', ')})`);
    parts.push(...row);
  }

  const updateSet = columns
    .filter((column) => column !== keyField)
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');

  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesChunks.join(', ')} ON CONFLICT (${keyField}) DO UPDATE SET ${updateSet}`;
  return { sql, params: parts };
}

async function bulkUpsert(pool, table, keyField, columns, recordsToRow, records) {
  const rows = records.map(recordsToRow);
  const perStatement = Math.max(1, Math.floor(2000 / columns.length));
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const built = buildBulkUpsertSql(table, keyField, columns, chunk);
    await pool.query(built.sql, built.params);
  }
  return rows.length;
}

async function main() {
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(), max: 1 });
  try {
    const publications = readJson(path.join(DATA_PRECEDENTS, 'publications.json'), []);
    const contentPlans = readJson(path.join(DATA_PRECEDENTS, 'content_plans.json'), []);
    const ingestionRuns = readJson(path.join(DATA_PRECEDENTS, 'ingestion_runs.json'), []);
    const metadata = readJson(path.join(DATA_PRECEDENTS, 'metadata.json'), {});

    const metadataRows = Object.entries(metadata).map(([key, value]) => ({ key, value }));

    const publicationsCount = await bulkUpsert(
      pool,
      'publications',
      'publication_id',
      PUBLICATION_COLUMNS,
      publicationRecordToRow,
      publications
    );
    const contentPlansCount = await bulkUpsert(
      pool,
      'content_plans',
      'plan_id',
      CONTENT_PLAN_COLUMNS,
      contentPlanRecordToRow,
      contentPlans
    );
    const runsCount = await bulkUpsert(
      pool,
      'ingestion_runs',
      'run_id',
      INGESTION_RUN_COLUMNS,
      ingestionRunRecordToRow,
      ingestionRuns
    );
    const metadataCount = await bulkUpsert(
      pool,
      'precedents_metadata',
      'key',
      ['key', 'value'],
      (record) => [record.key, JSON.stringify(record.value)],
      metadataRows
    );

    const dbCounts = {
      publications: (await pool.query('SELECT COUNT(1) FROM publications')).rows[0].count,
      content_plans: (await pool.query('SELECT COUNT(1) FROM content_plans')).rows[0].count,
      ingestion_runs: (await pool.query('SELECT COUNT(1) FROM ingestion_runs')).rows[0].count
    };

    console.log('JSON -> DB миграция завершена:');
    console.log(`  publications: JSON=${publications.length} DB=${dbCounts.publications} (upserted=${publicationsCount})`);
    console.log(`  content_plans: JSON=${contentPlans.length} DB=${dbCounts.content_plans} (upserted=${contentPlansCount})`);
    console.log(`  ingestion_runs: JSON=${ingestionRuns.length} DB=${dbCounts.ingestion_runs} (upserted=${runsCount})`);
    console.log(`  metadata keys: JSON=${metadataRows.length} (upserted=${metadataCount})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка JSON->DB миграции:', error.message || error);
  process.exit(1);
});
