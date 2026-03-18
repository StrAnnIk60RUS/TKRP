import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import {
  cosineSimilarity,
  embedTexts,
  normalizeCosineToUnitInterval
} from '../services/embeddingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, '..', '..', 'data');
const STORAGE_PATH = path.join(STORAGE_DIR, 'precedents.json');
const EMBEDDING_SCHEMA_VERSION = 2;
const EMBEDDING_TEXT_MAX_CHARS = 4000;

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

function ensureStorageFile() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  if (!fs.existsSync(STORAGE_PATH)) {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(createEmptyStorage(), null, 2), 'utf-8');
  }
}

function readStorage() {
  ensureStorageFile();

  try {
    const raw = fs.readFileSync(STORAGE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    return {
      ...createEmptyStorage(),
      ...parsed,
      metadata: {
        ...(createEmptyStorage().metadata || {}),
        ...(parsed.metadata || {})
      },
      ingestion_runs: Array.isArray(parsed.ingestion_runs) ? parsed.ingestion_runs : [],
      publications: Array.isArray(parsed.publications) ? parsed.publications : [],
      content_plans: Array.isArray(parsed.content_plans) ? parsed.content_plans : []
    };
  } catch (error) {
    console.warn('[precedentRepository] Storage read failed, recreating file:', error.message);
    const emptyStorage = createEmptyStorage();
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(emptyStorage, null, 2), 'utf-8');
    return emptyStorage;
  }
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
  if (!platform) return items;
  const normalizedPlatform = normalizeText(platform);
  return items.filter((item) => normalizeText(item?.platform) === normalizedPlatform);
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
  ensureStorageFile();

  const nextStorage = {
    ...storage,
    metadata: {
      ...(storage.metadata || {}),
      schema_version: Math.max(Number(storage?.metadata?.schema_version) || 1, EMBEDDING_SCHEMA_VERSION),
      updated_at: new Date().toISOString()
    }
  };

  fs.writeFileSync(STORAGE_PATH, JSON.stringify(nextStorage, null, 2), 'utf-8');
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
      content_strategy_snapshot: competitor.content_strategy || null
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

export async function persistPrecedents(enrichedData, options = {}) {
  const storage = readStorage();
  const competitors = Array.isArray(enrichedData?.competitors) ? enrichedData.competitors : [];

  const publications = collectPublicationsFromCompetitors(competitors);
  const contentPlans = collectContentPlansFromCompetitors(competitors);

  let insertedPublications = 0;
  let updatedPublications = 0;
  let insertedContentPlans = 0;
  let updatedContentPlans = 0;

  publications.forEach((publication) => {
    const result = upsertByKey(storage.publications, publication, 'publication_id');
    if (result === 'inserted') insertedPublications += 1;
    if (result === 'updated') updatedPublications += 1;
  });

  contentPlans.forEach((contentPlan) => {
    const result = upsertByKey(storage.content_plans, contentPlan, 'plan_id');
    if (result === 'inserted') insertedContentPlans += 1;
    if (result === 'updated') updatedContentPlans += 1;
  });

  // Embedding-index: пытаемся вычислить эмбеддинги для новых/обновленных элементов.
  // Если embeddings недоступны (нет ключа/ошибка API), сохраняем данные без эмбеддингов:
  // retrieval сможет использовать fallback (token overlap) и/или доиндексировать позже.
  let embeddingStats = {
    publications_embedded: 0,
    content_plans_embedded: 0,
    embedding_model: null,
    embedding_error: null
  };
  try {
    const pubEmbed = await embedMissingItems(storage.publications, buildEmbeddingTextForPublication);
    const planEmbed = await embedMissingItems(storage.content_plans, buildEmbeddingTextForContentPlan);
    embeddingStats = {
      publications_embedded: pubEmbed.embedded_count,
      content_plans_embedded: planEmbed.embedded_count,
      embedding_model: pubEmbed.embedding_model || planEmbed.embedding_model || null,
      embedding_error: null
    };
  } catch (error) {
    embeddingStats.embedding_error = error.message || 'embedding_error';
    console.warn('[precedentRepository] Embedding indexing skipped:', embeddingStats.embedding_error);
  }

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
    embedding: embeddingStats
  });

  writeStorage(storage);

  // ML-автообучение после ingestion (опционально, чтобы учить модель на новых прецедентах).
  // Важно: training выполняется в той же python-среде, где запускается backend.
  const autoTrainEnabled = process.env.ML_AUTO_TRAIN_AFTER_INGESTION !== 'false';
  if (autoTrainEnabled && (insertedPublications + updatedPublications + insertedContentPlans + updatedContentPlans > 0)) {
    try {
      const scriptPath = path.join(__dirname, '..', '..', 'ml', 'engagement_model.py');
      const serverRoot = path.join(__dirname, '..', '..'); // server/

      await new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', ['-u', scriptPath, 'train'], {
          cwd: serverRoot,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`auto-train failed (exit_code=${code}): ${stderr || 'no stderr'}${stdout ? ` | stdout=${stdout.slice(0, 500)}` : ''}`));
            return;
          }
          resolve();
        });

        pythonProcess.stdin.end();
      });
    } catch (error) {
      console.warn('[ml:auto-train] Failed to retrain relevance model:', error?.message || error);
    }
  }

  return {
    storage_path: STORAGE_PATH,
    competitors_count: competitors.length,
    publications_processed: publications.length,
    content_plans_processed: contentPlans.length,
    inserted_publications: insertedPublications,
    updated_publications: updatedPublications,
    inserted_content_plans: insertedContentPlans,
    updated_content_plans: updatedContentPlans,
    total_publications: storage.publications.length,
    total_content_plans: storage.content_plans.length,
    embedding: embeddingStats
  };
}

export function getPrecedentsSummary() {
  const storage = readStorage();
  const lastRun = storage.ingestion_runs.length
    ? storage.ingestion_runs[storage.ingestion_runs.length - 1]
    : null;

  return {
    storage_path: STORAGE_PATH,
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
    filterByPlatform(storage.publications, options.platform),
    options.audience_segments,
    (item) => item?.publication_model?.audience_segments || []
  );
  let filteredContentPlans = filterByAudience(
    filterByPlatform(storage.content_plans, options.platform),
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
    let embeddedChanged = false;
    const pubEmbedStats = await ensureEmbeddingsForSearch(
      filteredPublications,
      buildEmbeddingTextForPublication
    );
    const planEmbedStats = await ensureEmbeddingsForSearch(
      filteredContentPlans,
      buildEmbeddingTextForContentPlan
    );
    if (pubEmbedStats.embedded > 0 || planEmbedStats.embedded > 0) {
      embeddedChanged = true;
    }
    if (embeddedChanged) {
      writeStorage(storage);
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

    return {
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

    return {
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
  }
}
