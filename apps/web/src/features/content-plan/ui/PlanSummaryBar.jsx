import React from 'react'

const formatPercent = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

const formatCount = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return String(Math.max(0, Math.round(n)))
}

const formatPredictedPlanLikes = (value) => {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

const toFiniteNumberOrNull = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Прогноз лайков плана: план (после сохранения) → stage2 API → stage1 черновой прогноз. */
const resolvePredictedTotalLikes = (planExpectedKpi, optimizationMeta) => {
  const fromPlan = toFiniteNumberOrNull(planExpectedKpi?.predicted_total_likes)
  if (fromPlan != null) return fromPlan
  const s2 = toFiniteNumberOrNull(
    optimizationMeta?.stage2?.predicted_total_likes ??
    optimizationMeta?.stage2?.f_kp ??
    optimizationMeta?.predicted_total_likes ??
    optimizationMeta?.f_kp
  )
  if (s2 != null) return s2
  const s1 = toFiniteNumberOrNull(optimizationMeta?.stage1?.predicted_total_likes)
  if (s1 != null) return s1
  return null
}

const resolvePredictedPlanMetric = (metricName, planExpectedKpi, optimizationMeta) => {
  const fromPlan = toFiniteNumberOrNull(planExpectedKpi?.[metricName])
  if (fromPlan != null) return fromPlan
  const stage2 = toFiniteNumberOrNull(optimizationMeta?.stage2?.[metricName] ?? optimizationMeta?.[metricName])
  if (stage2 != null) return stage2
  return toFiniteNumberOrNull(optimizationMeta?.stage1?.[metricName])
}

const PlanSummaryBar = ({ summary, optimizationMeta, planExpectedKpi = null }) => {
  const predictedTotal = resolvePredictedTotalLikes(planExpectedKpi, optimizationMeta)
  const predictedLabel = formatPredictedPlanLikes(predictedTotal)
  const predictedTotalShares = resolvePredictedPlanMetric(
    'predicted_total_shares',
    planExpectedKpi,
    optimizationMeta
  )
  const predictedTotalViews = resolvePredictedPlanMetric(
    'predicted_total_views',
    planExpectedKpi,
    optimizationMeta
  )
  const predictedMetrics = [
    { label: 'Лайки', value: predictedLabel },
    ...(predictedTotalShares != null
      ? [{ label: 'Репосты', value: formatPredictedPlanLikes(predictedTotalShares) }]
      : []),
    ...(predictedTotalViews != null
      ? [{ label: 'Просмотры', value: formatPredictedPlanLikes(predictedTotalViews) }]
      : [])
  ]
  const filteredCountLabel = formatCount(summary?.filteredCount)
  const totalCountLabel = formatCount(summary?.totalCount)
  const avgEngagementLabel = formatPercent(summary?.avgEngagementRate)
  const avgConversionLabel = formatPercent(summary?.avgConversionPotential)
  const avgReachLabel = formatPercent(summary?.avgReachPotential)
  const filteredMlCountLabel = formatCount(summary?.postsWithMlMetricsCount)
  const platformsLabel =
    typeof summary?.platformsLabel === 'string' && summary.platformsLabel.trim()
      ? summary.platformsLabel
      : 'не указаны'
  const dateRangeLabel =
    typeof summary?.dateRangeLabel === 'string' && summary.dateRangeLabel.trim()
      ? summary.dateRangeLabel
      : '—'
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
        <strong className="plan-summary-metric-value">{filteredCountLabel}</strong>
        <span className="plan-summary-metric-meta">
          из {totalCountLabel} в текущем плане
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Сводка KPI по фильтру</span>
        <strong className="plan-summary-metric-value">{avgEngagementLabel}</strong>
        <ul className="plan-summary-metric-meta-list">
          <li>
            <span className="plan-summary-metric-meta-key">Средняя конверсия:</span> {avgConversionLabel}
          </li>
          <li>
            <span className="plan-summary-metric-meta-key">Средний охват:</span> {avgReachLabel}
          </li>
          <li>
            <span className="plan-summary-metric-meta-key">Покрытие ML:</span> {filteredMlCountLabel} из{' '}
            {filteredCountLabel} публикаций
          </li>
        </ul>
        <span className="plan-summary-metric-meta">
          {summary?.engagementLikelySaturated
            ? 'Все публикации имеют ~100% engagement: проверьте исходные данные/ML-нормализацию.'
            : 'Все значения рассчитаны по текущим фильтрам.'}
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Платформы</span>
        <strong className="plan-summary-metric-value">{platformsLabel}</strong>
        <span className="plan-summary-metric-meta">
          {dateRangeLabel}
          {summary?.dateRangeMeta ? ` (публикации: ${summary.dateRangeMeta})` : ''}
        </span>
      </div>

      <div className="plan-summary-metric">
        <span className="plan-summary-metric-label">Статус оптимизации</span>
        <strong className="plan-summary-metric-value">
          {optimizationMeta ? 'Оптимизирован' : 'Черновой'}
        </strong>
        {optimizationMeta ? (
          <>
            <span className="plan-summary-metric-meta">Прогноз метрик плана (ML):</span>
            <ul className="plan-summary-metric-meta-list">
              {predictedMetrics.map((metric) => (
                <li key={metric.label}>
                  <span className="plan-summary-metric-meta-key">{metric.label}:</span> {metric.value}
                </li>
              ))}
            </ul>
            <span className="plan-summary-metric-meta">
              Ограничения: <strong>{constraintLabel}</strong>
            </span>
          </>
        ) : (
          <span className="plan-summary-metric-meta">Можно редактировать и оптимизировать</span>
        )}
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
