import React from 'react'
import {
  buildReadinessOverview,
  isGenerationBlockedByBackend
} from '../../lib/workflowUiUtils'

const getPublicationDayModeCopy = (mode) =>
  mode === 'shared'
    ? {
        label: 'Общие дни',
        hint: 'На каждую дату планируются публикации по всем выбранным платформам.'
      }
    : {
        label: 'Разные дни',
        hint: 'Публикации распределяются по горизонту без обязательного совпадения дат.'
      }

const WorkflowSummaryPanel = ({
  filledRequired,
  requiredCount,
  competitorsCount,
  precedentsSummary,
  isEnrichmentServerAvailable,
  hasDraftPlan,
  hasOptimizedPlan,
  publicationDayMode = 'spread',
  explainabilitySignals = [],
  riskSummary = []
}) => {
  const publicationDayModeCopy = getPublicationDayModeCopy(publicationDayMode)
  const isBlocked = isGenerationBlockedByBackend(isEnrichmentServerAvailable)
  const statusTone = isBlocked ? 'danger' : 'neutral'

  const statusLabel =
    isBlocked
      ? 'Сервер недоступен'
      : isEnrichmentServerAvailable === true
      ? null
      : 'Проверка backend...'

  const readiness = buildReadinessOverview({
    filledRequired,
    requiredCount,
    competitorsCount,
    precedentsSummary,
    hasDraftPlan,
    hasOptimizedPlan
  })

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Проверка перед генерацией</h2>
          <p className="workflow-section-subtitle">
            Здесь только проверка готовности. Сборка черновика и улучшение плана — отдельные следующие шаги.
          </p>
        </div>
        {statusLabel && <span className={`ui-badge ui-badge-${statusTone}`}>{statusLabel}</span>}
      </div>

      <div className="workflow-overview-grid">
        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Данные</span>
          <strong className="workflow-overview-value">
            {readiness.dataLine}
          </strong>
          <span className="workflow-overview-meta">форма · конкуренты · прецеденты</span>
        </div>

        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Статус</span>
          <strong className="workflow-overview-value">
            {readiness.statusLine}
          </strong>
          <span className="workflow-overview-meta">
            {readiness.statusMeta}
            {' · '}
            {publicationDayModeCopy.label}
          </span>
        </div>
      </div>

      {riskSummary.length > 0 && (
        <div className="workflow-risk-summary">
          <h4 className="workflow-risk-summary-title">Сводка рисков</h4>
          <ul className="workflow-risk-list">
            {riskSummary.map((r) => (
              <li key={r.id} className={`workflow-risk-item severity-${r.severity}`}>
                <span className="workflow-risk-label">{r.label}</span>
                <span className="workflow-risk-detail">{r.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {explainabilitySignals.length > 0 && (
        <div className="workflow-checklist">
          {explainabilitySignals.map((signal) => (
            <div
              key={signal.key || signal.label}
              className={`workflow-checklist-item ${
                signal.required === false ? '' : signal.done ? 'is-complete' : 'is-pending'
              }`}
            >
              <span className="workflow-checklist-mark">
                {signal.required === false ? '•' : signal.done ? '✓' : '○'}
              </span>
              <span>{signal.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default WorkflowSummaryPanel
