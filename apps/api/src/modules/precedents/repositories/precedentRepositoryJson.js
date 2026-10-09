import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cosineSimilarity,
  embedTexts,
  normalizeCosineToUnitInterval
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
import { enrichSearchResultsWithReliability } from '../services/precedentReliabilityService.js';
import { trainRelevanceModel } from '../../ml/services/relevancePredictionService.js';
import {
  EMBEDDING_SCHEMA_VERSION,
  DEDUP_SIMILARITY_THRESHOLD,
  DEDUP_SEMANTIC_ENABLED,
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_DYNAMIC_DELTA,
  RETRIEVAL_EMBEDDING_WEIGHT,
  RETRIEVAL_TOKEN_WEIGHT,
  createEmptyStorage,
  splitSnapshotToCollections,
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
  mergeEmbeddingUpdates,
  upsertByKey,
  collectPublicationsFromCompetitors,
  collectContentPlansFromCompetitors,
  embedMissingItems,
  embedItemsWithDimensionMismatch,
  ensureEmbeddingsForSearch
} from './precedentRepositoryShared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..', '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const STORAGE_ROOT = path.join(DATA_ROOT, 'precedents');
const LEGACY_STORAGE_PATH = path.join(DATA_ROOT, 'precedents.json');
const METADATA_PATH = path.join(STORAGE_ROOT, 'metadata.json');
const INGESTION_RUNS_PATH = path.join(STORAGE_ROOT, 'ingestion_runs.json');
const PUBLICATIONS_PATH = path.join(STORAGE_ROOT, 'publications.json');
const CONTENT_PLANS_PATH = path.join(STORAGE_ROOT, 'content_plans.json');

let storageMutationQueue = Promise.resolve();

function ensureStorageRoot() {
  if (!fs.existsSync(DATA_ROOT)) {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
  }
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

function atomicWriteJson(filePath, data) {
  ensureStorageRoot();
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn('[precedentRepository] Failed to read JSON file:', filePath, error.message);
    return fallbackValue;
  }
}

function migrateLegacySnapshotIfNeeded() {
  if (fs.existsSync(METADATA_PATH) || !fs.existsSync(LEGACY_STORAGE_PATH)) {
    return;
  }

  const legacySnapshot = readJsonFile(LEGACY_STORAGE_PATH, createEmptyStorage());
  const collections = splitSnapshotToCollections(legacySnapshot);
  atomicWriteJson(METADATA_PATH, collections.metadata);
  atomicWriteJson(INGESTION_RUNS_PATH, collections.ingestion_runs);
  atomicWriteJson(PUBLICATIONS_PATH, collections.publications);
  atomicWriteJson(CONTENT_PLANS_PATH, collections.content_plans);
}

function readStorage() {
  ensureStorageRoot();
  migrateLegacySnapshotIfNeeded();

  const emptyStorage = createEmptyStorage();
  const parsed = {
    metadata: readJsonFile(METADATA_PATH, emptyStorage.metadata),
    ingestion_runs: readJsonFile(INGESTION_RUNS_PATH, emptyStorage.ingestion_runs),
    publications: readJsonFile(PUBLICATIONS_PATH, emptyStorage.publications),
    content_plans: readJsonFile(CONTENT_PLANS_PATH, emptyStorage.content_plans)
  };

  return {
    metadata: {
      ...emptyStorage.metadata,
      ...(parsed.metadata || {})
    },
    ingestion_runs: Array.isArray(parsed.ingestion_runs) ? parsed.ingestion_runs : [],
    publications: Array.isArray(parsed.publications) ? parsed.publications : [],
    content_plans: Array.isArray(parsed.content_plans) ? parsed.content_plans : []
  };
}

function writeStorage(storage) {
  const nextStorage = {
    ...storage,
    metadata: {
      ...(storage.metadata || {}),
      schema_version: Math.max(Number(storage?.metadata?.schema_version) || 1, EMBEDDING_SCHEMA_VERSION),
      updated_at: new Date().toISOString()
    }
  };

  atomicWriteJson(METADATA_PATH, nextStorage.metadata);
  atomicWriteJson(INGESTION_RUNS_PATH, nextStorage.ingestion_runs);
  atomicWriteJson(PUBLICATIONS_PATH, nextStorage.publications);
  atomicWriteJson(CONTENT_PLANS_PATH, nextStorage.content_plans);
}

function runStorageMutation(mutator) {
  const job = storageMutationQueue.then(async () => {
    const storage = readStorage();
    const result = await mutator(storage);
    writeStorage(storage);
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
      if (result === 'inserted') insertedContentPlans += 1;
      if (result === 'updated') updatedContentPlans += 1;
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
      storage_path: STORAGE_ROOT,
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

export function getPrecedentsSummary() {
  const storage = readStorage();
  const lastRun = storage.ingestion_runs.length
    ? storage.ingestion_runs[storage.ingestion_runs.length - 1]
    : null;

  return {
    storage_path: STORAGE_ROOT,
    schema_version: storage.metadata?.schema_version || 1,
    updated_at: storage.metadata?.updated_at || null,
    ingestion_runs_count: storage.ingestion_runs.length,
    publications_count: storage.publications.length,
    content_plans_count: storage.content_plans.length,
    last_run: lastRun
  };
}

export function getPrecedentsSnapshot() {
  return readStorage();
}

export async function searchPrecedents(query, options = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return {
      query: '',
      publications: [],
      content_plans: [],
      total_publications_searched: 0,
      total_content_plans_searched: 0
    };
  }

  const storage = readStorage();
  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 20));

  const scoped = resolveFilteredCollections(storage, options);
  const filteredPublications = scoped.publications;
  const filteredContentPlans = scoped.content_plans;
  const queryTokens = uniqueTokens(tokenize(normalizedQuery));

  // --- Embedding-based RAG (memo): query -> embedding, docs -> embeddings, cosine similarity, top-N.
  // Если embeddings недоступны (нет ключа/ошибка API), делаем fallback на прежний token-overlap.
  try {
    const queryEmbeddingResult = await embedTexts([normalizedQuery]);
    const queryEmbedding = queryEmbeddingResult.embeddings[0];
    const modelVersion = queryEmbeddingResult.modelVersion || queryEmbeddingResult.model;

    const cacheKey = buildRagCacheKey(normalizedQuery, options, modelVersion, 'json');
    if (isRagCacheEnabled()) {
      const cached = getCachedRagSearch(cacheKey);
      if (cached) return cached;
    }

    // Доиндексируем отсутствующие эмбеддинги (лениво) и сразу пишем на диск.
    const pubEmbedStats = await ensureEmbeddingsForSearch(
      filteredPublications,
      buildEmbeddingTextForPublication
    );
    const planEmbedStats = await ensureEmbeddingsForSearch(
      filteredContentPlans,
      buildEmbeddingTextForContentPlan
    );
    if (pubEmbedStats.embedded > 0 || planEmbedStats.embedded > 0) {
      await runStorageMutation(async (latestStorage) => {
        mergeEmbeddingUpdates(latestStorage.publications, filteredPublications, 'publication_id');
        mergeEmbeddingUpdates(latestStorage.content_plans, filteredContentPlans, 'plan_id');
        return null;
      });
    }

    const rankedPublications = filteredPublications
      .map((publication) => {
        const emb = getEmbeddingForItem(publication);
        const cosine = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const embeddingScore = normalizeCosineToUnitInterval(cosine);
        const tokenScore = calculateTokenScore(queryTokens, collectPublicationSearchText(publication), {
          boostExactPhrase: normalizedQuery
        });
        const score = Math.min(
          1,
          embeddingScore * RETRIEVAL_EMBEDDING_WEIGHT + tokenScore.score * RETRIEVAL_TOKEN_WEIGHT
        );

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
        const score = Math.min(
          1,
          embeddingScore * RETRIEVAL_EMBEDDING_WEIGHT + tokenScore.score * RETRIEVAL_TOKEN_WEIGHT
        );

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
        type: 'embedding_cosine',
        embedding_model: queryEmbeddingResult.model,
        embedding_model_version: modelVersion,
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

    const rankedPublications = filteredPublications
      .map((publication) => {
        const searchText = collectPublicationSearchText(publication);
        const scoreData = calculateTokenScore(queryTokens, searchText, {
          boostExactPhrase: normalizedQuery
        });

        return {
          type: 'publication',
          score: scoreData.score,
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
        const scoreData = calculateTokenScore(queryTokens, searchText, {
          boostExactPhrase: normalizedQuery
        });

        return {
          type: 'content_plan',
          score: scoreData.score,
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
        fallback_scope: scoped.fallback_scope,
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
  const snapshot = readStorage();
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
