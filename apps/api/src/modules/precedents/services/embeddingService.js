import axios from 'axios';
import { OPENROUTER_API_KEY } from '../../../../openrouter.js';

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

function readPositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function asTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function getEmbeddingConfig() {
  const model = asTrimmedString(process.env.EMBEDDING_MODEL, 'intfloat/multilingual-e5-large');
  return {
    model,
    // Versioning: embeddings produced by different models are NOT comparable.
    // Bump EMBEDDING_MODEL_VERSION whenever EMBEDDING_MODEL changes; stored
    // records carry embedding_model_version and stale ones get re-embedded.
    modelVersion: asTrimmedString(process.env.EMBEDDING_MODEL_VERSION, model),
    maxBatchSize: readPositiveInt(process.env.EMBEDDING_MAX_BATCH, 64),
    timeoutMs: readPositiveInt(process.env.EMBEDDING_TIMEOUT_MS, 60000)
  };
}

export function cosineSimilarity(vecA = [], vecB = []) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalizeCosineToUnitInterval(similarity) {
  const numeric = Number(similarity);
  if (!Number.isFinite(numeric)) return 0;
  // cosine ∈ [-1,1] -> [0,1]
  return Math.max(0, Math.min(1, (numeric + 1) / 2));
}

export function buildVectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return null;
  const parts = vector.map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });
  return `[${parts.join(',')}]`;
}

/**
 * True when an item's embedding cannot be compared with vectors produced by
 * the current model: missing, dimension mismatch, or model-version mismatch.
 * Stored version falls back to embedding_model for pre-versioning records.
 */
export function needsReembed(item, currentModelVersion = null, currentDim = null) {
  const embedding = item?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) return true;
  if (currentDim != null && embedding.length !== currentDim) return true;
  if (currentModelVersion != null) {
    const storedVersion = item?.embedding_model_version || item?.embedding_model || null;
    if (storedVersion !== currentModelVersion) return true;
  }
  return false;
}

/**
 * Top-k items by cosine similarity to queryVector using a min-heap (O(N log k)
 * instead of O(N log N) full sort). getVector(item) must return an array.
 */
export function topKByCosine(queryVector, items, k, getVector = null) {
  const kSafe = Math.max(0, Math.floor(Number(k) || 0));
  if (kSafe === 0 || !Array.isArray(items)) return [];
  const getter = getVector || ((item) => item?.embedding);

  const heap = [];

  function siftUp(index) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].score <= heap[i].score) break;
      const tmp = heap[parent];
      heap[parent] = heap[i];
      heap[i] = tmp;
      i = parent;
    }
  }

  function siftDown(index) {
    let i = index;
    const size = heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < size && heap[left].score < heap[smallest].score) smallest = left;
      if (right < size && heap[right].score < heap[smallest].score) smallest = right;
      if (smallest === i) break;
      const tmp = heap[smallest];
      heap[smallest] = heap[i];
      heap[i] = tmp;
      i = smallest;
    }
  }

  for (const item of items) {
    const score = cosineSimilarity(queryVector, getter(item) || []);
    if (heap.length < kSafe) {
      heap.push({ score, item });
      siftUp(heap.length - 1);
    } else if (score > heap[0].score) {
      heap[0] = { score, item };
      siftDown(0);
    }
  }

  heap.sort((a, b) => b.score - a.score);
  return heap.map((entry) => entry.item);
}

async function callOpenRouterEmbeddings(texts = [], options = {}) {
  const config = getEmbeddingConfig();
  const model = asTrimmedString(options.model, config.model);

  if (!OPENROUTER_API_KEY) {
    const err = new Error('API ключ для LLM не установлен: невозможно вычислить эмбеддинги');
    err.code = 'NO_OPENROUTER_KEY';
    throw err;
  }

  const input = Array.isArray(texts)
    ? texts.map((t) => (typeof t === 'string' ? t : '')).map((t) => t.trim())
    : [];

  const cleaned = input.map((t) => (t.length ? t : ' '));

  const response = await axios.post(
    OPENROUTER_EMBEDDINGS_URL,
    {
      model,
      input: cleaned
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
        'X-Title': 'IT Project Promotion App'
      },
      timeout: config.timeoutMs
    }
  );

  const items = response?.data?.data;
  if (!Array.isArray(items) || items.length !== cleaned.length) {
    const err = new Error('Некорректный ответ embeddings API: отсутствуют эмбеддинги');
    err.responseData = response?.data ?? null;
    throw err;
  }

  const embeddings = items.map((item) => item?.embedding);
  if (!embeddings.every((e) => Array.isArray(e) && e.length > 0)) {
    const err = new Error('Некорректный ответ embeddings API: embedding пустой');
    err.responseData = response?.data ?? null;
    throw err;
  }

  return {
    model,
    embeddings
  };
}

export async function embedTexts(texts = [], options = {}) {
  const config = getEmbeddingConfig();
  const maxBatchSize = readPositiveInt(options.maxBatchSize, config.maxBatchSize);
  const modelVersion = asTrimmedString(options.modelVersion, config.modelVersion);
  const allTexts = Array.isArray(texts) ? texts : [];

  const batches = [];
  for (let i = 0; i < allTexts.length; i += maxBatchSize) {
    batches.push(allTexts.slice(i, i + maxBatchSize));
  }

  const embeddings = [];
  let modelUsed = null;

  for (const batch of batches) {
    const result = await callOpenRouterEmbeddings(batch, options);
    modelUsed = modelUsed || result.model;
    embeddings.push(...result.embeddings);
  }

  return {
    model: modelUsed || getEmbeddingConfig().model,
    modelVersion,
    embeddings
  };
}


