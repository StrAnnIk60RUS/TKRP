import { parseJsonObjectFromLlmContent } from '../../../shared/utils/llmJsonParsing.js';

const ALLOWED_PLATFORMS = ['vk', 'linkedin'];
export const ALLOWED_ENRICHMENT_OBJECTIVES = [
  'inform',
  'educate',
  'engage',
  'convert',
  'retain',
  'brand_building'
];

function readPositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function asTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function uniqueStringArray(value, limit = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
    .slice(0, limit);
}

function truncateText(value, maxChars) {
  const text = asTrimmedString(value);
  if (!text) {
    return '';
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function toUtf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizePlatform(value) {
  const normalized = asTrimmedString(value).toLowerCase();
  return ALLOWED_PLATFORMS.includes(normalized) ? normalized : null;
}

function buildSourcePostId(competitor, competitorIndex, postIndex) {
  const baseId = asTrimmedString(competitor?.competitor_id) || `competitor_${competitorIndex + 1}`;
  return `${baseId}_post_${postIndex + 1}`;
}

function buildSlimPost(post, competitor, competitorIndex, postIndex, config) {
  return {
    source_post_id: buildSourcePostId(competitor, competitorIndex, postIndex),
    // Важно: сохраняем `url`, чтобы downstream мог построить стабильный `publication_id`.
    // Иначе `precedentRepository` сохраняет `source_url: null`, а `publication_id`
    // деградирует до fallback по индексу → upsert вместо insert и/или semantic-dedup фильтрует новые записи.
    url: typeof post?.url === 'string' && post.url.trim().length ? post.url.trim() : null,
    platform: normalizePlatform(competitor?.platform),
    content: truncateText(post?.content, config.maxPostContentChars),
    datetime: post?.datetime || null,
    engagement_rate: Number.isFinite(Number(post?.engagement_rate))
      ? Number(Number(post.engagement_rate).toFixed(4))
      : 0,
    metrics: {
      likes: Number(post?.metrics?.likes) || 0,
      comments: Number(post?.metrics?.comments) || 0,
      shares: Number(post?.metrics?.shares) || 0,
      views: Number(post?.metrics?.views) || 0
    },
    attachments: {
      has_photo: Boolean(post?.attachments?.has_photo),
      has_video: Boolean(post?.attachments?.has_video),
      has_link: Boolean(post?.attachments?.has_link),
      has_document: Boolean(post?.attachments?.has_document)
    }
  };
}

function chunkCompetitorPosts(competitor, competitorIndex, config) {
  const posts = Array.isArray(competitor?.posts) ? competitor.posts : [];
  const slimPosts = posts.map((post, postIndex) =>
    buildSlimPost(post, competitor, competitorIndex, postIndex, config)
  );

  if (!slimPosts.length) {
    return [];
  }

  const chunks = [];
  let currentPosts = [];

  const flushChunk = () => {
    if (!currentPosts.length) {
      return;
    }

    const payload = {
      competitors: [
        {
          competitor_id:
            asTrimmedString(competitor?.competitor_id) || `competitor_${competitorIndex + 1}`,
          name: asTrimmedString(competitor?.name) || null,
          platform: normalizePlatform(competitor?.platform),
          posts: currentPosts
        }
      ]
    };

    chunks.push({
      payload,
      references: currentPosts.map((post) => post.source_post_id),
      stats: {
        posts_count: currentPosts.length,
        payload_bytes: toUtf8Bytes(payload)
      }
    });

    currentPosts = [];
  };

  slimPosts.forEach((slimPost) => {
    const candidatePosts = [...currentPosts, slimPost];
    const candidatePayload = {
      competitors: [
        {
          competitor_id:
            asTrimmedString(competitor?.competitor_id) || `competitor_${competitorIndex + 1}`,
          name: asTrimmedString(competitor?.name) || null,
          platform: normalizePlatform(competitor?.platform),
          posts: candidatePosts
        }
      ]
    };

    const candidateBytes = toUtf8Bytes(candidatePayload);
    const exceedsPosts = candidatePosts.length > config.maxPostsPerBatch;
    const exceedsBytes = candidateBytes > config.maxPayloadBytes && currentPosts.length > 0;

    if (exceedsPosts || exceedsBytes) {
      flushChunk();
      currentPosts = [slimPost];
      return;
    }

    currentPosts = candidatePosts;
  });

  flushChunk();

  return chunks;
}

export function getEnrichmentConfig() {
  return {
    // Default: keep each LLM call small (10-15 posts typical).
    // This prevents over-limit prompts and allows the whole enrichment pipeline
    // to complete by processing multiple batches and merging results.
    maxPostsPerBatch: readPositiveNumber(process.env.MAX_POSTS_PER_ENRICH_REQUEST, 15),
    maxPayloadBytes: readPositiveNumber(process.env.MAX_ENRICH_PAYLOAD_BYTES, 180000),
    maxRequestBytes: readPositiveNumber(process.env.MAX_ENRICH_REQUEST_BYTES, 2000000),
    maxPostContentChars: readPositiveNumber(process.env.MAX_ENRICH_POST_CONTENT_CHARS, 4000),
    autoBatch: process.env.ENRICH_AUTO_BATCH !== 'false',
    retryOnInvalid: process.env.ENRICH_RETRY_ON_INVALID !== 'false',
    maxRetries: 1
  };
}

export function countPostsInCompetitorsData(competitorsData) {
  const competitors = Array.isArray(competitorsData?.competitors) ? competitorsData.competitors : [];
  return competitors.reduce((sum, competitor) => sum + (Array.isArray(competitor?.posts) ? competitor.posts.length : 0), 0);
}

export function measurePayloadBytes(payload) {
  return toUtf8Bytes(payload);
}

export function summarizeEnrichmentLimits(competitorsData, config = getEnrichmentConfig()) {
  const batches = buildSemanticEnrichmentBatches(competitorsData, config);
  let maxBatchPayloadBytes = 0;
  let maxBatchPostsCount = 0;

  batches.forEach((batch) => {
    const payloadBytes = Number(batch?.stats?.payload_bytes) || 0;
    const postsCount = Number(batch?.stats?.posts_count) || 0;
    if (payloadBytes > maxBatchPayloadBytes) maxBatchPayloadBytes = payloadBytes;
    if (postsCount > maxBatchPostsCount) maxBatchPostsCount = postsCount;
  });

  return {
    competitors_count: Array.isArray(competitorsData?.competitors) ? competitorsData.competitors.length : 0,
    posts_count: countPostsInCompetitorsData(competitorsData),
    // Raw request size (used only for observability; we gate by per-batch stats below).
    payload_bytes: measurePayloadBytes(competitorsData),
    batches_count: batches.length,
    max_batch_posts_count: maxBatchPostsCount,
    max_batch_payload_bytes: maxBatchPayloadBytes,
    limits: {
      max_posts_per_batch: config.maxPostsPerBatch,
      max_payload_bytes: config.maxPayloadBytes,
      max_request_bytes: config.maxRequestBytes,
      auto_batch: config.autoBatch
    }
  };
}

export function buildSemanticEnrichmentBatches(competitorsData, config = getEnrichmentConfig()) {
  const competitors = Array.isArray(competitorsData?.competitors) ? competitorsData.competitors : [];

  return competitors.flatMap((competitor, competitorIndex) =>
    chunkCompetitorPosts(competitor, competitorIndex, config)
  );
}

export function buildSemanticUserPrompt(batchPayload, options = {}) {
  const compact = options.compact === true;

  return `Проанализируй посты конкурента и верни только семантические признаки по каждому посту.

Верни только валидный JSON без markdown и без пояснений.

Формат ответа:
{
  "competitors": [
    {
      "competitor_id": "string",
      "posts": [
        {
          "source_post_id": "string",
          "topic": "string",
          "tone": "string",
          "target_audience": ["string"],
          "objective": "inform|educate|engage|convert|retain|brand_building",
          "summary": "string",
          "key_entities": ["string"]
        }
      ]
    }
  ]
}

Правила:
1. Верни ровно по одному объекту на каждый входной пост.
2. Используй только поля, указанные в формате ответа.
3. Не придумывай факты, которых нет в тексте поста или метриках.
4. Если данных недостаточно, используй осторожные нейтральные значения.
5. "topic" должен быть коротким и конкретным.
6. "tone" должен быть коротким описанием тона.
7. "target_audience" должен быть массивом сегментов аудитории.
8. "summary" должен быть кратким: ${compact ? 'до 160' : 'до 240'} символов.
9. "key_entities" должен содержать до ${compact ? '4' : '6'} ключевых сущностей.
10. Не добавляй публикации, которых нет во входе. Не пропускай входные публикации.

Входные данные:
${JSON.stringify(batchPayload, null, compact ? 0 : 2)}`;
}

export function extractJsonObjectFromContent(content) {
  return parseJsonObjectFromLlmContent(content);
}

export function validateAndNormalizeSemanticBatchResult(expectedBatch, parsedResult) {
  const competitors = Array.isArray(expectedBatch?.competitors) ? expectedBatch.competitors : [];
  const expectedIds = competitors.flatMap((competitor) =>
    (Array.isArray(competitor?.posts) ? competitor.posts : []).map((post) => post.source_post_id)
  );

  const resultCompetitors = Array.isArray(parsedResult?.competitors) ? parsedResult.competitors : [];
  const returnedPosts = resultCompetitors.flatMap((competitor) =>
    Array.isArray(competitor?.posts) ? competitor.posts : []
  );

  const errors = [];
  const byId = new Map();

  returnedPosts.forEach((post, index) => {
    const sourcePostId = asTrimmedString(post?.source_post_id);
    if (!sourcePostId) {
      errors.push(`Пост #${index + 1} не содержит source_post_id`);
      return;
    }
    if (byId.has(sourcePostId)) {
      errors.push(`Дублирующийся source_post_id: ${sourcePostId}`);
      return;
    }

    const topic = asTrimmedString(post?.topic);
    const tone = asTrimmedString(post?.tone);
    const objective = asTrimmedString(post?.objective).toLowerCase();

    if (!topic) {
      errors.push(`Пост ${sourcePostId} не содержит topic`);
    }
    if (!tone) {
      errors.push(`Пост ${sourcePostId} не содержит tone`);
    }
    if (!ALLOWED_ENRICHMENT_OBJECTIVES.includes(objective)) {
      errors.push(`Пост ${sourcePostId} содержит недопустимый objective: ${objective || 'empty'}`);
    }

    byId.set(sourcePostId, {
      source_post_id: sourcePostId,
      topic: topic || 'unspecified',
      tone: tone || 'neutral',
      target_audience: uniqueStringArray(post?.target_audience ?? post?.audience_segments, 6),
      objective: ALLOWED_ENRICHMENT_OBJECTIVES.includes(objective) ? objective : 'inform',
      summary: truncateText(post?.summary, 240),
      key_entities: uniqueStringArray(post?.key_entities, 6)
    });
  });

  expectedIds.forEach((expectedId) => {
    if (!byId.has(expectedId)) {
      errors.push(`В ответе отсутствует пост ${expectedId}`);
    }
  });

  if (returnedPosts.length !== expectedIds.length) {
    errors.push(
      `Количество постов в ответе не совпадает с ожиданием: expected=${expectedIds.length}, got=${returnedPosts.length}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    posts_by_id: byId
  };
}

export function mergeSemanticBatchResults(baseData, semanticMaps = []) {
  const merged = JSON.parse(JSON.stringify(baseData));
  const combinedMap = new Map();

  semanticMaps.forEach((semanticMap) => {
    semanticMap.forEach((value, key) => {
      combinedMap.set(key, value);
    });
  });

  if (!Array.isArray(merged?.competitors)) {
    return merged;
  }

  merged.competitors = merged.competitors.map((competitor, competitorIndex) => {
    const posts = Array.isArray(competitor?.posts) ? competitor.posts : [];

    return {
      ...competitor,
      posts: posts.map((post, postIndex) => {
        const sourcePostId = buildSourcePostId(competitor, competitorIndex, postIndex);
        const semantic = combinedMap.get(sourcePostId) || {};

        return {
          ...post,
          topic: semantic.topic || post?.topic || 'unspecified',
          tone: semantic.tone || post?.tone || 'neutral',
          target_audience: semantic.target_audience || post?.target_audience || [],
          objective: semantic.objective || post?.objective || 'inform',
          summary: semantic.summary || post?.summary || '',
          key_entities: semantic.key_entities || post?.key_entities || []
        };
      })
    };
  });

  return merged;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return false;
  }
  return numeric >= 0 && numeric <= 1;
}

export function validateNormalizedEnrichmentResult(enrichedData) {
  const errors = [];
  const competitors = Array.isArray(enrichedData?.competitors) ? enrichedData.competitors : [];

  competitors.forEach((competitor) => {
    const posts = Array.isArray(competitor?.posts) ? competitor.posts : [];
    posts.forEach((post) => {
      const publicationId = post?.publication_model?.publication_id || post?.url || 'unknown_post';
      const publicationModel = post?.publication_model || {};
      const dimensions = publicationModel?.spcj?.dimensions || {};
      const vector = Array.isArray(publicationModel?.spcj?.vector) ? publicationModel.spcj.vector : [];
      const kpiEstimate = publicationModel?.kpi_estimate || {};

      if (!asTrimmedString(post?.topic)) {
        errors.push(`У публикации ${publicationId} отсутствует topic`);
      }
      if (!asTrimmedString(post?.tone)) {
        errors.push(`У публикации ${publicationId} отсутствует tone`);
      }
      if (!ALLOWED_ENRICHMENT_OBJECTIVES.includes(asTrimmedString(publicationModel?.objective).toLowerCase())) {
        errors.push(`У публикации ${publicationId} некорректный objective`);
      }

      Object.entries(dimensions).forEach(([key, value]) => {
        if (!clamp01(value)) {
          errors.push(`У публикации ${publicationId} dimension ${key} вне диапазона 0..1`);
        }
      });

      vector.forEach((value, index) => {
        if (!clamp01(value)) {
          errors.push(`У публикации ${publicationId} spcj.vector[${index}] вне диапазона 0..1`);
        }
      });

      Object.entries(kpiEstimate).forEach(([key, value]) => {
        if (!clamp01(value)) {
          errors.push(`У публикации ${publicationId} kpi_estimate.${key} вне диапазона 0..1`);
        }
      });
    });
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

