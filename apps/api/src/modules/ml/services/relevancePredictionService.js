import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildMlTrainingDatasets,
  buildPlanFeatureMap,
  buildPlanFeatureVector,
  buildPostFeatureVector,
  PLAN_FEATURE_NAMES,
  POST_FEATURE_NAMES
} from './ml/ontologyFeatureEngineering.js';
import { runPythonJsonProcess } from '../../../shared/runtime/pythonRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REPO_ROOT = path.join(APP_ROOT, '..', '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const PRECEDENTS_ROOT = path.join(DATA_ROOT, 'precedents');
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools', 'ml', 'engagement_model.py');
const MODEL_DIR = path.join(DATA_ROOT, 'ml');
const ML_TIMEOUT_MS = Number(process.env.ML_SCRIPT_TIMEOUT_MS || 180000);

const MODEL_SPECS = {
  post: {
    modelPath: path.join(MODEL_DIR, 'post_likes_model.joblib'),
    metadataPath: path.join(MODEL_DIR, 'post_likes_model_metadata.json'),
    featureNames: POST_FEATURE_NAMES
  },
  content_plan: {
    modelPath: path.join(MODEL_DIR, 'content_plan_likes_model.joblib'),
    metadataPath: path.join(MODEL_DIR, 'content_plan_likes_model_metadata.json'),
    featureNames: PLAN_FEATURE_NAMES
  }
};

const trainingQueues = {
  post: Promise.resolve(),
  content_plan: Promise.resolve()
};

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function clampPositive(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function average(values = []) {
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function chunkArray(arr, size) {
  if (!Array.isArray(arr) || size <= 0) return [];
  const result = [];
  for (let index = 0; index < arr.length; index += size) {
    result.push(arr.slice(index, index + size));
  }
  return result;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn('[relevancePredictionService] Failed to read JSON:', filePath, error?.message || error);
    return fallback;
  }
}

function readPrecedentSnapshot() {
  return {
    publications: readJson(path.join(PRECEDENTS_ROOT, 'publications.json'), []),
    content_plans: readJson(path.join(PRECEDENTS_ROOT, 'content_plans.json'), [])
  };
}

function getModelSpec(modelKey) {
  const spec = MODEL_SPECS[modelKey];
  if (!spec) {
    throw new Error(`Unknown model key: ${modelKey}`);
  }
  return spec;
}

function getModelMetadata(modelKey) {
  const spec = getModelSpec(modelKey);
  return readJson(spec.metadataPath, null);
}

function normalizeLikesToUnitInterval(likes, metadata) {
  const maxTarget = Number(metadata?.target_summary?.max) || 1;
  if (maxTarget <= 0) return 0;
  return clamp01(Math.log1p(clampPositive(likes)) / Math.log1p(maxTarget));
}

function runPythonModel(mode, modelKey, payload) {
  return runPythonJsonProcess({
    scriptPath: SCRIPT_PATH,
    args: [mode, modelKey],
    cwd: APP_ROOT,
    input: payload || {},
    timeoutMs: ML_TIMEOUT_MS,
    description: `engagement_model.py ${mode} ${modelKey}`
  }).then((result) => result.parsed);
}

function enqueueTraining(modelKey, trainFactory) {
  const trainJob = trainingQueues[modelKey].then(() => trainFactory());
  trainingQueues[modelKey] = trainJob.then(
    () => undefined,
    () => undefined
  );
  return trainJob;
}

function getTrainingPayload(modelKey) {
  const snapshot = readPrecedentSnapshot();
  const datasets = buildMlTrainingDatasets(snapshot);
  if (modelKey === 'post') {
    return {
      features: datasets.postDataset.features,
      targets: datasets.postDataset.targets,
      feature_names: datasets.postDataset.featureNames
    };
  }
  return {
    features: datasets.contentPlanDataset.features,
    targets: datasets.contentPlanDataset.targets,
    feature_names: datasets.contentPlanDataset.featureNames
  };
}

async function ensureModelTrained(modelKey, options = {}) {
  const { forceTrain = false } = options;
  const spec = getModelSpec(modelKey);
  if (!forceTrain && fs.existsSync(spec.modelPath)) return;
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }
  await trainLikesModel(modelKey);
}

async function predictByFeatureVectors(modelKey, featureVectors, options = {}) {
  if (!Array.isArray(featureVectors) || featureVectors.length === 0) {
    return { predictions: [], metadata: getModelMetadata(modelKey) };
  }

  await ensureModelTrained(modelKey, options);
  const batches = chunkArray(featureVectors, 128);
  const predictions = [];
  let metadata = null;

  for (const batch of batches) {
    const result = await runPythonModel('predict', modelKey, { features: batch });
    if (!result || !Array.isArray(result.predictions)) {
      throw new Error(`Python predict returned invalid payload for model ${modelKey}`);
    }
    predictions.push(...result.predictions.map((value) => clampPositive(value)));
    metadata = result.model_metadata || metadata;
  }

  return { predictions, metadata };
}

export async function predictPostLikesByFeatureVectors(featureVectors, options = {}) {
  return predictByFeatureVectors('post', featureVectors, options);
}

export async function predictContentPlanLikesByFeatureVectors(featureVectors, options = {}) {
  return predictByFeatureVectors('content_plan', featureVectors, options);
}

export async function trainLikesModel(modelKey) {
  const payload = getTrainingPayload(modelKey);
  if (!payload.features.length) {
    throw new Error(`No training samples available for model ${modelKey}`);
  }
  return enqueueTraining(modelKey, () => runPythonModel('train', modelKey, payload));
}

export async function trainPostLikesModel() {
  return trainLikesModel('post');
}

export async function trainContentPlanLikesModel() {
  return trainLikesModel('content_plan');
}

export async function trainRelevanceModel() {
  const [postModel, contentPlanModel] = await Promise.all([
    trainPostLikesModel(),
    trainContentPlanLikesModel()
  ]);
  return {
    success: true,
    models: {
      post: postModel,
      content_plan: contentPlanModel
    },
    metadata: {
      post: postModel?.metadata || null,
      content_plan: contentPlanModel?.metadata || null
    }
  };
}

export async function predictPostLikesForPublications(publications, options = {}) {
  if (!Array.isArray(publications) || publications.length === 0) {
    return {
      predictions: [],
      normalizedScores: [],
      featureVectors: [],
      metadata: getModelMetadata('post'),
      planFeatureMap: buildPlanFeatureMap([])
    };
  }

  const planFeatureMap = buildPlanFeatureMap(publications, {
    durationDays: options.durationDays
  });
  const featureVectors = publications.map((publication) =>
    buildPostFeatureVector(publication, {
      tonesCount: planFeatureMap.unique_tones,
      creativityFromBestPlan: planFeatureMap.avg_creativity
    })
  );
  const { predictions, metadata } = await predictByFeatureVectors('post', featureVectors, options);
  const normalizedScores = predictions.map((prediction) => normalizeLikesToUnitInterval(prediction, metadata));

  return {
    predictions,
    normalizedScores,
    featureVectors,
    metadata,
    planFeatureMap
  };
}

export async function predictContentPlanLikes(planOrPublications, options = {}) {
  const publications = Array.isArray(planOrPublications)
    ? planOrPublications
    : Array.isArray(planOrPublications?.publications)
    ? planOrPublications.publications
    : [];
  const planFeatureMap = buildPlanFeatureMap(publications, {
    durationDays: options.durationDays || planOrPublications?.planning_horizon?.duration_days
  });
  const featureVector = buildPlanFeatureVector(publications, {
    durationDays: planFeatureMap.duration_days
  });
  const { predictions, metadata } = await predictByFeatureVectors('content_plan', [featureVector], options);
  const predictedLikes = clampPositive(predictions[0]);

  return {
    predictedLikes,
    normalizedScore: normalizeLikesToUnitInterval(predictedLikes, metadata),
    featureVector,
    featureMap: planFeatureMap,
    metadata
  };
}

export function getMlModelMetadata() {
  return {
    post: getModelMetadata('post'),
    content_plan: getModelMetadata('content_plan')
  };
}

export async function predictEngagementRatesForGeneratedPublications(publications, options = {}) {
  if (!Array.isArray(publications) || publications.length === 0) {
    return {
      updatedPublications: publications || [],
      avgEngagementRate: 0,
      engagementRates: [],
      predictedLikes: [],
      totalPredictedLikes: 0
    };
  }

  const result = await predictPostLikesForPublications(publications, options);
  const updatedPublications = publications.map((publication, index) => {
    const predictedLikes = clampPositive(result.predictions[index]);
    const engagementRate = clamp01(result.normalizedScores[index]);
    const next = { ...publication };
    next.expected_kpi = { ...(next.expected_kpi || {}) };
    next.expected_kpi.predicted_likes = predictedLikes;
    next.expected_kpi.predicted_likes_source = 'ml_post_likes_prediction';
    next.expected_kpi.engagement_rate = engagementRate;
    next.expected_kpi.engagement_rate_source = 'ml_post_likes_normalized';
    next.ontology_features = result.featureVectors[index];
    return next;
  });

  return {
    updatedPublications,
    avgEngagementRate: clamp01(average(result.normalizedScores)),
    engagementRates: result.normalizedScores,
    predictedLikes: result.predictions,
    totalPredictedLikes: result.predictions.reduce((sum, value) => sum + clampPositive(value), 0),
    modelMetadata: result.metadata,
    planFeatureMap: result.planFeatureMap
  };
}

