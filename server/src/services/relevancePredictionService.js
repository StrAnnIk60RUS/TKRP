import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

import { embedTexts } from './embeddingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'ml', 'engagement_model.py');
const MODEL_DIR = path.join(__dirname, '..', '..', 'data', 'ml');
const MODEL_PATH = path.join(MODEL_DIR, 'engagement_model.joblib');

const EMBEDDING_TEXT_MAX_CHARS = 4000;
const PREDICT_BATCH_SIZE = 64;

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function truncateText(value, maxChars) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, Math.max(0, maxChars - 1)).trim();
}

function inferPostTypeFromFormat(format) {
  const f = typeof format === 'string' ? format.trim().toLowerCase() : '';
  if (f === 'video') return 'video_post';
  if (f === 'image') return 'image_post';
  if (f === 'combined') return 'combined_post';
  if (f === 'text') return 'text_post';
  return 'other';
}

function buildEmbeddingTextForGeneratedPublication(publication) {
  // В precedentRepository embedding-индекс строится из "лаконичного search-text" + raw_content.
  // Здесь у нас нет публикации в виде publication_model, поэтому собираем максимально близкий "search-text"
  // без префиксов типа `platform:` (важно, чтобы формат был таким же, как в конкурентной базе).

  const inferredType = inferPostTypeFromFormat(publication?.format);

  const baseParts = [
    publication?.platform ? String(publication.platform) : '',
    inferredType,
    publication?.topic ? String(publication.topic) : '',
    publication?.format ? String(publication.format) : '',
    'other', // content_category (аналог fallback в конкурентной базе)
    publication?.tone ? String(publication.tone) : '',
    'unknown', // funnel_stage
    publication?.objective ? String(publication.objective) : '',
    publication?.summary ? String(publication.summary) : ''
  ].filter(Boolean);

  // Аналог raw_content: в конкурентной базе это текст поста, у нас его нет.
  // Поэтому используем наиболее "плотные" строки из плана: key_message/cta.
  const contentSnippet = [publication?.key_message, publication?.cta]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join('\n');

  const joined = [baseParts.join(' '), contentSnippet].filter(Boolean).join('\n');
  return truncateText(joined, EMBEDDING_TEXT_MAX_CHARS);
}

function chunkArray(arr, size) {
  if (!Array.isArray(arr) || !size || size <= 0) return [];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function runPythonEngagementModel(mode, payload) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', ['-u', SCRIPT_PATH, mode], {
      cwd: path.join(__dirname, '..', '..'),
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

    const jsonPayload = payload ? JSON.stringify(payload) : JSON.stringify({});
    pythonProcess.stdin.write(jsonPayload);
    pythonProcess.stdin.end();

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(
          `Python engagement_model.py failed (mode=${mode}, exit_code=${code}): ${stderr || 'no stderr'}`
        );
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }

      try {
        const parsed = JSON.parse(stdout || '{}');
        resolve(parsed);
      } catch (e) {
        const err = new Error(`Failed to parse python stdout as JSON (mode=${mode}): ${e.message}`);
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      }
    });
  });
}

async function ensureModelTrained() {
  if (fs.existsSync(MODEL_PATH)) return;
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }

  // Train model from precedents.json in server/data (Python script reads it).
  await trainRelevanceModel();
}

export async function trainRelevanceModel() {
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }

  return runPythonEngagementModel('train', {});
}

export async function predictEngagementRatesForGeneratedPublications(publications, options = {}) {
  if (!Array.isArray(publications) || publications.length === 0) {
    return { updatedPublications: publications || [], avgEngagementRate: 0, engagementRates: [] };
  }

  const shouldForceTrain = Boolean(options.forceTrain);
  const modelExists = fs.existsSync(MODEL_PATH);

  if (shouldForceTrain || !modelExists) {
    // If forceTrain, we don't delete model to avoid race; Python overwrite is deterministic.
    await trainRelevanceModel();
  } else {
    await ensureModelTrained();
  }

  // 1) Embed publication fields.
  const texts = publications.map((p) => buildEmbeddingTextForGeneratedPublication(p));
  const textBatches = chunkArray(texts, 64);

  const embeddings = [];
  for (const batch of textBatches) {
    const result = await embedTexts(batch, { maxBatchSize: 64 });
    embeddings.push(...result.embeddings);
  }

  // 2) Predict in batches (avoid too big payloads).
  const embeddingBatches = chunkArray(embeddings, PREDICT_BATCH_SIZE);
  const engagementRates = [];

  for (const embeddingBatch of embeddingBatches) {
    const res = await runPythonEngagementModel('predict', { embeddings: embeddingBatch });
    if (!res || !Array.isArray(res.predictions)) {
      throw new Error('Python predict returned invalid payload');
    }
    engagementRates.push(...res.predictions);
  }

  const updatedPublications = publications.map((p, idx) => {
    const er = clamp01(engagementRates[idx]);
    const next = { ...p };
    next.expected_kpi = { ...(next.expected_kpi || {}) };
    next.expected_kpi.engagement_rate = er;
    next.expected_kpi.engagement_rate_source = 'ml_relevance_prediction';
    return next;
  });

  const avgEngagementRate =
    updatedPublications.length > 0
      ? clamp01(updatedPublications.reduce((acc, p) => acc + (p?.expected_kpi?.engagement_rate || 0), 0) / updatedPublications.length)
      : 0;

  return { updatedPublications, avgEngagementRate, engagementRates };
}

