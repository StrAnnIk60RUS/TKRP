import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  buildMlTrainingDatasets,
  buildPlanFeatureMap,
  buildPlanFeatureVector,
  buildPostFeatureVector,
  FEATURE_SET_VERSION,
  LEGACY_FEATURE_SET_VERSION,
  getOntologyFeatureMode,
  PLAN_FEATURE_NAMES,
  POST_FEATURE_NAMES
} from './ml/ontologyFeatureEngineering.js';
import { runPythonJsonProcess } from '../../../shared/runtime/pythonRuntime.js';
import { createPythonJsonWorker } from '../../../shared/runtime/pythonJsonWorker.js';
import { getPrecedentsSnapshot } from '../../precedents/repositories/precedentRepository.js';
import { isDatabaseEnabled } from '../../../shared/db/client.js';
import { listSnapshots, loadSnapshot } from '../../planning/services/planSnapshotStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..', '..', '..', '..');
const REPO_ROOT = path.join(APP_ROOT, '..', '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
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

async function readPrecedentSnapshot() {
  // Always use DB (JSON storage removed)
  if (!isDatabaseEnabled()) {
    throw new Error('Database is not enabled; JSON fallback for precedent snapshot is removed.');
  }
  const snapshot = await getPrecedentsSnapshot();
  return {
    publications: snapshot.publications || [],
    content_plans: snapshot.content_plans || []
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

/**
 * Compares feature set version of a loaded model with the current one.
 * Legacy artifacts (no version metadata) are treated as LEGACY_FEATURE_SET_VERSION
 * and only produce a warning; an explicit mismatch produces a louder warning.
 * @param {string} modelKey - 'post' | 'content_plan'
 * @returns {{ current: string, model: string, match: boolean, legacy: boolean }}
 */
function checkModelFeatureSetVersion(modelKey) {
  const metadata = getModelMetadata(modelKey);
  const modelVersion = metadata?.feature_set_version || LEGACY_FEATURE_SET_VERSION;
  const legacy = !metadata?.feature_set_version;
  const match = modelVersion === FEATURE_SET_VERSION;
  if (!match) {
    console.warn(
      `[relevancePredictionService] Feature set version mismatch for ${modelKey}: ` +
      `model=${modelVersion}${legacy ? ' (legacy, unversioned)' : ''}, current=${FEATURE_SET_VERSION}. ` +
      `Retrain via /ml/relevance/train or run tools/ml/migrate_model_versions.py.`
    );
  }
  const ontologyState = getOntologyFeatureMode();
  const modelOntology = metadata?.ontology_features_enabled;
  if (modelOntology !== undefined && Boolean(modelOntology) !== Boolean(ontologyState.enabled)) {
    console.warn(
      `[relevancePredictionService] Ontology enrichment flag mismatch for ${modelKey}: ` +
      `model=${Boolean(modelOntology)}, current=${Boolean(ontologyState.enabled)} ` +
      `(ONTOLOGY_LLM_ENRICHMENT_MODE=${ontologyState.mode}). Predictions may drift.`
    );
  }
  return { current: FEATURE_SET_VERSION, model: modelVersion, match, legacy };
}

async function loadOptimizedPlanSnapshots() {
  const limit = Math.max(0, Math.floor(Number(process.env.ML_PLAN_SNAPSHOT_TRAINING_LIMIT ?? 20)));
  if (limit === 0) return [];
  const listed = await listSnapshots(limit);
  const entries = [];
  for (const item of listed) {
    const loaded = await loadSnapshot(item.token);
    if (loaded?.plan) {
      entries.push({
        plan: loaded.plan,
        optimization: loaded.optimization || null,
        saved_at: loaded.saved_at || item.saved_at || null
      });
    }
  }
  return entries;
}

async function getTrainingPayload(modelKey) {
  const snapshot = await readPrecedentSnapshot();
  const includeGaOptimized = String(process.env.ML_INCLUDE_GA_OPTIMIZED_TARGETS || '').toLowerCase() === 'true';
  const optimizedPlans = includeGaOptimized ? await loadOptimizedPlanSnapshots() : [];
  const datasets = buildMlTrainingDatasets(snapshot, optimizedPlans, { includeGaOptimized });
  const ontologyState = getOntologyFeatureMode();

  if (modelKey === 'post') {
    const sanitized = sanitizeFeatureMatrix(datasets.postDataset.features, 'train/post');
    return {
      features: sanitized.matrix,
      targets: datasets.postDataset.targets,
      feature_names: datasets.postDataset.featureNames,
      feature_set_version: FEATURE_SET_VERSION,
      ontology_features_enabled: Boolean(ontologyState.enabled)
    };
  }
  const sanitized = sanitizeFeatureMatrix(datasets.contentPlanDataset.features, 'train/content_plan');
  return {
    features: sanitized.matrix,
    targets: datasets.contentPlanDataset.targets,
    feature_names: datasets.contentPlanDataset.featureNames,
    feature_set_version: FEATURE_SET_VERSION,
    ontology_features_enabled: Boolean(ontologyState.enabled)
  };
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
 * Вычисление комплексного engagement rate из предсказанных метрик.
 * Учитывает взвешенную сумму реакций: likes (вес 1) + comments (вес 2) + shares (вес 3).
 * При views > 0: interactions / views, кап на 1.
 * При отсутствии просмотров: сатурационный прокси interactions / (interactions + 50).
 */
function calculateComplexEngagementRate(metrics = {}) {
  const likes = clampPositive(metrics.likes);
  const comments = clampPositive(metrics.comments);
  const shares = clampPositive(metrics.shares);
  const views = clampPositive(metrics.views);
  const interactions = likes + (comments * 2) + (shares * 3);

  if (views > 0) {
    return clamp01(interactions / views);
  }
  if (interactions > 0) {
    return clamp01(interactions / (interactions + 50));
  }
  return 0;
}

function calculateEngagementRateFromMetrics(metrics) {
  return calculateComplexEngagementRate(metrics);
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

async function ensureModelTrained(modelKey, options = {}) {
  const { forceTrain = false } = options;
  const spec = getModelSpec(modelKey);
  if (!forceTrain && fs.existsSync(spec.modelPath)) return;
  if (!fs.existsSync(MODEL_DIR)) {
    fs.mkdirSync(MODEL_DIR, { recursive: true });
  }
  await trainMetricsModel(modelKey);
}

const retrainDebounce = {
  post: 0,
  content_plan: 0
};

function triggerBackgroundRetrainIfFallback(modelKey, reason) {
  const now = Date.now();
  // Don't spam retrain more often than once every 5 minutes
  if (now - retrainDebounce[modelKey] < 300000) return;
  retrainDebounce[modelKey] = now;

  console.warn(
    `[relevancePredictionService] Model ${modelKey} is operating in fallback mode (${reason || 'load error'}). ` +
    `Initiating background retraining with local environment backend...`
  );

  trainMetricsModel(modelKey)
    .then(() => {
      console.log(`[relevancePredictionService] Successfully retrained ${modelKey} model with local backend.`);
    })
    .catch((err) => {
      console.warn(`[relevancePredictionService] Background retrain failed for ${modelKey}: ${err.message}`);
    });
}

function buildHeuristicFallbackResult(modelKey, featureVectors) {
  const metadata = getModelMetadata(modelKey);
  const isPlan = modelKey === 'content_plan';
  const targetSummary = metadata?.target_summary || {};

  const meanLikes = Number(
    isPlan ? targetSummary?.total_likes?.mean : targetSummary?.likes?.mean
  ) || (isPlan ? 350 : 50);

  const meanShares = Number(
    isPlan ? targetSummary?.total_shares?.mean : targetSummary?.shares?.mean
  ) || (isPlan ? 50 : 5);

  const meanViews = Number(
    isPlan ? targetSummary?.total_views?.mean : targetSummary?.views?.mean
  ) || (isPlan ? 30000 : 1200);

  const predictions = featureVectors.map((vec) => {
    const sum = Array.isArray(vec) ? vec.reduce((acc, v) => acc + (Number(v) || 0), 0) : 0;
    const factor = Math.max(0.75, Math.min(1.35, 1.0 + (sum % 10) * 0.03));
    return [
      Math.round(meanLikes * factor),
      Math.round(meanShares * factor),
      Math.round(meanViews * factor)
    ];
  });

  return {
    predictions,
    model_metadata: metadata,
    fallback: true,
    fallback_reason: 'node_heuristic_fallback'
  };
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
  checkModelFeatureSetVersion('post');
  const batches = chunkArray(sanitized.matrix, 128);
  const allPredictions = [];
  let metadata = null;

  for (const batch of batches) {
    let result = null;
    try {
      result = await runPythonModel('predict', 'post', { features: batch });
    } catch (err) {
      console.warn(
        `[relevancePredictionService] predict post failed (${err.message}). Attempting automatic self-healing retrain...`
      );
      try {
        await trainMetricsModel('post');
        result = await runPythonModel('predict', 'post', { features: batch });
      } catch (retryErr) {
        console.error(
          `[relevancePredictionService] self-healing retrain failed for post: ${retryErr.message}. Using heuristic fallback.`
        );
        result = buildHeuristicFallbackResult('post', batch);
      }
    }

    if (!result || !Array.isArray(result.predictions)) {
      result = buildHeuristicFallbackResult('post', batch);
    }

    if (result.fallback) {
      triggerBackgroundRetrainIfFallback('post', result.fallback_reason);
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
  if (process.env.ML_CONTENT_PLAN_PREDICT_STUB === '1') {
    const n = featureVectors.length;
    const stubRow = [100, 10, 1000];
    return {
      predictions: Array.from({ length: n }, () => stubRow.slice()),
      metadata: getModelMetadata('content_plan')
    };
  }
  const sanitized = sanitizeFeatureMatrix(featureVectors, 'predict/content_plan');

  await ensureModelTrained('content_plan', options);
  checkModelFeatureSetVersion('content_plan');
  const batches = chunkArray(sanitized.matrix, 128);
  const allPredictions = [];
  let metadata = null;

  for (const batch of batches) {
    let result = null;
    try {
      result = await runPythonModel('predict', 'content_plan', { features: batch });
    } catch (err) {
      console.warn(
        `[relevancePredictionService] predict content_plan failed (${err.message}). Attempting automatic self-healing retrain...`
      );
      try {
        await trainMetricsModel('content_plan');
        result = await runPythonModel('predict', 'content_plan', { features: batch });
      } catch (retryErr) {
        console.error(
          `[relevancePredictionService] self-healing retrain failed for content_plan: ${retryErr.message}. Using heuristic fallback.`
        );
        result = buildHeuristicFallbackResult('content_plan', batch);
      }
    }

    if (!result || !Array.isArray(result.predictions)) {
      result = buildHeuristicFallbackResult('content_plan', batch);
    }

    if (result.fallback) {
      triggerBackgroundRetrainIfFallback('content_plan', result.fallback_reason);
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
  const payload = await getTrainingPayload(modelKey);
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
  const predictedComplexEr = calculateComplexEngagementRate({ likes, shares, views });

  return {
    predictedLikes: likes,
    predictedShares: shares,
    predictedViews: views,
    predictedComplexEr,
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
    const existingOntology = (typeof publication.ontology_features === 'object' && publication.ontology_features !== null && !Array.isArray(publication.ontology_features))
      ? publication.ontology_features
      : null;
    next.ontology_features = existingOntology ? { ...existingOntology } : { creativity: 0.5, has_cta: 0 };
    next.feature_vector = result.featureVectors[index];
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
  calculateComplexEngagementRate,
  // Устаревшие, но оставленные для совместимости
  predictPostLikesByFeatureVectors,
  predictPostLikesForPublications,
  predictContentPlanLikes,
  trainPostLikesModel,
  trainContentPlanLikesModel,
  // Versioning helpers
  checkModelFeatureSetVersion,
  loadOptimizedPlanSnapshots
};