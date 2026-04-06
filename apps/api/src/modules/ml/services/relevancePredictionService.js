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
const PYTHON_ML_ENV = {
  ML_MODEL_DIR: MODEL_DIR
};

const MODEL_SPECS = {
  post: {
    modelPath: path.join(MODEL_DIR, 'post_metrics_model.joblib'),
    metadataPath: path.join(MODEL_DIR, 'post_metrics_model_metadata.json'),
    featureNames: POST_FEATURE_NAMES,
    targetNames: ['likes', 'shares', 'views']
  },
  content_plan: {
    modelPath: path.join(MODEL_DIR, 'plan_metrics_model.joblib'),
    metadataPath: path.join(MODEL_DIR, 'plan_metrics_model_metadata.json'),
    featureNames: PLAN_FEATURE_NAMES,
    targetNames: ['total_likes', 'total_shares', 'total_views']
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

function sanitizeFeatureMatrix(featureVectors, contextLabel = 'unknown') {
  if (!Array.isArray(featureVectors)) {
    return { matrix: [], replacements: 0 };
  }

  let replacements = 0;
  const matrix = featureVectors.map((row) => {
    if (!Array.isArray(row)) return [];
    return row.map((value) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      replacements += 1;
      return 0;
    });
  });

  if (replacements > 0) {
    console.warn(
      `[relevancePredictionService] Sanitized non-finite feature values for ${contextLabel}: ${replacements}`
    );
  }

  return { matrix, replacements };
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

function getMlModelMetadata() {
  return {
    post: getModelMetadata('post'),
    content_plan: getModelMetadata('content_plan')
  };
}

/**
 * Нормализация отдельной метрики в интервал [0,1] для UI
 * @param {number} value - предсказанное значение
 * @param {object} metadata - метаданные модели с target_summary
 * @param {string} metricName - имя метрики (likes, shares, views, total_likes и т.д.)
 * @returns {number} нормализованное значение 0..1
 */
function normalizeMetricToUnitInterval(value, metadata, metricName) {
  const safeValue = clampPositive(value);
  const maxTarget = metadata?.target_summary?.[metricName]?.max ?? 1;
  if (maxTarget <= 0) return 0;
  // Используем log1p для сглаживания выбросов
  return clamp01(Math.log1p(safeValue) / Math.log1p(maxTarget));
}

/**
 * Нормализация лайков (оставлено для обратной совместимости)
 */
function normalizeLikesToUnitInterval(likes, metadata) {
  return normalizeMetricToUnitInterval(likes, metadata, 'likes');
}

function capContentPlanMetrics(predictedMetrics, metadata = null) {
  const [likes, shares, views] = predictedMetrics;
  const maxLikes = Number(metadata?.target_summary?.total_likes?.max) || 0;
  const maxShares = Number(metadata?.target_summary?.total_shares?.max) || 0;
  const maxViews = Number(metadata?.target_summary?.total_views?.max) || 0;
  
  return [
    maxLikes > 0 ? Math.min(clampPositive(likes), maxLikes * 1.15) : clampPositive(likes),
    maxShares > 0 ? Math.min(clampPositive(shares), maxShares * 1.15) : clampPositive(shares),
    maxViews > 0 ? Math.min(clampPositive(views), maxViews * 1.15) : clampPositive(views)
  ];
}

/**
 * Вычисление engagement rate из предсказанных метрик
 * Формула: (likes + shares * 2) / views, кап на 1
 */
function calculateEngagementRateFromMetrics(metrics) {
  const { likes, shares, views } = metrics;
  if (views === 0) return 0;
  const raw = (likes + shares * 2) / Math.max(1, views);
  return clamp01(raw);
}

function runPythonModel(mode, modelKey, payload) {
  if (USE_PERSISTENT_ML_WORKER) {
    if (!mlWorker) {
      mlWorker = createPythonJsonWorker({
        scriptPath: SCRIPT_PATH,
        // engagement_model.py enters persistent mode when started without CLI args
        args: [],
        cwd: APP_ROOT,
        env: PYTHON_ML_ENV,
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
          env: PYTHON_ML_ENV,
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
    env: PYTHON_ML_ENV,
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
    const sanitized = sanitizeFeatureMatrix(datasets.postDataset.features, 'train/post');
    return {
      features: sanitized.matrix,
      targets: datasets.postDataset.targets,
      feature_names: datasets.postDataset.featureNames
    };
  }
  const sanitized = sanitizeFeatureMatrix(datasets.contentPlanDataset.features, 'train/content_plan');
  return {
    features: sanitized.matrix,
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
  await trainMetricsModel(modelKey);
}

/**
 * Предсказание метрик для постов по feature векторам
 * @returns {Promise<{ predictions: number[][], metadata: object }>}
 * predictions: массив массивов [[likes, shares, views], ...]
 */
async function predictPostMetricsByFeatureVectors(featureVectors, options = {}) {
  if (!Array.isArray(featureVectors) || featureVectors.length === 0) {
    return { predictions: [], metadata: null };
  }
  const sanitized = sanitizeFeatureMatrix(featureVectors, 'predict/post');

  await ensureModelTrained('post', options);
  const batches = chunkArray(sanitized.matrix, 128);
  const allPredictions = [];
  let metadata = null;

  for (const batch of batches) {
    const result = await runPythonModel('predict', 'post', { features: batch });
    if (!result || !Array.isArray(result.predictions)) {
      throw new Error(`Python predict returned invalid payload for post model`);
    }
    allPredictions.push(...result.predictions);
    metadata = result.model_metadata || metadata;
  }

  if (!metadata) {
    metadata = getModelMetadata('post');
  }

  return { predictions: allPredictions, metadata };
}

/**
 * Предсказание метрик для планов по feature векторам
 * @returns {Promise<{ predictions: number[][], metadata: object }>}
 * predictions: массив массивов [[total_likes, total_shares, total_views], ...]
 */
async function predictPlanMetricsByFeatureVectors(featureVectors, options = {}) {
  if (!Array.isArray(featureVectors) || featureVectors.length === 0) {
    return { predictions: [], metadata: null };
  }
  const sanitized = sanitizeFeatureMatrix(featureVectors, 'predict/content_plan');

  await ensureModelTrained('content_plan', options);
  const batches = chunkArray(sanitized.matrix, 128);
  const allPredictions = [];
  let metadata = null;

  for (const batch of batches) {
    const result = await runPythonModel('predict', 'content_plan', { features: batch });
    if (!result || !Array.isArray(result.predictions)) {
      throw new Error(`Python predict returned invalid payload for plan model`);
    }
    allPredictions.push(...result.predictions);
    metadata = result.model_metadata || metadata;
  }

  if (!metadata) {
    metadata = getModelMetadata('content_plan');
  }

  return { predictions: allPredictions, metadata };
}

/**
 * Обучение модели для указанного ключа (post или content_plan)
 */
async function trainMetricsModel(modelKey) {
  const payload = getTrainingPayload(modelKey);
  if (!payload.features.length) {
    throw new Error(`No training samples available for model ${modelKey}`);
  }
  return enqueueTraining(modelKey, () => runPythonModel('train', modelKey, payload));
}

async function trainPostMetricsModel() {
  return trainMetricsModel('post');
}

async function trainPlanMetricsModel() {
  return trainMetricsModel('content_plan');
}

async function trainRelevanceModel() {
  const [postModel, planModel] = await Promise.all([
    trainPostMetricsModel(),
    trainPlanMetricsModel()
  ]);
  return {
    success: true,
    models: {
      post: postModel,
      content_plan: planModel
    },
    metadata: {
      post: postModel?.metadata || null,
      content_plan: planModel?.metadata || null
    }
  };
}

/**
 * Предсказание метрик для списка публикаций
 * @param {Array} publications - массив публикаций
 * @param {Object} options - опции
 * @returns {Promise<{ predictions: number[][], normalizedScores: object[], featureVectors: number[][], metadata: object, planFeatureMap: object }>}
 */
async function predictPostMetricsForPublications(publications, options = {}) {
  if (!Array.isArray(publications) || publications.length === 0) {
    return {
      predictions: [],
      normalizedScores: [],
      featureVectors: [],
      metadata: null,
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
  
  const { predictions, metadata } = await predictPostMetricsByFeatureVectors(featureVectors, options);
  
  // Нормализуем каждую метрику отдельно для UI
  const normalizedScores = predictions.map((pred) => ({
    likes: normalizeMetricToUnitInterval(pred[0], metadata, 'likes'),
    shares: normalizeMetricToUnitInterval(pred[1], metadata, 'shares'),
    views: normalizeMetricToUnitInterval(pred[2], metadata, 'views')
  }));

  return {
    predictions,
    normalizedScores,
    featureVectors,
    metadata,
    planFeatureMap
  };
}

/**
 * Предсказание метрик для контент-плана
 * @param {Object|Array} planOrPublications - план с publications или массив публикаций
 * @param {Object} options - опции
 * @returns {Promise<{ predictedLikes: number, predictedShares: number, predictedViews: number, normalizedLikes: number, normalizedShares: number, normalizedViews: number, featureVector: number[], featureMap: object, metadata: object }>}
 */
async function predictContentPlanMetrics(planOrPublications, options = {}) {
  const publications = Array.isArray(planOrPublications)
    ? planOrPublications
    : Array.isArray(planOrPublications?.publications)
    ? planOrPublications.publications
    : [];
    
  const expectedPlatforms = options.expectedPlatforms || 
    (Array.isArray(planOrPublications?.platforms) ? planOrPublications.platforms : []);
  const targetAudience = options.targetAudience ||
    (Array.isArray(planOrPublications?.target_audience) ? planOrPublications.target_audience : []);
    
  const planFeatureMap = buildPlanFeatureMap(publications, {
    durationDays: options.durationDays || planOrPublications?.planning_horizon?.duration_days,
    expectedPlatforms,
    targetAudience
  });
  
  const featureVector = buildPlanFeatureVector(publications, {
    durationDays: planFeatureMap.duration_days,
    expectedPlatforms,
    targetAudience
  });
  
  const { predictions, metadata } = await predictPlanMetricsByFeatureVectors([featureVector], options);
  const rawPredicted = predictions[0] || [0, 0, 0];
  const cappedPredicted = capContentPlanMetrics(rawPredicted, metadata);
  
  const [likes, shares, views] = cappedPredicted;
  
  return {
    predictedLikes: likes,
    predictedShares: shares,
    predictedViews: views,
    normalizedLikes: normalizeMetricToUnitInterval(likes, metadata, 'total_likes'),
    normalizedShares: normalizeMetricToUnitInterval(shares, metadata, 'total_shares'),
    normalizedViews: normalizeMetricToUnitInterval(views, metadata, 'total_views'),
    featureVector,
    featureMap: planFeatureMap,
    metadata
  };
}

/**
 * Предсказание engagement rate для сгенерированных публикаций
 * (обновляет expected_kpi каждой публикации)
 * @param {Array} publications - массив публикаций
 * @param {Object} options - опции
 * @returns {Promise<{ updatedPublications: Array, avgEngagementRate: number, engagementRates: number[], predictions: number[][], totalPredictedLikes: number, totalPredictedShares: number, totalPredictedViews: number, modelMetadata: object }>}
 */
async function predictEngagementRatesForGeneratedPublications(publications, options = {}) {
  if (!Array.isArray(publications) || publications.length === 0) {
    return {
      updatedPublications: publications || [],
      avgEngagementRate: 0,
      engagementRates: [],
      predictions: [],
      totalPredictedLikes: 0,
      totalPredictedShares: 0,
      totalPredictedViews: 0,
      modelMetadata: null
    };
  }

  const result = await predictPostMetricsForPublications(publications, options);
  const engagementRates = [];
  let totalLikes = 0;
  let totalShares = 0;
  let totalViews = 0;
  
  const updatedPublications = publications.map((publication, index) => {
    const pred = result.predictions[index] || [0, 0, 0];
    const [likes, shares, views] = pred;
    totalLikes += likes;
    totalShares += shares;
    totalViews += views;
    
    const engagementRate = calculateEngagementRateFromMetrics({ likes, shares, views });
    engagementRates.push(engagementRate);
    
    const next = { ...publication };
    next.expected_kpi = {
      ...(next.expected_kpi || {}),
      predicted_likes: likes,
      predicted_shares: shares,
      predicted_views: views,
      predicted_likes_source: 'ml_post_metrics_prediction',
      engagement_rate: engagementRate,
      engagement_rate_source: 'ml_post_metrics_calculated'
    };
    next.ontology_features = result.featureVectors[index];
    return next;
  });

  return {
    updatedPublications,
    avgEngagementRate: clamp01(average(engagementRates)),
    engagementRates,
    predictions: result.predictions,
    totalPredictedLikes: totalLikes,
    totalPredictedShares: totalShares,
    totalPredictedViews: totalViews,
    modelMetadata: result.metadata
  };
}

// ========== ЭКСПОРТЫ ДЛЯ ОБРАТНОЙ СОВМЕСТИМОСТИ (deprecated) ==========
// Старые имена функций оставлены для плавного перехода

async function predictPostLikesByFeatureVectors(featureVectors, options = {}) {
  const { predictions, metadata } = await predictPostMetricsByFeatureVectors(featureVectors, options);
  // Возвращаем только лайки для совместимости
  return {
    predictions: predictions.map(p => p[0]),
    metadata
  };
}

async function predictPostLikesForPublications(publications, options = {}) {
  const result = await predictPostMetricsForPublications(publications, options);
  return {
    predictions: result.predictions.map(p => p[0]),
    normalizedScores: result.normalizedScores.map(s => s.likes),
    featureVectors: result.featureVectors,
    metadata: result.metadata,
    planFeatureMap: result.planFeatureMap
  };
}

async function predictContentPlanLikes(planOrPublications, options = {}) {
  const result = await predictContentPlanMetrics(planOrPublications, options);
  return {
    predictedLikes: result.predictedLikes,
    normalizedScore: result.normalizedLikes,
    featureVector: result.featureVector,
    featureMap: result.featureMap,
    metadata: result.metadata
  };
}

async function trainPostLikesModel() {
  return trainPostMetricsModel();
}

async function trainContentPlanLikesModel() {
  return trainPlanMetricsModel();
}

// ========== ОСНОВНЫЕ ЭКСПОРТЫ ==========
export {
  // Новые основные функции
  predictPostMetricsByFeatureVectors,
  predictPlanMetricsByFeatureVectors,
  predictPostMetricsForPublications,
  predictContentPlanMetrics,
  predictEngagementRatesForGeneratedPublications,
  trainPostMetricsModel,
  trainPlanMetricsModel,
  trainRelevanceModel,
  getMlModelMetadata,
  normalizeMetricToUnitInterval,
  normalizeLikesToUnitInterval,
  calculateEngagementRateFromMetrics,
  // Устаревшие, но оставленные для совместимости
  predictPostLikesByFeatureVectors,
  predictPostLikesForPublications,
  predictContentPlanLikes,
  trainPostLikesModel,
  trainContentPlanLikesModel
};