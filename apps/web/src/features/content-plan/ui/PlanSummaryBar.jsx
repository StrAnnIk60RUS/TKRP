import React from 'react'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const formatPredictedPlanLikes = (value) => {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

/** Прогноз лайков плана: план (после сохранения) → stage2 API → stage1 черновой прогноз. */
const resolvePredictedTotalLikes = (planExpectedKpi, optimizationMeta) => {
  const fromPlan = planExpectedKpi?.predicted_total_likes
  if (fromPlan != null && fromPlan !== '' && Number.isFinite(Number(fromPlan))) return Number(fromPlan)
  const s2 =
    optimizationMeta?.stage2?.predicted_total_likes ??
    optimizationMeta?.stage2?.f_kp ??
    optimizationMeta?.predicted_total_likes ??
    optimizationMeta?.f_kp
  if (s2 != null && s2 !== '' && Number.isFinite(Number(s2))) return Number(s2)
  const s1 = optimizationMeta?.stage1?.predicted_total_likes
  if (s1 != null && s1 !== '' && Number.isFinite(Number(s1))) return Number(s1)
  return null
}

const PlanSummaryBar = ({ summary, optimizationMeta, planExpectedKpi = null }) => {
  const predictedTotal = resolvePredictedTotalLikes(planExpectedKpi, optimizationMeta)
  const predictedLabel = formatPredictedPlanLikes(predictedTotal)
  const constraintCheck = optimizationMeta?.stage2?.constraints_check
  const constraintLabel =
    constraintCheck?.valid === true
      ? 'Соблюдены'
      : constraintCheck?.valid === false
        ? 'Есть замечания'
        : optimizationMeta
          ? 'Не проверялись'
          : '—'
  const constraintMessages = Array.isArray(constraintCheck?.messages) ? constraintCheck.messages : []

  return (
    <section className="plan-summary-bar">
      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Публикаций</span>
        <strong className="plan-summary-metric-value">{summary.filteredCount}</strong>
        <span className="plan-summary-metric-meta">
          из {summary.totalCount} в текущем плане
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Средний engagement</span>
        <strong className="plan-summary-metric-value">{formatPercent(summary.avgEngagementRate)}</strong>
        <span className="plan-summary-metric-meta">
          {summary.engagementLikelySaturated
            ? 'все публикации имеют ~100%: проверьте исходные данные/ML-нормализацию'
            : 'по отфильтрованным публикациям'}
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Платформы</span>
        <strong className="plan-summary-metric-value">{summary.platformsLabel}</strong>
        <span className="plan-summary-metric-meta">
          {summary.dateRangeLabel}
          {summary.dateRangeMeta ? ` (публикации: ${summary.dateRangeMeta})` : ''}
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Статус оптимизации</span>
        <strong className="plan-summary-metric-value">
          {optimizationMeta ? 'Оптимизирован' : 'Черновой'}
        </strong>
        <span className="plan-summary-metric-meta">
          {optimizationMeta
            ? `Прогноз лайков плана (ML): ${predictedLabel}; ограничения: ${constraintLabel}`
            : 'Можно редактировать и оптимизировать'}
        </span>
        {constraintCheck?.valid === false && constraintMessages.length > 0 && (
          <span className="plan-summary-metric-meta plan-summary-constraint-detail">
            {constraintMessages.join(' ')}
          </span>
        )}
      </div>
    </section>
  )
}

export default PlanSummaryBar
