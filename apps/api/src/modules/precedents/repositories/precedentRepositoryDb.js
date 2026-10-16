import {
  cosineSimilarity,
  embedTexts,
  normalizeCosineToUnitInterval,
  buildVectorLiteral
} from '../services/embeddingService.js';
import {
  buildRagCacheKey,
  getCachedRagSearch,
  setCachedRagSearch,
  isRagCacheEnabled
} from '../services/ragQueryCacheService.js';
import {
  buildOntologyExportSheets,
  buildOntologyFromSnapshot,
  mergeOntologyWithTrustedLlmAdditions,
  serializeOntologyToTurtle
} from '../services/ontologyAggregationService.js';
import {
  buildOntologyLlmEnrichment,
  getOntologyLlmEnrichmentConfig
} from '../services/ontologyLlmEnrichmentService.js';
import { enrichSearchResultsWithReliability, precedentRankSignals } from '../services/precedentReliabilityService.js';
import { trainRelevanceModel } from '../../ml/services/relevancePredictionService.js';
import {
  query,
  withTransaction
} from '../../../shared/db/client.js';
import {
  EMBEDDING_SCHEMA_VERSION,
  DEDUP_SIMILARITY_THRESHOLD,
  DEDUP_SEMANTIC_ENABLED,
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_DYNAMIC_DELTA,
  RETRIEVAL_EMBEDDING_WEIGHT,
  RETRIEVAL_TOKEN_WEIGHT,
  createEmptyStorage,
  normalizeText,
  uniqueTokens,
  tokenize,
  collectPublicationSearchText,
  collectContentPlanSearchText,
  calculateTokenScore,
  getEmbeddingForItem,
  filterSemanticDuplicates,
  buildEmbeddingTextForPublication,
  buildEmbeddingTextForContentPlan,
  resolveFilteredCollections,
  applyRetrievalQualityGate,
  scoreRetrievalHit,
  mergeEmbeddingUpdates,
  upsertByKey,
  collectPublicationsFromCompetitors,
  collectContentPlansFromCompetitors,
  embedMissingItems,
  embedItemsWithDimensionMismatch,
  ensureEmbeddingsForSearch
} from './precedentRepositoryShared.js';

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

function dateToIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseEmbeddingValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function publicationRowToRecord(row) {
  return {
    publication_id: row.publication_id,
    competitor_id: row.competitor_id,
    competitor_name: row.competitor_name,
    platform: row.platform,
    source_url: row.source_url,
    parsed_at: dateToIso(row.parsed_at),
    collected_at: dateToIso(row.collected_at),
    publication_model: row.publication_model,
    raw_content: row.raw_content,
    raw_metrics: row.raw_metrics,
    engagement_rate: row.engagement_rate,
    content_strategy_snapshot: row.content_strategy_snapshot,
    embedding: parseEmbeddingValue(row.embedding),
    embedding_model: row.embedding_model,
    embedding_model_version: row.embedding_model_version,
    embedded_at: dateToIso(row.embedded_at),
    created_at: dateToIso(row.created_at),
    updated_at: dateToIso(row.updated_at)
  };
}

function contentPlanRowToRecord(row) {
  return {
    plan_id: row.plan_id,
    competitor_id: row.competitor_id,
    competitor_name: row.competitor_name,
    platform: row.platform,
    collected_at: dateToIso(row.collected_at),
    content_plan_model: row.content_plan_model,
    content_strategy_snapshot: row.content_strategy_snapshot,
    ontology_support: row.ontology_support,
    embedding: parseEmbeddingValue(row.embedding),
    embedding_model: row.embedding_model,
    embedding_model_version: row.embedding_model_version,
    embedded_at: dateToIso(row.embedded_at),
    created_at: dateToIso(row.created_at),
    updated_at: dateToIso(row.updated_at)
  };
}

function ingestionRunRowToRecord(row) {
  return {
    run_id: row.run_id,
    created_at: dateToIso(row.created_at),
    source: row.source,
    competitors_count: row.competitors_count,
    publications_processed: row.publications_processed,
    content_plans_processed: row.content_plans_processed,
    inserted_publications: row.inserted_publications,
    updated_publications: row.updated_publications,
    inserted_content_plans: row.inserted_content_plans,
    updated_content_plans: row.updated_content_plans,
    dedup: row.dedup_stats,
    embedding: row.embedding_stats
  };
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
    buildVectorLiteral(record.embedding),
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
    buildVectorLiteral(record.embedding),
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

async function bulkUpsert(table, keyField, columns, rows, client = null) {
  if (!rows.length) return;
  const perStatement = Math.max(1, Math.floor(2000 / columns.length));
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const built = buildBulkUpsertSql(table, keyField, columns, chunk);
    if (client) {
      await client.query(built.sql, built.params);
    } else {
      await query(built.sql, built.params);
    }
  }
}

async function readStorage() {
  const emptyStorage = createEmptyStorage();

  const [publicationsResult, contentPlansResult, runsResult, metaResult] = await Promise.all([
    query('SELECT * FROM publications ORDER BY id'),
    query('SELECT * FROM content_plans ORDER BY id'),
    query('SELECT * FROM ingestion_runs ORDER BY created_at, id'),
    query('SELECT key, value FROM precedents_metadata')
  ]);

  const metadataFromDb = {};
  metaResult.rows.forEach((row) => {
    metadataFromDb[row.key] = row.value;
  });

  return {
    metadata: {
      ...emptyStorage.metadata,
      ...metadataFromDb
    },
    ingestion_runs: runsResult.rows.map(ingestionRunRowToRecord),
    publications: publicationsResult.rows.map(publicationRowToRecord),
    content_plans: contentPlansResult.rows.map(contentPlanRowToRecord)
  };
}

async function writeStorage(storage) {
  const nextMetadata = {
    ...(storage.metadata || {}),
    schema_version: Math.max(Number(storage?.metadata?.schema_version) || 1, EMBEDDING_SCHEMA_VERSION),
    updated_at: new Date().toISOString()
  };

  const metadataRows = Object.entries(nextMetadata).map(([key, value]) => [key, JSON.stringify(value)]);

  await withTransaction(async (client) => {
    await bulkUpsert('precedents_metadata', 'key', ['key', 'value'], metadataRows, client);
    await bulkUpsert(
      'ingestion_runs',
      'run_id',
      INGESTION_RUN_COLUMNS,
      (storage.ingestion_runs || []).map(ingestionRunRecordToRow),
      client
    );
    await bulkUpsert(
      'publications',
      'publication_id',
      PUBLICATION_COLUMNS,
      (storage.publications || []).map(publicationRecordToRow),
      client
    );
    await bulkUpsert(
      'content_plans',
      'plan_id',
      CONTENT_PLAN_COLUMNS,
      (storage.content_plans || []).map(contentPlanRecordToRow),
      client
    );
  });
}

let storageMutationQueue = Promise.resolve();

function readPositiveIntLocal(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

let backgroundReembedActive = false;

/**
 * Fire-and-forget re-embed job when search finds records whose embedding
 * version differs from the current EMBEDDING_MODEL_VERSION. Guarded so only
 * one job runs at a time; failures are logged, never thrown into search.
 */
function scheduleBackgroundReembed(reason) {
  if (backgroundReembedActive) return;
  backgroundReembedActive = true;
  console.warn(
    `[precedentRepository] Stale embeddings (${reason}); scheduling background re-embed for current EMBEDDING_MODEL_VERSION`
  );
  const reset = () => {
    backgroundReembedActive = false;
  };
  reembedPrecedentsWithWrongDimension().then(reset, reset);
}

async function countStaleEmbeddings(modelVersion) {
  const sql =
    'SELECT (SELECT COUNT(1) FROM publications WHERE embedding IS NOT NULL AND COALESCE(embedding_model_version, embedding_model, \'\') <> $1) + ' +
    '(SELECT COUNT(1) FROM content_plans WHERE embedding IS NOT NULL AND COALESCE(embedding_model_version, embedding_model, \'\') <> $1)';
  const result = await query(sql, [modelVersion]);
  return Number(result.rows[0][0]) || 0;
}

/**
 * pgvector ANN (approximate nearest neighbour) candidate retrieval via HNSW
 * index: ORDER BY embedding <-> query. Falls back to exact IVF/linear inside
 * pgvector if the HNSW index is absent; caller catches hard errors and falls
 * back to the JS linear scan.
 */
async function annCandidates(table, vectorLiteral, candidateLimit) {
  const sql = `SELECT * FROM ${table} WHERE embedding IS NOT NULL ORDER BY embedding <-> $1 NULLS LAST LIMIT $2`;
  const result = await query(sql, [vectorLiteral, candidateLimit]);
  return table === 'publications'
    ? result.rows.map(publicationRowToRecord)
    : result.rows.map(contentPlanRowToRecord);
}

async function runStorageMutation(mutator) {
  const job = storageMutationQueue.then(async () => {
    const storage = await readStorage();
    const result = await mutator(storage);
    await writeStorage(storage);
    return result;
  });

  storageMutationQueue = job.then(
    () => undefined,
    () => undefined
  );

  return job;
}

/**
 * Re-embeds all precedents whose embedding dimension doesn't match the current
 * EMBEDDING_MODEL. Call before retraining when migrating (e.g. 1536 → 1024).
 * @returns {{ publications_reembedded: number, content_plans_reembedded: number, target_dim: number, embedding_model: string | null }}
 */
export async function reembedPrecedentsWithWrongDimension() {
  const probe = await embedTexts([' ']);
  const targetDim = Array.isArray(probe.embeddings?.[0]) ? probe.embeddings[0].length : null;
  if (!targetDim) {
    throw new Error('Could not determine embedding dimension from EMBEDDING_MODEL');
  }
  const currentVersion = probe.modelVersion || probe.model;

  const result = await runStorageMutation(async (storage) => {
    const pubRes = await embedItemsWithDimensionMismatch(
      storage.publications,
      buildEmbeddingTextForPublication,
      targetDim,
      currentVersion
    );
    const planRes = await embedItemsWithDimensionMismatch(
      storage.content_plans,
      buildEmbeddingTextForContentPlan,
      targetDim,
      currentVersion
    );
    return {
      publications_reembedded: pubRes.embedded_count,
      content_plans_reembedded: planRes.embedded_count,
      target_dim: targetDim,
      embedding_model: pubRes.embedding_model || planRes.embedding_model || null,
      embedding_model_version: pubRes.embedding_model_version || planRes.embedding_model_version || currentVersion || null
    };
  });

  return result;
}

export async function persistPrecedents(enrichedData, options = {}) {
  const competitors = Array.isArray(enrichedData?.competitors) ? enrichedData.competitors : [];

  const persistence = await runStorageMutation(async (storage) => {
    const publications = collectPublicationsFromCompetitors(competitors);
    const contentPlans = collectContentPlansFromCompetitors(competitors);

    let publicationsToUpsert = publications;
    let contentPlansToUpsert = contentPlans;
    let dedupStats = {
      publications_skipped_duplicates: 0,
      content_plans_skipped_duplicates: 0,
      dedup_enabled: false,
      dedup_error: null
    };

    let embeddingStats = {
      publications_embedded: 0,
      content_plans_embedded: 0,
      embedding_model: null,
      embedding_error: null
    };

    try {
      const pubStorageRes = await embedMissingItems(
        storage.publications,
        buildEmbeddingTextForPublication
      );
      const planStorageRes = await embedMissingItems(
        storage.content_plans,
        buildEmbeddingTextForContentPlan
      );
      const pubNewRes = await embedMissingItems(publications, buildEmbeddingTextForPublication);
      const planNewRes = await embedMissingItems(contentPlans, buildEmbeddingTextForContentPlan);

      embeddingStats = {
        publications_embedded:
          pubStorageRes.embedded_count + pubNewRes.embedded_count,
        content_plans_embedded:
          planStorageRes.embedded_count + planNewRes.embedded_count,
        embedding_model:
          pubStorageRes.embedding_model ||
          planStorageRes.embedding_model ||
          pubNewRes.embedding_model ||
          planNewRes.embedding_model ||
          null,
        embedding_error: null
      };

      if (DEDUP_SEMANTIC_ENABLED) {
        const pubDedup = filterSemanticDuplicates(
          publications,
          storage.publications,
          'publication_id'
        );
        publicationsToUpsert = pubDedup.filtered;
        dedupStats.publications_skipped_duplicates = pubDedup.skipped_count;

        const planDedup = filterSemanticDuplicates(contentPlans, storage.content_plans, 'plan_id');
        contentPlansToUpsert = planDedup.filtered;
        dedupStats.content_plans_skipped_duplicates = planDedup.skipped_count;
        dedupStats.dedup_enabled = true;

        if (pubDedup.skipped_count > 0 || planDedup.skipped_count > 0) {
          console.log(
            `[precedentRepository] Semantic dedup: skipped ${pubDedup.skipped_count} publications, ${planDedup.skipped_count} content plans (threshold=${DEDUP_SIMILARITY_THRESHOLD})`
          );
        }
      }
    } catch (error) {
      embeddingStats.embedding_error = error.message || 'embedding_error';
      dedupStats.dedup_error = error.message || 'embedding_failed';
      console.warn('[precedentRepository] Embedding/dedup skipped:', embeddingStats.embedding_error);
      publicationsToUpsert = publications;
      contentPlansToUpsert = contentPlans;
    }

    let insertedPublications = 0;
    let updatedPublications = 0;
    let insertedContentPlans = 0;
    let updatedContentPlans = 0;

    publicationsToUpsert.forEach((publication) => {
      const result = upsertByKey(storage.publications, publication, 'publication_id');
      if (result === 'inserted') insertedPublications += 1;
      if (result === 'updated') updatedPublications += 1;
    });

    contentPlansToUpsert.forEach((contentPlan) => {
      const result = upsertByKey(storage.content_plans, contentPlan, 'plan_id');
      if (result === 'updated') updatedContentPlans += 1;
      if (result === 'inserted') insertedContentPlans += 1;
    });

    storage.ingestion_runs.push({
      run_id: `ingest_${Date.now()}`,
      created_at: new Date().toISOString(),
      source: options.source || 'api_enrich',
      competitors_count: competitors.length,
      publications_processed: publications.length,
      content_plans_processed: contentPlans.length,
      inserted_publications: insertedPublications,
      updated_publications: updatedPublications,
      inserted_content_plans: insertedContentPlans,
      updated_content_plans: updatedContentPlans,
      dedup: dedupStats,
      embedding: embeddingStats
    });

    return {
      storage_path: 'database',
      competitors_count: competitors.length,
      publications_processed: publications.length,
      content_plans_processed: contentPlans.length,
      inserted_publications: insertedPublications,
      updated_publications: updatedPublications,
      inserted_content_plans: insertedContentPlans,
      updated_content_plans: updatedContentPlans,
      total_publications: storage.publications.length,
      total_content_plans: storage.content_plans.length,
      dedup: dedupStats,
      embedding: embeddingStats
    };
  });

  const autoTrainEnabled = process.env.ML_AUTO_TRAIN_AFTER_INGESTION !== 'false';
  const hasChanges =
    persistence.inserted_publications +
      persistence.updated_publications +
      persistence.inserted_content_plans +
      persistence.updated_content_plans >
    0;

  if (autoTrainEnabled && hasChanges) {
    try {
      await trainRelevanceModel();
    } catch (error) {
      console.warn('[ml:auto-train] Failed to retrain relevance model:', error?.message || error);
    }
  }

  return persistence;
}

export async function getPrecedentsSummary() {
  const storage = await readStorage();
  const lastRun = storage.ingestion_runs.length
    ? storage.ingestion_runs[storage.ingestion_runs.length - 1]
    : null;

  return {
    storage_path: 'database',
    schema_version: storage.metadata?.schema_version || 1,
    updated_at: storage.metadata?.updated_at || null,
    ingestion_runs_count: storage.ingestion_runs.length,
    publications_count: storage.publications.length,
    content_plans_count: storage.content_plans.length,
    last_run: lastRun
  };
}

export async function getPrecedentsSnapshot() {
  return await readStorage();
}

export async function searchPrecedents(searchQuery, options = {}) {
  const normalizedQuery = normalizeText(searchQuery);
  if (!normalizedQuery) {
    return {
      query: '',
      publications: [],
      content_plans: [],
      total_publications_searched: 0,
      total_content_plans_searched: 0
    };
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 20));

  try {
    const queryEmbeddingResult = await embedTexts([normalizedQuery]);
    const queryEmbedding = queryEmbeddingResult.embeddings[0];
    const modelVersion = queryEmbeddingResult.modelVersion || queryEmbeddingResult.model;

    const cacheKey = buildRagCacheKey(normalizedQuery, options, modelVersion, 'pg');
    if (isRagCacheEnabled()) {
      const cached = getCachedRagSearch(cacheKey);
      if (cached) return cached;
    }

    // Version guard: stale (wrong-model) vectors must not enter ANN ranking;
    // such records get re-embedded in background and this query uses linear scan.
    const staleCount = await countStaleEmbeddings(modelVersion);
    if (staleCount > 0) {
      scheduleBackgroundReembed(`${staleCount} records with stale embedding_model_version`);
    }

    let scoped = null;
    let retrievalType = null;
    let annCandidatesLimit = 0;

    if (staleCount === 0) {
      try {
        annCandidatesLimit = Math.max(200, limit * 20, readPositiveIntLocal(process.env.RAG_ANN_CANDIDATES, 0));
        const vectorLiteral = buildVectorLiteral(queryEmbedding);
        if (!vectorLiteral) throw new Error('Empty query embedding vector');
        const candidatePublications = await annCandidates('publications', vectorLiteral, annCandidatesLimit);
        const candidateContentPlans = await annCandidates('content_plans', vectorLiteral, annCandidatesLimit);
        scoped = resolveFilteredCollections(
          { publications: candidatePublications, content_plans: candidateContentPlans },
          options
        );
        retrievalType = 'pgvector_ann';
      } catch (error) {
        console.warn('[precedentRepository] ANN search failed, fallback to linear scan:', error.message);
        scoped = null;
      }
    }

    if (!scoped) {
      const storage = await readStorage();
      scoped = resolveFilteredCollections(storage, options);
      retrievalType = staleCount > 0 ? 'db_linear_version_guard' : 'embedding_cosine';

      // Доиндексируем отсутствующие эмбеддинги (лениво) и сразу пишем на диск.
      const pubEmbedStats = await ensureEmbeddingsForSearch(
        scoped.publications,
        buildEmbeddingTextForPublication
      );
      const planEmbedStats = await ensureEmbeddingsForSearch(
        scoped.content_plans,
        buildEmbeddingTextForContentPlan
      );
      if (pubEmbedStats.embedded > 0 || planEmbedStats.embedded > 0) {
        await runStorageMutation(async (latestStorage) => {
          mergeEmbeddingUpdates(latestStorage.publications, scoped.publications, 'publication_id');
          mergeEmbeddingUpdates(latestStorage.content_plans, scoped.content_plans, 'plan_id');
          return null;
        });
      }
    }

    const filteredPublications = scoped.publications;
    const filteredContentPlans = scoped.content_plans;
    const queryTokens = uniqueTokens(tokenize(normalizedQuery));

    const rankedPublications = filteredPublications
      .map((publication) => {
        const emb = getEmbeddingForItem(publication);
        const cosine = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const embeddingScore = normalizeCosineToUnitInterval(cosine);
        const tokenScore = calculateTokenScore(queryTokens, collectPublicationSearchText(publication), {
          boostExactPhrase: normalizedQuery
        });
        const rankSignals = precedentRankSignals(publication, 'publication');
        const score = scoreRetrievalHit({
          embeddingScore,
          tokenScore: tokenScore.score,
          engagementSignal: rankSignals.engagement,
          trustSignal: rankSignals.trust
        });

        return {
          type: 'publication',
          score: Number(score.toFixed(4)),
          matched_tokens: tokenScore.matched_tokens,
          data: publication
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(limit, 20));

    const rankedContentPlans = filteredContentPlans
      .map((contentPlan) => {
        const emb = getEmbeddingForItem(contentPlan);
        const cosine = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const embeddingScore = normalizeCosineToUnitInterval(cosine);
        const tokenScore = calculateTokenScore(queryTokens, collectContentPlanSearchText(contentPlan), {
          boostExactPhrase: normalizedQuery
        });
        const rankSignals = precedentRankSignals(contentPlan, 'content_plan');
        const score = scoreRetrievalHit({
          embeddingScore,
          tokenScore: tokenScore.score,
          engagementSignal: rankSignals.engagement,
          trustSignal: rankSignals.trust
        });

        return {
          type: 'content_plan',
          score: Number(score.toFixed(4)),
          matched_tokens: tokenScore.matched_tokens,
          data: contentPlan
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(limit, 20));

    const rawResult = {
      query: normalizedQuery,
      publications: applyRetrievalQualityGate(rankedPublications, limit),
      content_plans: applyRetrievalQualityGate(rankedContentPlans, limit),
      total_publications_searched: filteredPublications.length,
      total_content_plans_searched: filteredContentPlans.length,
      retrieval: {
        type: retrievalType,
        embedding_model: queryEmbeddingResult.model,
        embedding_model_version: modelVersion,
        ann_candidates: annCandidatesLimit || null,
        fallback_scope: scoped.fallback_scope,
        quality_gate: {
          min_score: RETRIEVAL_MIN_SCORE,
          dynamic_delta: RETRIEVAL_DYNAMIC_DELTA
        },
        hybrid_weights: {
          embedding: RETRIEVAL_EMBEDDING_WEIGHT,
          token: RETRIEVAL_TOKEN_WEIGHT
        }
      }
    };
    const enrichedResult = enrichSearchResultsWithReliability(rawResult);
    if (isRagCacheEnabled()) {
      setCachedRagSearch(cacheKey, enrichedResult);
    }
    return enrichedResult;
  } catch (error) {
    console.warn('[precedentRepository] Embedding search failed, fallback to token overlap:', error.message);

    const fallbackStorage = await readStorage();
    const fallbackScoped = resolveFilteredCollections(fallbackStorage, options);
    const fallbackQueryTokens = uniqueTokens(tokenize(normalizedQuery));
    const filteredPublications = fallbackScoped.publications;
    const filteredContentPlans = fallbackScoped.content_plans;

    const rankedPublications = filteredPublications
      .map((publication) => {
        const searchText = collectPublicationSearchText(publication);
        const scoreData = calculateTokenScore(fallbackQueryTokens, searchText, {
          boostExactPhrase: normalizedQuery
        });
        const rankSignals = precedentRankSignals(publication, 'publication');

        return {
          type: 'publication',
          score: scoreRetrievalHit({
            embeddingScore: 0,
            tokenScore: scoreData.score,
            engagementSignal: rankSignals.engagement,
            trustSignal: rankSignals.trust
          }),
          matched_tokens: scoreData.matched_tokens,
          data: publication
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rankedContentPlans = filteredContentPlans
      .map((contentPlan) => {
        const searchText = collectContentPlanSearchText(contentPlan);
        const scoreData = calculateTokenScore(fallbackQueryTokens, searchText, {
          boostExactPhrase: normalizedQuery
        });
        const rankSignals = precedentRankSignals(contentPlan, 'content_plan');

        return {
          type: 'content_plan',
          score: scoreRetrievalHit({
            embeddingScore: 0,
            tokenScore: scoreData.score,
            engagementSignal: rankSignals.engagement,
            trustSignal: rankSignals.trust
          }),
          matched_tokens: scoreData.matched_tokens,
          data: contentPlan
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rawResult = {
      query: normalizedQuery,
      publications: applyRetrievalQualityGate(rankedPublications, limit),
      content_plans: applyRetrievalQualityGate(rankedContentPlans, limit),
      total_publications_searched: filteredPublications.length,
      total_content_plans_searched: filteredContentPlans.length,
      retrieval: {
        type: 'token_overlap_fallback',
        error: error.message || 'embedding_failed',
        fallback_scope: fallbackScoped.fallback_scope,
        quality_gate: {
          min_score: RETRIEVAL_MIN_SCORE,
          dynamic_delta: RETRIEVAL_DYNAMIC_DELTA
        }
      }
    };
    return enrichSearchResultsWithReliability(rawResult);
  }
}

export async function getAggregatedOntology() {
  const snapshot = await readStorage();
  const baseOntology = buildOntologyFromSnapshot(snapshot);
  const config = getOntologyLlmEnrichmentConfig();
  const llmEnrichment = await buildOntologyLlmEnrichment(baseOntology.contexts, baseOntology);

  if (config.mode === 'active') {
    return mergeOntologyWithTrustedLlmAdditions(snapshot, baseOntology, llmEnrichment, {
      highConfidenceThreshold: config.highConfidenceThreshold
    });
  }

  return {
    ...baseOntology,
    llm_enrichment: {
      mode: llmEnrichment?.mode || config.mode,
      usage: llmEnrichment?.usage || null,
      metrics: llmEnrichment?.metrics || {},
      errors: llmEnrichment?.errors || []
    }
  };
}

export async function getOntologyExportData() {
  const ontology = await getAggregatedOntology();
  return buildOntologyExportSheets(ontology);
}

export async function getOntologyTurtleData() {
  const ontology = await getAggregatedOntology();
  return serializeOntologyToTurtle(ontology);
}
