import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  cosineSimilarity,
  embedTexts,
  normalizeCosineToUnitInterval
} from '../services/embeddingService.js';
import {
  buildOntologyExportSheets,
  buildOntologyFromSnapshot,
  serializeOntologyToTurtle
} from '../services/ontologyAggregationService.js';
import { enrichSearchResultsWithReliability } from '../services/precedentReliabilityService.js';
import { trainRelevanceModel } from '../../ml/services/relevancePredictionService.js';

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
const EMBEDDING_SCHEMA_VERSION = 2;
const EMBEDDING_TEXT_MAX_CHARS = 4000;

/** Порог cosine similarity: >= threshold = семантический дубликат. Default 0.95. */
const DEDUP_SIMILARITY_THRESHOLD = Math.min(
  1,
  Math.max(0.5, Number(process.env.DEDUP_SIMILARITY_THRESHOLD) || 0.95)
);

/**
 * Более строгий порог для сравнения "новых кандидатов" с уже существующими в базе.
 * Делает дедуп более "разрешающим": новые посты с близким, но не идентичным смыслом
 * чаще проходят и реально добавляются в базу.
 */
const DEDUP_SIMILARITY_THRESHOLD_EXISTING = Math.min(
  1,
  Math.max(
    0.5,
    Number(process.env.DEDUP_SIMILARITY_THRESHOLD_EXISTING) ||
      // По умолчанию: поднять порог на +0.04 относительно общего.
      DEDUP_SIMILARITY_THRESHOLD + 0.04
  )
);
const DEDUP_SEMANTIC_ENABLED = process.env.DEDUP_SEMANTIC_ENABLED !== 'false';

let storageMutationQueue = Promise.resolve();

function createEmptyStorage() {
  return {
    metadata: {
      schema_version: EMBEDDING_SCHEMA_VERSION,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    ingestion_runs: [],
    publications: [],
    content_plans: []
  };
}

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

function splitSnapshotToCollections(snapshot) {
  const empty = createEmptyStorage();
  const metadata = {
    ...empty.metadata,
    ...(snapshot?.metadata || {}),
    schema_version: Math.max(
      Number(snapshot?.metadata?.schema_version) || EMBEDDING_SCHEMA_VERSION,
      EMBEDDING_SCHEMA_VERSION
    )
  };
  return {
    metadata,
    ingestion_runs: Array.isArray(snapshot?.ingestion_runs) ? snapshot.ingestion_runs : [],
    publications: Array.isArray(snapshot?.publications) ? snapshot.publications : [],
    content_plans: Array.isArray(snapshot?.content_plans) ? snapshot.content_plans : []
  };
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

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function clampText(value, maxChars) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length >= 2);
}

function uniqueTokens(tokens) {
  return Array.from(new Set(tokens.filter(Boolean)));
}

function collectPublicationSearchText(publication) {
  const model = publication?.publication_model || {};
  return [
    publication?.competitor_name,
    publication?.platform,
    model.type,
    model.topic,
    model.format,
    model.content_category,
    model.tone,
    model.funnel_stage,
    model.objective,
    model.summary,
    ...(Array.isArray(model.audience_segments) ? model.audience_segments : []),
    ...(Array.isArray(model.key_entities) ? model.key_entities : [])
  ]
    .filter(Boolean)
    .join(' ');
}

function collectContentPlanSearchText(contentPlan) {
  const model = contentPlan?.content_plan_model || {};
  const schedule = Array.isArray(model.publication_schedule) ? model.publication_schedule : [];
  return [
    contentPlan?.competitor_name,
    contentPlan?.platform,
    model.plan_type,
    ...(Array.isArray(model.audience_segments) ? model.audience_segments : []),
    ...(schedule.flatMap((item) => [item?.topic, item?.format, item?.objective]).filter(Boolean))
  ]
    .filter(Boolean)
    .join(' ');
}

function calculateTokenScore(queryTokens, text, options = {}) {
  const textTokens = uniqueTokens(tokenize(text));
  if (!queryTokens.length || !textTokens.length) {
    return {
      score: 0,
      matched_tokens: []
    };
  }

  const matchedTokens = queryTokens.filter((token) => textTokens.includes(token));
  const baseScore = matchedTokens.length / queryTokens.length;

  let score = baseScore;
  if (options.boostExactPhrase && normalizeText(text).includes(normalizeText(options.boostExactPhrase))) {
    score += 0.25;
  }

  return {
    score: Number(Math.min(score, 1).toFixed(4)),
    matched_tokens: uniqueTokens(matchedTokens)
  };
}

function getEmbeddingForItem(item) {
  const embedding = item?.embedding;
  return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
}

/**
 * Фильтрует семантические дубликаты: исключает из newItems те, чей эмбеддинг
 * имеет cosine similarity >= threshold с существующими или уже принятыми элементами.
 * Дедупликация выполняется и против existingItems, и внутри пачки newItems.
 * @param {Object[]} newItems - новые элементы (должны иметь embedding)
 * @param {Object[]} existingItems - существующие элементы в хранилище
 * @param {string} idField - имя поля ID (если оно есть, используем его для более
 * безопасной дедупликации: считаем дублем только когда и semantic близко, и ключ совпадает)
 * @returns {{ filtered: Object[], skipped: Object[], skipped_count: number }}
 */
function filterSemanticDuplicates(newItems, existingItems, idField) {
  if (!Array.isArray(newItems) || !Array.isArray(existingItems)) {
    return { filtered: newItems || [], skipped: [], skipped_count: 0 };
  }

  const getItemId = (item) => (idField ? item?.[idField] : null);

  const keptExisting = existingItems
    .map((item) => ({
      emb: getEmbeddingForItem(item),
      id: getItemId(item)
    }))
    .filter((x) => Array.isArray(x.emb));

  // Dedup "внутри пачки" (между newItems) остаётся прежним и использует базовый порог.
  const keptNew = [];

  const filtered = [];
  const skipped = [];

  for (const newItem of newItems) {
    const newEmb = getEmbeddingForItem(newItem);
    if (!newEmb) {
      filtered.push(newItem);
      continue;
    }

    const newId = getItemId(newItem);
    let isDuplicate = false;

    // 1) Сначала проверяем против существующей базы: более строгий порог.
    for (const kept of keptExisting) {
      const sim = cosineSimilarity(newEmb, kept.emb);
      if (sim < DEDUP_SIMILARITY_THRESHOLD_EXISTING) continue;

      // Если ID присутствует у обоих элементов — считаем дублем только при совпадении ключа.
      // Если один из ID отсутствует — fallback к semantic-dedup.
      if (
        !newId ||
        !kept.id ||
        String(newId) === String(kept.id)
      ) {
        isDuplicate = true;
        break;
      }
    }

    // 2) Если не нашли дубль в базе, проверяем "почти-дубликаты" внутри пачки.
    if (!isDuplicate) {
      for (const kept of keptNew) {
        const sim = cosineSimilarity(newEmb, kept.emb);
        if (sim < DEDUP_SIMILARITY_THRESHOLD) continue;

        if (
          !newId ||
          !kept.id ||
          String(newId) === String(kept.id)
        ) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (isDuplicate) {
      skipped.push(newItem);
    } else {
      filtered.push(newItem);
      keptNew.push({ emb: newEmb, id: newId });
    }
  }

  return {
    filtered,
    skipped,
    skipped_count: skipped.length
  };
}

function buildEmbeddingTextForPublication(publication) {
  const base = collectPublicationSearchText(publication);
  const contentSnippet = typeof publication?.raw_content === 'string' ? publication.raw_content : '';
  // raw_content у нас может отсутствовать, но publication_model.summary/кей-энтити уже включены.
  return clampText([base, contentSnippet].filter(Boolean).join('\n'), EMBEDDING_TEXT_MAX_CHARS);
}

function buildEmbeddingTextForContentPlan(contentPlan) {
  const base = collectContentPlanSearchText(contentPlan);
  return clampText(base, EMBEDDING_TEXT_MAX_CHARS);
}

function filterByPlatform(items, platform) {
  const normalizedPlatforms = Array.isArray(platform)
    ? platform.map((value) => normalizeText(value)).filter(Boolean)
    : [normalizeText(platform)].filter(Boolean);
  if (normalizedPlatforms.length === 0) return items;
  return items.filter((item) => normalizedPlatforms.includes(normalizeText(item?.platform)));
}

function filterByAudience(items, audienceSegments = [], getter) {
  if (!Array.isArray(audienceSegments) || audienceSegments.length === 0) {
    return items;
  }

  const normalizedSegments = audienceSegments.map((segment) => normalizeText(segment)).filter(Boolean);
  if (!normalizedSegments.length) return items;

  return items.filter((item) => {
    const values = getter(item).map((segment) => normalizeText(segment)).filter(Boolean);
    return normalizedSegments.some((segment) => values.includes(segment));
  });
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

function mergeEmbeddingUpdates(items, updates, idField) {
  const updatesById = new Map(
    updates
      .filter((item) => item?.[idField] && Array.isArray(item?.embedding))
      .map((item) => [item[idField], item])
  );

  items.forEach((item) => {
    const itemId = item?.[idField];
    if (!itemId || !updatesById.has(itemId)) return;
    const update = updatesById.get(itemId);
    item.embedding = update.embedding;
    item.embedding_model = update.embedding_model;
    item.embedded_at = update.embedded_at;
  });
}

function upsertByKey(items, nextItem, keyName) {
  const keyValue = nextItem?.[keyName];
  if (!keyValue) {
    items.push(nextItem);
    return 'inserted';
  }

  const existingIndex = items.findIndex((item) => item?.[keyName] === keyValue);
  if (existingIndex === -1) {
    items.push(nextItem);
    return 'inserted';
  }

  items[existingIndex] = {
    ...items[existingIndex],
    ...nextItem,
    updated_at: new Date().toISOString()
  };
  return 'updated';
}

function collectPublicationsFromCompetitors(competitors = []) {
  const publications = [];

  competitors.forEach((competitor) => {
    const posts = Array.isArray(competitor.posts) ? competitor.posts : [];

    posts.forEach((post) => {
      if (!post?.publication_model) return;

      publications.push({
        publication_id: post.publication_model.publication_id,
        competitor_id: competitor.competitor_id || null,
        competitor_name: competitor.name || null,
        platform: competitor.platform || post.publication_model.platform || null,
        source_url: post.url || null,
        parsed_at: competitor?.parsing_metadata?.parsed_at || null,
        collected_at: new Date().toISOString(),
        publication_model: post.publication_model,
        raw_content: typeof post?.content === 'string' ? clampText(post.content, 6000) : null,
        raw_metrics: post.metrics || null,
        engagement_rate: post.engagement_rate ?? null,
        content_strategy_snapshot: competitor.content_strategy || null
      });
    });
  });

  return publications;
}

function collectContentPlansFromCompetitors(competitors = []) {
  return competitors
    .filter((competitor) => competitor?.content_plan_model)
    .map((competitor) => ({
      plan_id: competitor.content_plan_model.plan_id,
      competitor_id: competitor.competitor_id || null,
      competitor_name: competitor.name || null,
      platform: competitor.platform || competitor.content_plan_model.platform || null,
      collected_at: new Date().toISOString(),
      content_plan_model: competitor.content_plan_model,
      content_strategy_snapshot: competitor.content_strategy || null,
      ontology_support: competitor.ontology_support || null
    }));
}

async function embedMissingItems(items, buildTextFn) {
  const indicesToEmbed = [];
  const texts = [];

  items.forEach((item, index) => {
    if (getEmbeddingForItem(item)) return;
    const text = buildTextFn(item);
    if (!text) return;
    indicesToEmbed.push(index);
    texts.push(text);
  });

  if (indicesToEmbed.length === 0) {
    return {
      embedded_count: 0,
      embedding_model: null
    };
  }

  const result = await embedTexts(texts);

  indicesToEmbed.forEach((itemIndex, i) => {
    items[itemIndex] = {
      ...items[itemIndex],
      embedding: result.embeddings[i],
      embedding_model: result.model,
      embedded_at: new Date().toISOString()
    };
  });

  return {
    embedded_count: indicesToEmbed.length,
    embedding_model: result.model
  };
}

/**
 * Re-embeds items whose embedding dimension doesn't match targetDim.
 * Use when migrating to a different embedding model (e.g. 1536 → 1024).
 * @param {Object[]} items
 * @param {Function} buildTextFn
 * @param {number} targetDim
 * @returns {{ embedded_count: number, embedding_model: string | null }}
 */
async function embedItemsWithDimensionMismatch(items, buildTextFn, targetDim) {
  const indicesToEmbed = [];
  const texts = [];

  items.forEach((item, index) => {
    const emb = getEmbeddingForItem(item);
    if (emb && emb.length === targetDim) return;
    const text = buildTextFn(item);
    if (!text) return;
    indicesToEmbed.push(index);
    texts.push(text);
  });

  if (indicesToEmbed.length === 0) {
    return { embedded_count: 0, embedding_model: null };
  }

  const result = await embedTexts(texts);

  indicesToEmbed.forEach((itemIndex, i) => {
    items[itemIndex] = {
      ...items[itemIndex],
      embedding: result.embeddings[i],
      embedding_model: result.model,
      embedded_at: new Date().toISOString()
    };
  });

  return {
    embedded_count: indicesToEmbed.length,
    embedding_model: result.model
  };
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

  const result = await runStorageMutation(async (storage) => {
    const pubRes = await embedItemsWithDimensionMismatch(
      storage.publications,
      buildEmbeddingTextForPublication,
      targetDim
    );
    const planRes = await embedItemsWithDimensionMismatch(
      storage.content_plans,
      buildEmbeddingTextForContentPlan,
      targetDim
    );
    return {
      publications_reembedded: pubRes.embedded_count,
      content_plans_reembedded: planRes.embedded_count,
      target_dim: targetDim,
      embedding_model: pubRes.embedding_model || planRes.embedding_model || null
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

async function ensureEmbeddingsForSearch(items, buildTextFn) {
  const missing = [];
  const missingTexts = [];
  const missingIds = [];

  items.forEach((item) => {
    if (getEmbeddingForItem(item)) return;
    const text = buildTextFn(item);
    if (!text) return;
    missing.push(item);
    missingTexts.push(text);
    missingIds.push(item?.publication_id || item?.plan_id || null);
  });

  if (!missing.length) {
    return { embedded: 0, embedding_model: null };
  }

  const result = await embedTexts(missingTexts);
  missing.forEach((item, index) => {
    item.embedding = result.embeddings[index];
    item.embedding_model = result.model;
    item.embedded_at = new Date().toISOString();
  });

  return { embedded: missing.length, embedding_model: result.model };
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

  let filteredPublications = filterByAudience(
    filterByPlatform(storage.publications, options.platforms || options.platform),
    options.audience_segments,
    (item) => item?.publication_model?.audience_segments || []
  );
  let filteredContentPlans = filterByAudience(
    filterByPlatform(storage.content_plans, options.platforms || options.platform),
    options.audience_segments,
    (item) => item?.content_plan_model?.audience_segments || []
  );

  // Если после фильтрации по платформе/аудитории ничего не осталось,
  // ослабляем фильтры и ищем по всей базе (fallback-режим).
  if (filteredPublications.length === 0 && filteredContentPlans.length === 0) {
    filteredPublications = storage.publications;
    filteredContentPlans = storage.content_plans;
  }

  // --- Embedding-based RAG (memo): query -> embedding, docs -> embeddings, cosine similarity, top-N.
  // Если embeddings недоступны (нет ключа/ошибка API), делаем fallback на прежний token-overlap.
  try {
    const queryEmbeddingResult = await embedTexts([normalizedQuery]);
    const queryEmbedding = queryEmbeddingResult.embeddings[0];

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
        const score = normalizeCosineToUnitInterval(cosine);

        return {
          type: 'publication',
          score: Number(score.toFixed(4)),
          matched_tokens: [],
          data: publication
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rankedContentPlans = filteredContentPlans
      .map((contentPlan) => {
        const emb = getEmbeddingForItem(contentPlan);
        const cosine = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
        const score = normalizeCosineToUnitInterval(cosine);

        return {
          type: 'content_plan',
          score: Number(score.toFixed(4)),
          matched_tokens: [],
          data: contentPlan
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rawResult = {
      query: normalizedQuery,
      publications: rankedPublications,
      content_plans: rankedContentPlans,
      total_publications_searched: filteredPublications.length,
      total_content_plans_searched: filteredContentPlans.length,
      retrieval: {
        type: 'embedding_cosine',
        embedding_model: queryEmbeddingResult.model
      }
    };
    return enrichSearchResultsWithReliability(rawResult);
  } catch (error) {
    const queryTokens = uniqueTokens(tokenize(normalizedQuery));
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
      publications: rankedPublications,
      content_plans: rankedContentPlans,
      total_publications_searched: filteredPublications.length,
      total_content_plans_searched: filteredContentPlans.length,
      retrieval: {
        type: 'token_overlap_fallback',
        error: error.message || 'embedding_failed'
      }
    };
    return enrichSearchResultsWithReliability(rawResult);
  }
}

export function getAggregatedOntology() {
  return buildOntologyFromSnapshot(readStorage());
}

export function getOntologyExportData() {
  return buildOntologyExportSheets(getAggregatedOntology());
}

export function getOntologyTurtleData() {
  return serializeOntologyToTurtle(getAggregatedOntology());
}


