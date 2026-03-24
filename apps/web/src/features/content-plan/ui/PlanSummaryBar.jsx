import React from 'react'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const PlanSummaryBar = ({ summary, optimizationMeta }) => {
  const fKpValue = optimizationMeta?.stage2?.f_kp ?? optimizationMeta?.f_kp ?? null
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
            ? `F_kp: ${fKpValue ?? 'недоступен'}`
            : 'Можно редактировать и оптимизировать'}
        </span>
      </div>
    </section>
  )
}

export default PlanSummaryBar
