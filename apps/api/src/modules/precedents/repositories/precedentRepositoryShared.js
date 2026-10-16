import {
  cosineSimilarity,
  embedTexts
} from '../services/embeddingService.js';

export const EMBEDDING_SCHEMA_VERSION = 2;
export const EMBEDDING_TEXT_MAX_CHARS = 4000;

/** Порог cosine similarity: >= threshold = семантический дубликат. Default 0.95. */
export const DEDUP_SIMILARITY_THRESHOLD = Math.min(
  1,
  Math.max(0.5, Number(process.env.DEDUP_SIMILARITY_THRESHOLD) || 0.95)
);

/**
 * Более строгий порог для сравнения "новых кандидатов" с уже существими в базы.
 * Делает дедуп более "разрешающим": новые посты с близким, но не идентичным смыслом
 * чаще проходят и реально добавляются в базы.
 */
export const DEDUP_SIMILARITY_THRESHOLD_EXISTING = Math.min(
  1,
  Math.max(
    0.5,
    Number(process.env.DEDUP_SIMILARITY_THRESHOLD_EXISTING) ||
      // По умолчанию: поднять порог на +0.04 относительно общего.
      DEDUP_SIMILARITY_THRESHOLD + 0.04
  )
);
export const DEDUP_SEMANTIC_ENABLED = process.env.DEDUP_SEMANTIC_ENABLED !== 'false';
export const RETRIEVAL_MIN_SCORE = Math.min(
  1,
  Math.max(0, Number(process.env.RAG_MIN_RETRIEVAL_SCORE) || 0.58)
);
export const RETRIEVAL_DYNAMIC_DELTA = Math.min(
  0.5,
  Math.max(0, Number(process.env.RAG_DYNAMIC_SCORE_DELTA) || 0.14)
);
export const RETRIEVAL_EMBEDDING_WEIGHT = Math.min(
  1,
  Math.max(0, Number(process.env.RAG_EMBEDDING_WEIGHT) || 0.8)
);
export const RETRIEVAL_TOKEN_WEIGHT = Math.min(
  1,
  Math.max(0, Number(process.env.RAG_TOKEN_WEIGHT) || 0.2)
);

export function createEmptyStorage() {
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

export function splitSnapshotToCollections(snapshot) {
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

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function clampText(value, maxChars) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

export function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(' ').filter((token) => token.length >= 2);
}

export function uniqueTokens(tokens) {
  return Array.from(new Set(tokens.filter(Boolean)));
}

export function collectPublicationSearchText(publication) {
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

export function collectContentPlanSearchText(contentPlan) {
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

export function calculateTokenScore(queryTokens, text, options = {}) {
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

export function getEmbeddingForItem(item) {
  const embedding = item?.embedding;
  return Array.isArray(embedding) && embedding.length > 0 ? embedding : null;
}

/**
 * Фильтрует семантические дубликаты: исключает из newItems те, чей эмбеддинг
 * имеет cosine similarity >= threshold с существими или уже принятыми elements.
 * Дедупликация выполняется и против existingItems, и внутри пачки newItems.
 * @param {Object[]} newItems - новые elements (должны иметь embedding)
 * @param {Object[]} existingItems - существими elements в хранилище
 * @param {string} idField - имя поля ID (если оно есть, используем его для более
 * безопасной дедупликации: считаем дублем только когда и semantic близко, и ключ совпадает)
 * @returns {{ filtered: Object[], skipped: Object[], skipped_count: number }}
 */
export function filterSemanticDuplicates(newItems, existingItems, idField) {
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

    // 1) Сначала проверяем против существими базы: более строгий порог.
    for (const kept of keptExisting) {
      const sim = cosineSimilarity(newEmb, kept.emb);
      if (sim < DEDUP_SIMILARITY_THRESHOLD_EXISTING) continue;

      // Если ID присутствует у обоих elements — считаем дублем только при совпадении ключа.
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

    // 2) Если не нашли дубль в базы, проверяем "почти-duplicates" внутри пачки.
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

export function buildEmbeddingTextForPublication(publication) {
  const base = collectPublicationSearchText(publication);
  const contentSnippet = typeof publication?.raw_content === 'string' ? publication.raw_content : '';
  // raw_content у нас может отсути, но publication_model.summary/кей-энтити уже включены.
  return clampText([base, contentSnippet].filter(Boolean).join('\n'), EMBEDDING_TEXT_MAX_CHARS);
}

export function buildEmbeddingTextForContentPlan(contentPlan) {
  const base = collectContentPlanSearchText(contentPlan);
  return clampText(base, EMBEDDING_TEXT_MAX_CHARS);
}

export function filterByPlatform(items, platform) {
  const normalizedPlatforms = Array.isArray(platform)
    ? platform.map((value) => normalizeText(value)).filter(Boolean)
    : [normalizeText(platform)].filter(Boolean);
  if (normalizedPlatforms.length === 0) return items;
  return items.filter((item) => normalizedPlatforms.includes(normalizeText(item?.platform)));
}

export function filterByAudience(items, audienceSegments = [], getter) {
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

export function resolveFilteredCollections(storage, options = {}) {
  const platformFilteredPublications = filterByPlatform(
    storage.publications,
    options.platforms || options.platform
  );
  const platformFilteredContentPlans = filterByPlatform(
    storage.content_plans,
    options.platforms || options.platform
  );
  const audienceFilteredPublications = filterByAudience(
    platformFilteredPublications,
    options.audience_segments,
    (item) => item?.publication_model?.audience_segments || []
  );
  const audienceFilteredContentPlans = filterByAudience(
    platformFilteredContentPlans,
    options.audience_segments,
    (item) => item?.content_plan_model?.audience_segments || []
  );

  if (audienceFilteredPublications.length > 0 || audienceFilteredContentPlans.length > 0) {
    return {
      publications: audienceFilteredPublications,
      content_plans: audienceFilteredContentPlans,
      fallback_scope: 'none'
    };
  }

  // Safe fallback: first keep platform-only scope.
  if (platformFilteredPublications.length > 0 || platformFilteredContentPlans.length > 0) {
    return {
      publications: platformFilteredPublications,
      content_plans: platformFilteredContentPlans,
      fallback_scope: 'platform_only'
    };
  }

  // Next fallback: audience-only across whole base.
  const audienceOnlyPublications = filterByAudience(
    storage.publications,
    options.audience_segments,
    (item) => item?.publication_model?.audience_segments || []
  );
  const audienceOnlyContentPlans = filterByAudience(
    storage.content_plans,
    options.audience_segments,
    (item) => item?.content_plan_model?.audience_segments || []
  );
  if (audienceOnlyPublications.length > 0 || audienceOnlyContentPlans.length > 0) {
    return {
      publications: audienceOnlyPublications,
      content_plans: audienceOnlyContentPlans,
      fallback_scope: 'audience_only'
    };
  }

  // Last resort.
  return {
    publications: storage.publications,
    content_plans: storage.content_plans,
    fallback_scope: 'global'
  };
}

export function scoreRetrievalHit({
  embeddingScore = 0,
  tokenScore = 0,
  engagementSignal = 0,
  trustSignal = 0
} = {}) {
  const semantic = Math.min(
    1,
    Math.max(0, Number(embeddingScore) || 0) * RETRIEVAL_EMBEDDING_WEIGHT +
      Math.max(0, Number(tokenScore) || 0) * RETRIEVAL_TOKEN_WEIGHT
  );
  const engagement = Math.max(0, Math.min(1, Number(engagementSignal) || 0));
  const trust = Math.max(0, Math.min(1, Number(trustSignal) || 0));
  const blended = semantic * 0.72 + engagement * 0.16 + trust * 0.12;
  // Engagement and trust can raise a hit. They do not pull a relevant hit under the semantic score.
  return Math.min(1, Math.max(semantic, blended));
}

export function hasUsablePrecedentSemantics(post = {}) {
  const model = post?.publication_model || {};
  const topic = String(model.topic || post?.topic || '').trim().toLowerCase();
  if (!topic || topic === 'unspecified' || topic === 'n/a' || topic === 'none') return false;
  const summary = String(model.summary || post?.summary || '').trim();
  const content = String(post?.content || post?.raw_content || '').trim();
  return summary.length >= 20 || content.length >= 40;
}

export function applyRetrievalQualityGate(items, limit) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const topScore = Number(items[0]?.score) || 0;
  const dynamicThreshold = Math.max(RETRIEVAL_MIN_SCORE, topScore - RETRIEVAL_DYNAMIC_DELTA);
  return items.filter((item) => (Number(item?.score) || 0) >= dynamicThreshold).slice(0, limit);
}

export function mergeEmbeddingUpdates(items, updates, idField) {
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
    item.embedding_model_version = update.embedding_model_version;
    item.embedded_at = update.embedded_at;
  });
}

export function upsertByKey(items, nextItem, keyName) {
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

export function collectPublicationsFromCompetitors(competitors = []) {
  const publications = [];

  competitors.forEach((competitor) => {
    const posts = Array.isArray(competitor.posts) ? competitor.posts : [];

    posts.forEach((post) => {
      if (!post?.publication_model) return;
      if (!hasUsablePrecedentSemantics(post)) return;

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

export function collectContentPlansFromCompetitors(competitors = []) {
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

export async function embedMissingItems(items, buildTextFn) {
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
      embedding_model_version: result.modelVersion,
      embedded_at: new Date().toISOString()
    };
  });

  return {
    embedded_count: indicesToEmbed.length,
    embedding_model: result.model,
    embedding_model_version: result.modelVersion
  };
}

/**
 * Re-embeds items whose embedding dimension doesn't match targetDim OR whose
 * embedding_model_version differs from currentVersion (when provided).
 * Use when migrating to a different embedding model (e.g. 1536 → 1024 or a
 * model swap at the same dimension).
 * @param {Object[]} items
 * @param {Function} buildTextFn
 * @param {number} targetDim
 * @param {string|null} currentVersion - current embedding model version; stale items re-embedded
 * @returns {{ embedded_count: number, embedding_model: string | null, embedding_model_version: string|null }}
 */
export async function embedItemsWithDimensionMismatch(items, buildTextFn, targetDim, currentVersion = null) {
  const indicesToEmbed = [];
  const texts = [];

  items.forEach((item, index) => {
    const emb = getEmbeddingForItem(item);
    const versionMatches = !currentVersion ||
      (item?.embedding_model_version || item?.embedding_model) === currentVersion;
    if (emb && emb.length === targetDim && versionMatches) return;
    const text = buildTextFn(item);
    if (!text) return;
    indicesToEmbed.push(index);
    texts.push(text);
  });

  if (indicesToEmbed.length === 0) {
    return { embedded_count: 0, embedding_model: null, embedding_model_version: null };
  }

  const result = await embedTexts(texts);

  indicesToEmbed.forEach((itemIndex, i) => {
    items[itemIndex] = {
      ...items[itemIndex],
      embedding: result.embeddings[i],
      embedding_model: result.model,
      embedding_model_version: result.modelVersion,
      embedded_at: new Date().toISOString()
    };
  });

  return {
    embedded_count: indicesToEmbed.length,
    embedding_model: result.model,
    embedding_model_version: result.modelVersion
  };
}

export async function ensureEmbeddingsForSearch(items, buildTextFn) {
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
    item.embedding_model_version = result.modelVersion;
    item.embedded_at = new Date().toISOString();
  });

  return { embedded: missing.length, embedding_model: result.model, embedding_model_version: result.modelVersion };
}
