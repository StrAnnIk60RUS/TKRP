/**
 * Оценка надёжности прецедентов RAG.
 * Улучшает качество retrieval и защищаемость результатов.
 *
 * Надёжность = взвешенная сумма:
 * - retrieval_score (релевантность): 0.5
 * - completeness (полнота данных): 0.35
 * - source_trust (доверие к источнику): 0.15
 */

const WEIGHT_RETRIEVAL = 0.5;
const WEIGHT_COMPLETENESS = 0.35;
const WEIGHT_SOURCE_TRUST = 0.15;

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

  const reliability =
    WEIGHT_RETRIEVAL * retrievalScore +
    WEIGHT_COMPLETENESS * completeness +
    WEIGHT_SOURCE_TRUST * sourceTrust;

  return {
    reliability: clamp01(reliability),
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

  const reliability =
    WEIGHT_RETRIEVAL * retrievalScore +
    WEIGHT_COMPLETENESS * completeness +
    WEIGHT_SOURCE_TRUST * sourceTrust;

  return {
    reliability: clamp01(reliability),
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
