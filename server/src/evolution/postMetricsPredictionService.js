import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { runPythonJsonProcess } from '../services/pythonRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '..', '..', 'ml', 'post_metrics_model.py');
const MODEL_DIR = path.join(__dirname, '..', '..', 'data', 'ml');
const MODEL_PATH = path.join(MODEL_DIR, 'post_metrics_model.joblib');
const ML_TIMEOUT_MS = Number(process.env.ML_SCRIPT_TIMEOUT_MS || 180000);

let modelTrainingQueue = Promise.resolve();

async function ensureModelTrained() {
  if (fs.existsSync(MODEL_PATH)) return;
  await trainPostMetricsModel();
}

function runPythonPostMetricsModel(mode, payload) {
  return runPythonJsonProcess({
    scriptPath: SCRIPT_PATH,
    args: [mode],
    cwd: path.join(__dirname, '..', '..'),
    input: payload || {},
    timeoutMs: ML_TIMEOUT_MS,
    description: `post_metrics_model.py (${mode})`
  }).then((result) => result.parsed);
}

export async function trainPostMetricsModel() {
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });
  const trainJob = modelTrainingQueue.then(() => runPythonPostMetricsModel('train', {}));
  modelTrainingQueue = trainJob.then(() => undefined, () => undefined);
  return trainJob;
}

export async function predictPostMetricsFromOntologyFeatures(featuresBatch, options = {}) {
  if (!Array.isArray(featuresBatch) || featuresBatch.length === 0) {
    return { predictions: [], model_metadata: null };
  }
  const shouldForceTrain = Boolean(options.forceTrain);
  const modelExists = fs.existsSync(MODEL_PATH);
  if (shouldForceTrain || !modelExists) await trainPostMetricsModel();
  else await ensureModelTrained();
  return await runPythonPostMetricsModel('predict', { features: featuresBatch });
}

