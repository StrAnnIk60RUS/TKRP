/**
 * Оценка надёжности прецедентов RAG.
 * Улучшает качество retrieval и защищаемость результатов.
 *
 * Надёжность = взвешенная сумма:
 * - retrieval_score (релевантность): 0.5
 * - completeness (полнота данных): 0.35
 * - source_trust (доверие к источнику): 0.15
 */

function readPositiveIntEnv(name, fallback) {
  const numeric = Number(process.env[name]);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function readWeightEnv(name, fallback) {
  const numeric = Number(process.env[name]);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? numeric : fallback;
}

const WEIGHT_RETRIEVAL = readWeightEnv('RELIABILITY_WEIGHT_RETRIEVAL', 0.5);
const WEIGHT_COMPLETENESS = readWeightEnv('RELIABILITY_WEIGHT_COMPLETENESS', 0.35);
const WEIGHT_SOURCE_TRUST = readWeightEnv('RELIABILITY_WEIGHT_SOURCE_TRUST', 0.15);
const RELIABILITY_LOG_EVERY = readPositiveIntEnv('RELIABILITY_LOG_EVERY', 200);
const RELIABILITY_TARGET_MEAN = readWeightEnv('RELIABILITY_TARGET_MEAN', 0.6);

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Оценка полноты данных публикации.
 * Ключевые поля для RAG: topic, format, audience, метрики, контент, SPCJ.
 */
function publicationCompleteness(pub) {
  const model = pub?.publication_model || {};
  const hasTopic = Boolean(model.topic && String(model.topic).trim());
  const hasFormat = Boolean(model.format || model.type);
  const hasAudience =
    Array.isArray(model.audience_segments) && model.audience_segments.length > 0;
  const hasMetrics =
    Number.isFinite(Number(pub?.engagement_rate)) ||
    (pub?.raw_metrics && (pub.raw_metrics.views > 0 || pub.raw_metrics.likes != null));
  const hasContent =
    (typeof pub?.raw_content === 'string' && pub.raw_content.trim().length > 50) ||
    (typeof model.summary === 'string' && model.summary.trim().length > 20);
  const hasSpcj =
    model?.spcj?.dimensions &&
    typeof model.spcj.dimensions === 'object' &&
    Object.keys(model.spcj.dimensions).length > 0;

  const checks = [hasTopic, hasFormat, hasAudience, hasMetrics, hasContent, hasSpcj];
  const passed = checks.filter(Boolean).length;
  return clamp01(passed / 6);
}

/**
 * Оценка доверия к источнику публикации.
 */
function publicationSourceTrust(pub) {
  const hasSourceUrl = Boolean(pub?.source_url && String(pub.source_url).trim());
  const hasParsedAt = Boolean(pub?.parsed_at);
  const hasCompetitor = Boolean(pub?.competitor_name && String(pub.competitor_name).trim());

  const checks = [hasSourceUrl, hasParsedAt, hasCompetitor];
  const passed = checks.filter(Boolean).length;
  return clamp01(passed / 3);
}

/**
 * Оценка полноты данных контент-плана.
 */
function contentPlanCompleteness(plan) {
  const model = plan?.content_plan_model || {};
  const hasAudience =
    Array.isArray(model.audience_segments) && model.audience_segments.length > 0;
  const hasSchedule =
    Array.isArray(model.publication_schedule) && model.publication_schedule.length > 0;
  const hasKpi =
    Number.isFinite(Number(model?.kpi_estimate?.avg_engagement_rate)) ||
    Number.isFinite(Number(model?.kpi_estimate?.best_engagement_rate));

  const checks = [hasAudience, hasSchedule, hasKpi];
  const passed = checks.filter(Boolean).length;
  return clamp01(passed / 3);
}

/**
 * Оценка доверия к источнику контент-плана.
 */
function contentPlanSourceTrust(plan) {
  const hasCompetitor = Boolean(plan?.competitor_name && String(plan.competitor_name).trim());
  const hasPlatform = Boolean(plan?.platform && String(plan.platform).trim());

  const checks = [hasCompetitor, hasPlatform];
  const passed = checks.filter(Boolean).length;
  return clamp01(passed / 2);
}

/**
 * Вычисляет надёжность публикации-прецедента.
 * @param {Object} item - элемент результата поиска { type, score, data }
 * @returns {{ reliability: number, factors: Object }}
 */
export function computePublicationReliability(item) {
  const retrievalScore = clamp01(Number(item?.score) ?? 0);
  const data = item?.data || {};
  const completeness = publicationCompleteness(data);
  const sourceTrust = publicationSourceTrust(data);

  const reliability = clamp01(
    WEIGHT_RETRIEVAL * retrievalScore +
    WEIGHT_COMPLETENESS * completeness +
    WEIGHT_SOURCE_TRUST * sourceTrust
  );

  recordReliabilitySample('publication', reliability, {
    retrieval_score: retrievalScore,
    completeness,
    source_trust: sourceTrust
  });

  return {
    reliability,
    factors: {
      retrieval_score: retrievalScore,
      completeness,
      source_trust: sourceTrust
    }
  };
}

/**
 * Вычисляет надёжность контент-плана-прецедента.
 */
export function computeContentPlanReliability(item) {
  const retrievalScore = clamp01(Number(item?.score) ?? 0);
  const data = item?.data || {};
  const completeness = contentPlanCompleteness(data);
  const sourceTrust = contentPlanSourceTrust(data);

  const reliability = clamp01(
    WEIGHT_RETRIEVAL * retrievalScore +
    WEIGHT_COMPLETENESS * completeness +
    WEIGHT_SOURCE_TRUST * sourceTrust
  );

  recordReliabilitySample('content_plan', reliability, {
    retrieval_score: retrievalScore,
    completeness,
    source_trust: sourceTrust
  });

  return {
    reliability,
    factors: {
      retrieval_score: retrievalScore,
      completeness,
      source_trust: sourceTrust
    }
  };
}

/**
 * Добавляет оценку надёжности ко всем элементам результата поиска.
 * @param {Object} searchResult - результат searchPrecedents
 * @returns {Object} - searchResult с полями reliability и reliability_factors в каждом элементе
 */
export function enrichSearchResultsWithReliability(searchResult) {
  if (!searchResult) return searchResult;

  const publications = (searchResult.publications || []).map((item) => {
    const { reliability, factors } = computePublicationReliability(item);
    return {
      ...item,
      reliability: Number(reliability.toFixed(4)),
      reliability_factors: factors
    };
  });

  const contentPlans = (searchResult.content_plans || []).map((item) => {
    const { reliability, factors } = computeContentPlanReliability(item);
    return {
      ...item,
      reliability: Number(reliability.toFixed(4)),
      reliability_factors: factors
    };
  });

  return {
    ...searchResult,
    publications,
    content_plans: contentPlans
  };
}

/**
 * Distribution tracking: histogram of reliability scores (10 buckets) plus
 * per-factor histograms, logged every RELIABILITY_LOG_EVERY samples (0 = off).
 * Used by scripts/calibrate-reliability.js to propose better weights.
 */
const BUCKET_COUNT = 10;

function makeBuckets() {
  return new Array(BUCKET_COUNT).fill(0);
}

function bucketIndex(value) {
  return Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(clamp01(value) * BUCKET_COUNT)));
}

const distribution = {
  publications: makeBuckets(),
  content_plans: makeBuckets(),
  factors: {
    retrieval_score: makeBuckets(),
    completeness: makeBuckets(),
    source_trust: makeBuckets()
  },
  sums: {
    publications: 0,
    content_plans: 0,
    retrieval_score: 0,
    completeness: 0,
    source_trust: 0
  },
  squares: {
    publications: 0,
    content_plans: 0,
    retrieval_score: 0,
    completeness: 0,
    source_trust: 0
  },
  count_publications: 0,
  count_content_plans: 0,
  recorded_count: 0
};

function logDistribution() {
  const total = distribution.count_publications + distribution.count_content_plans;
  console.log(
    `[precedentReliability] distribution (${total} samples): pub=[${distribution.publications.join(',')}] plan=[${distribution.content_plans.join(',')}] mean=${(
      total > 0 ? (distribution.sums.publications + distribution.sums.content_plans) / total : 0
    ).toFixed(3)}`
  );
}

function recordReliabilitySample(kind, reliability, factors) {
  const sumsKey = kind === 'publication' ? 'publications' : 'content_plans';
  const buckets = kind === 'publication' ? distribution.publications : distribution.content_plans;
  buckets[bucketIndex(reliability)] += 1;
  distribution.sums[sumsKey] += reliability;
  distribution.squares[sumsKey] += reliability * reliability;
  if (kind === 'publication') distribution.count_publications += 1;
  else distribution.count_content_plans += 1;
  for (const factorName of Object.keys(distribution.factors)) {
    const value = factors[factorName];
    distribution.factors[factorName][bucketIndex(value)] += 1;
    distribution.sums[factorName] += value;
    distribution.squares[factorName] += value * value;
  }
  distribution.recorded_count += 1;
  if (RELIABILITY_LOG_EVERY > 0 && distribution.recorded_count % RELIABILITY_LOG_EVERY === 0) {
    logDistribution();
  }
}

function meanStd(count, sum, squares) {
  if (count <= 0) return { mean: 0, std: 0 };
  const mean = sum / count;
  const variance = Math.max(0, squares / count - mean * mean);
  return { mean, std: Math.sqrt(variance) };
}

export function getReliabilityDistribution() {
  const totalCount = distribution.count_publications + distribution.count_content_plans;
  const stats = {
    publications: meanStd(distribution.count_publications, distribution.sums.publications, distribution.squares.publications),
    content_plans: meanStd(distribution.count_content_plans, distribution.sums.content_plans, distribution.squares.content_plans)
  };
  for (const name of ['retrieval_score', 'completeness', 'source_trust']) {
    stats[name] = meanStd(totalCount, distribution.sums[name], distribution.squares[name]);
  }
  return {
    buckets: {
      publications: distribution.publications.slice(),
      content_plans: distribution.content_plans.slice(),
      factors: {
        retrieval_score: distribution.factors.retrieval_score.slice(),
        completeness: distribution.factors.completeness.slice(),
        source_trust: distribution.factors.source_trust.slice()
      }
    },
    stats,
    count_publications: distribution.count_publications,
    count_content_plans: distribution.count_content_plans
  };
}

/**
 * Calibrates reliability weights from observed factor distributions:
 * weights are spread proportionally to factor std (high-variance factors
 * discriminate best), then blended with uniform weights via binary search so
 * the projected mean reliability hits targetMean.
 * @param {Object} distribution - getReliabilityDistribution()
 * @param {number} targetMean - desired mean reliability (0..1)
 * @returns {{ weights: { retrieval, completeness, source_trust }, projected_mean: number }}
 */
export function calibrateWeights(distributionInput = getReliabilityDistribution(), targetMean = RELIABILITY_TARGET_MEAN) {
  const factorNames = ['retrieval_score', 'completeness', 'source_trust'];
  const stds = factorNames.map((name) => {
    const std = distributionInput?.stats?.[name]?.std ?? 0;
    return std > 0 ? std : 0;
  });
  const stdSum = stds.reduce((a, b) => a + b, 0);
  const spread = stdSum > 0 ? stds.map((s) => s / stdSum) : factorNames.map(() => 1 / factorNames.length);
  const uniform = factorNames.map(() => 1 / factorNames.length);

  const means = factorNames.map((name) => distributionInput?.stats?.[name]?.mean ?? 0);
  const projected = (weights) => weights.reduce((acc, w, i) => acc + w * means[i], 0);

  let lo = 0;
  let hi = 1;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (lo + hi) / 2;
    const blended = spread.map((w, i) => w * mid + uniform[i] * (1 - mid));
    if (projected(blended) < targetMean) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const weights = spread.map((w, i) => w * t + uniform[i] * (1 - t));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const normalized = weights.map((w) => Number((w / weightSum).toFixed(4)));

  return {
    weights: {
      retrieval: normalized[0],
      completeness: normalized[1],
      source_trust: normalized[2]
    },
    projected_mean: Number(projected(normalized).toFixed(4))
  };
}
