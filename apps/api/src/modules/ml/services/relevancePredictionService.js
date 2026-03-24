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
import { createPythonJsonWorker } from '../../../shared/runtime/pythonJsonWorker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REPO_ROOT = path.join(APP_ROOT, '..', '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const PRECEDENTS_ROOT = path.join(DATA_ROOT, 'precedents');
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools', 'ml', 'engagement_model.py');
const MODEL_DIR = path.join(DATA_ROOT, 'ml');
const ML_TIMEOUT_MS = Number(process.env.ML_SCRIPT_TIMEOUT_MS || 180000);
const USE_PERSISTENT_ML_WORKER = String(process.env.ML_PERSISTENT_WORKER || '1') !== '0';

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
let mlWorker = null;

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
  const minTarget = Number(metadata?.target_summary?.min);
  const maxTarget = Number(metadata?.target_summary?.max) || 1;
  const safeLikes = clampPositive(likes);

  if (Number.isFinite(minTarget) && maxTarget > minTarget) {
    const bounded = Math.min(maxTarget, Math.max(minTarget, safeLikes));
    const normalized = (bounded - minTarget) / (maxTarget - minTarget);
    // Keep some headroom to avoid visual "all 100%" saturation in UI.
    return clamp01(0.05 + normalized * 0.9);
  }
  if (maxTarget <= 0) return 0;
  return clamp01((Math.log1p(safeLikes) / Math.log1p(maxTarget)) * 0.95);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function capContentPlanLikes(predictedLikes, metadata = null) {
  const safeLikes = clampPositive(predictedLikes);
  const maxTarget = Number(metadata?.target_summary?.max);
  if (!Number.isFinite(maxTarget) || maxTarget <= 0) return safeLikes;
  return Math.min(safeLikes, maxTarget * 1.15);
}

function getPublicationCalibrationSamples() {
  const snapshot = readPrecedentSnapshot();
  return (snapshot?.publications || [])
    .map((item) => {
      const model = item?.publication_model || {};
      const kpiEstimate = model?.kpi_estimate || item?.expected_kpi || {};
      const likes = clampPositive(item?.metrics?.likes ?? item?.expected_kpi?.predicted_likes ?? item?.likes);
      const engagementRate = clamp01(kpiEstimate?.expected_engagement_rate ?? item?.engagement_rate ?? 0);
      const conversionPotential = clamp01(
        kpiEstimate?.expected_conversion_potential ?? item?.expected_kpi?.conversion_potential ?? 0
      );
      const reachPotential = clamp01(
        kpiEstimate?.expected_reach_potential ?? item?.expected_kpi?.reach_potential ?? 0
      );
      return {
        likes,
        engagementRate,
        conversionPotential,
        reachPotential,
        objective: normalizeKey(model?.objective || item?.objective),
        format: normalizeKey(model?.format || item?.format),
        tone: normalizeKey(model?.tone || item?.tone)
      };
    })
    .filter((sample) => sample.likes > 0 && (sample.engagementRate > 0 || sample.conversionPotential > 0 || sample.reachPotential > 0))
    .sort((left, right) => left.likes - right.likes);
}

function weightedAverage(entries = [], valueSelector, fallback = 0) {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    const value = Number(valueSelector(entry));
    const weight = Number(entry?.weight);
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedSum += value * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) return fallback;
  return weightedSum / totalWeight;
}

export function estimatePublicationKpiFromLikes(predictedLikes, publication = {}, metadata = null) {
  const safeLikes = clampPositive(predictedLikes);
  const objective = normalizeKey(publication?.objective);
  const format = normalizeKey(publication?.format);
  const tone = normalizeKey(publication?.tone);
  const hasCta =
    Boolean(publication?.cta && String(publication.cta).trim()) ||
    clamp01(publication?.ontology_features?.has_cta) > 0;
  const fallbackEngagement = clamp01(0.01 + normalizeLikesToUnitInterval(safeLikes, metadata) * 0.11);
  const samples = getPublicationCalibrationSamples();

  if (!samples.length) {
    return {
      engagement_rate: fallbackEngagement,
      conversion_potential: clamp01(fallbackEngagement * 1.35 + (hasCta ? 0.02 : 0.006)),
      reach_potential: clamp01(0.18 + fallbackEngagement * 2.4)
    };
  }

  const nearest = samples
    .map((sample) => {
      let distance = Math.abs(sample.likes - safeLikes);
      if (objective && sample.objective) distance *= sample.objective === objective ? 0.72 : 1.08;
      if (format && sample.format) distance *= sample.format === format ? 0.86 : 1.04;
      if (tone && sample.tone) distance *= sample.tone === tone ? 0.92 : 1.03;
      return {
        sample,
        weight: 1 / (distance + 5)
      };
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 12);

  const engagementRate = clamp01(
    weightedAverage(nearest, (entry) => entry.sample.engagementRate, fallbackEngagement) * 0.85 +
      fallbackEngagement * 0.15
  );
  const objectiveAdjustment =
    objective === 'convert'
      ? 0.03
      : objective === 'retain'
      ? 0.015
      : objective === 'engage'
      ? 0.008
      : objective === 'educate'
      ? 0.004
      : 0.01;
  const formatAdjustment =
    format === 'video' || format === 'reel'
      ? 0.03
      : format === 'image' || format === 'carousel'
      ? 0.02
      : format === 'combined'
      ? 0.015
      : 0.008;
  const conversionPotential = clamp01(
    weightedAverage(nearest, (entry) => entry.sample.conversionPotential, 0.05) * 0.8 +
      engagementRate * 0.35 +
      objectiveAdjustment +
      (hasCta ? 0.012 : -0.004)
  );
  const reachPotential = clamp01(
    weightedAverage(nearest, (entry) => entry.sample.reachPotential, 0.22) * 0.82 +
      engagementRate * 0.55 +
      formatAdjustment
  );

  return {
    engagement_rate: engagementRate,
    conversion_potential: conversionPotential,
    reach_potential: reachPotential
  };
}

function runPythonModel(mode, modelKey, payload) {
  if (USE_PERSISTENT_ML_WORKER) {
    if (!mlWorker) {
      mlWorker = createPythonJsonWorker({
        scriptPath: SCRIPT_PATH,
        args: ['serve'],
        cwd: APP_ROOT,
        description: 'engagement_model.py serve'
      });
    }

    return mlWorker
      .request({
        mode,
        model_key: modelKey,
        payload: payload || {}
      })
      .catch(async (error) => {
        // Fallback to one-shot execution if worker is unhealthy.
        try {
          mlWorker?.dispose?.();
        } catch (_disposeError) {
          // no-op
        }
        mlWorker = null;
        const fallback = await runPythonJsonProcess({
          scriptPath: SCRIPT_PATH,
          args: [mode, modelKey],
          cwd: APP_ROOT,
          input: payload || {},
          timeoutMs: ML_TIMEOUT_MS,
          description: `engagement_model.py ${mode} ${modelKey}`
        });
        if (fallback?.parsed) return fallback.parsed;
        throw error;
      });
  }

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
  const predictedLikes = capContentPlanLikes(predictions[0], metadata);

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
  const engagementRates = [];
  const updatedPublications = publications.map((publication, index) => {
    const predictedLikes = clampPositive(result.predictions[index]);
    const estimatedKpi = estimatePublicationKpiFromLikes(predictedLikes, publication, result.metadata);
    const engagementRate = clamp01(estimatedKpi.engagement_rate);
    engagementRates.push(engagementRate);
    const next = { ...publication };
    next.expected_kpi = { ...(next.expected_kpi || {}) };
    next.expected_kpi.predicted_likes = predictedLikes;
    next.expected_kpi.predicted_likes_source = 'ml_post_likes_prediction';
    next.expected_kpi.engagement_rate = engagementRate;
    next.expected_kpi.engagement_rate_source = 'ml_post_likes_calibrated';
    next.expected_kpi.conversion_potential = estimatedKpi.conversion_potential;
    next.expected_kpi.reach_potential = estimatedKpi.reach_potential;
    next.ontology_features = result.featureVectors[index];
    return next;
  });

  return {
    updatedPublications,
    avgEngagementRate: clamp01(average(engagementRates)),
    engagementRates,
    predictedLikes: result.predictions,
    totalPredictedLikes: result.predictions.reduce((sum, value) => sum + clampPositive(value), 0),
    modelMetadata: result.metadata,
    planFeatureMap: result.planFeatureMap
  };
}

