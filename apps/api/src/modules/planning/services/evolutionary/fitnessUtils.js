/**
 * Единая фитнес для both stages of GA (plan-level and post-level).
 * Optimization fitness = KPI + bonuses/penalties (used by GA ranking);
 * display fitness = pure KPI score (used by UI/reporting).
 * Both stages must call these primitives so that scales stay comparable.
 */
function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function clampProbability(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

export const DEFAULT_FITNESS_WEIGHTS = {
  likes: 0.5,
  shares: 0.3,
  views: 0.2
};

/**
 * Cap predicted metrics against historical maxima from model metadata.
 * keyPrefix: 'total_' for plan-level metadata (total_likes.max), '' for post-level (likes.max).
 */
export function capPredictedMetrics(predictedMetrics, metadata = null, keyPrefix = 'total_') {
  const [likes, shares, views] = predictedMetrics;
  const summary = metadata?.target_summary || {};
  const maxLikes = asNumber(summary[`${keyPrefix}likes`]?.max, 0);
  const maxShares = asNumber(summary[`${keyPrefix}shares`]?.max, 0);
  const maxViews = asNumber(summary[`${keyPrefix}views`]?.max, 0);

  return {
    cappedLikes: maxLikes > 0 ? Math.min(asNumber(likes, 0), maxLikes) : asNumber(likes, 0),
    cappedShares: maxShares > 0 ? Math.min(asNumber(shares, 0), maxShares) : asNumber(shares, 0),
    cappedViews: maxViews > 0 ? Math.min(asNumber(views, 0), maxViews) : asNumber(views, 0)
  };
}

/**
 * Shared normalization: log1p scaling keeps ranking sensitivity above historical max
 * (soft cap at 1 near 10x historical max) instead of hard clipping.
 */
export function normalizeAgainstTarget(value, targetMax) {
  const safeValue = Math.max(0, asNumber(value, 0));
  const safeTarget = Math.max(0, asNumber(targetMax, 0));

  if (safeTarget > 0) {
    return Math.min(1, Math.log1p(safeValue) / Math.log1p(safeTarget * 10));
  }
  return Math.tanh(Math.log1p(safeValue) / 8);
}

/** Weighted normalized KPI score (0..1). This is the display fitness component. */
export function kpiScore(predictedMetrics, metadata = null, options = {}) {
  const weights = { ...DEFAULT_FITNESS_WEIGHTS, ...(options.weights || {}) };
  const keyPrefix = options.keyPrefix ?? 'total_';
  const capped = capPredictedMetrics(predictedMetrics, metadata, keyPrefix);
  const summary = metadata?.target_summary || {};

  const normLikes = normalizeAgainstTarget(capped.cappedLikes, asNumber(summary[`${keyPrefix}likes`]?.max, 0));
  const normShares = normalizeAgainstTarget(capped.cappedShares, asNumber(summary[`${keyPrefix}shares`]?.max, 0));
  const normViews = normalizeAgainstTarget(capped.cappedViews, asNumber(summary[`${keyPrefix}views`]?.max, 0));

  return (
    weights.likes * normLikes +
    weights.shares * normShares +
    weights.views * normViews
  );
}

/**
 * Combine KPI with explicit params for ontology, reliability, diversity,
 * draft alignment and structural penalties. Returns both optimization and
 * display fitness so callers never mix scales.
 */
export function combineFitness(options = {}) {
  const kpi = clamp01(asNumber(options.kpi, 0), 0);
  const diversity = clamp01(asNumber(options.diversity, 0), 0);
  const diversityWeight = clampProbability(options.diversityWeight, 0);
  const ontologyBonus = clamp01(asNumber(options.ontologyBonus, 0), 0);
  const ontologyWeight = clampProbability(options.ontologyWeight, 0);
  const reliability = options.reliability === undefined ? null : clamp01(asNumber(options.reliability, 0), 0);
  const reliabilityWeight = clampProbability(options.reliabilityWeight, 0);
  const draftAlignment = options.draftAlignment === undefined ? null : clamp01(asNumber(options.draftAlignment, 0), 0);
  const draftWeight = clampProbability(options.draftWeight, 0);
  const penalty = Math.max(0, asNumber(options.penalty, 0));

  let optimization = kpi;
  if (diversityWeight > 0) {
    optimization = (1 - diversityWeight) * optimization + diversityWeight * diversity;
  }
  if (reliability !== null && reliabilityWeight > 0) {
    optimization = (1 - reliabilityWeight) * optimization + reliabilityWeight * reliability;
  }
  if (draftAlignment !== null && draftWeight > 0) {
    optimization = (1 - draftWeight) * optimization + draftWeight * draftAlignment;
  }
  if (ontologyWeight > 0) {
    optimization = (1 - ontologyWeight) * optimization + ontologyWeight * ontologyBonus;
  }
  optimization = clamp01(optimization - penalty, 0);

  return {
    optimization,
    display: kpi,
    components: {
      kpi,
      diversity,
      diversityWeight,
      ontologyBonus,
      ontologyWeight,
      reliability,
      reliabilityWeight,
      draftAlignment,
      draftWeight,
      penalty
    }
  };
}
