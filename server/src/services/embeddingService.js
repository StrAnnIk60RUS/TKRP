import axios from 'axios';
import { OPENROUTER_API_KEY } from '../../openrouter.js';

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

function readPositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function asTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function getEmbeddingConfig() {
  return {
    model: asTrimmedString(process.env.EMBEDDING_MODEL, 'text-embedding-3-small'),
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

async function callOpenRouterEmbeddings(texts = [], options = {}) {
  const config = getEmbeddingConfig();
  const model = asTrimmedString(options.model, config.model);

  if (!OPENROUTER_API_KEY) {
    const err = new Error('OPENROUTER_API_KEY не установлен: невозможно вычислить эмбеддинги');
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
    embeddings
  };
}

