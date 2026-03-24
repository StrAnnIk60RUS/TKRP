import React from 'react'

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
  progress,
  competitorsCount,
  precedentsSummary,
  reviewChecklist,
  isEnrichmentServerAvailable,
  hasDraftPlan,
  hasOptimizedPlan,
  publicationDayMode = 'spread',
  explainabilitySignals = [],
  onChecklistToggle,
  riskSummary = []
}) => {
  const publicationDayModeCopy = getPublicationDayModeCopy(publicationDayMode)
  const statusTone =
    isEnrichmentServerAvailable === false
      ? 'danger'
      : 'neutral'

  const statusLabel =
    isEnrichmentServerAvailable === false
      ? 'Backend недоступен'
      : isEnrichmentServerAvailable === true
      ? null
      : 'Проверка backend...'

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Проверка перед генерацией</h2>
          <p className="workflow-section-subtitle">
            Сначала проверьте готовность данных, затем подберите прецеденты, сформируйте черновик и при
            необходимости запустите оптимизацию.
          </p>
        </div>
        {statusLabel && <span className={`ui-badge ui-badge-${statusTone}`}>{statusLabel}</span>}
      </div>

      <div className="workflow-overview-grid">
        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Данные</span>
          <strong className="workflow-overview-value">
            {filledRequired}/{requiredCount} · {competitorsCount} конкр. ·{' '}
            {(precedentsSummary?.publications_count || 0) + (precedentsSummary?.content_plans_count || 0)} прец.
          </strong>
          <span className="workflow-overview-meta">форма · конкуренты · прецеденты</span>
        </div>

        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Статус</span>
          <strong className="workflow-overview-value">
            {hasOptimizedPlan ? 'Оптимизирован' : hasDraftPlan ? 'Черновик' : 'Ожидает'}
          </strong>
          <span className="workflow-overview-meta">
            {hasOptimizedPlan
              ? 'план готов'
              : hasDraftPlan
              ? 'можно оптимизировать'
              : 'поиск → генерация'}
            {' · '}
            {publicationDayModeCopy.label}
          </span>
        </div>

        <div className="workflow-overview-card workflow-overview-card--check">
          <span className="workflow-overview-label">Проверено перед генерацией</span>
          {onChecklistToggle ? (
            <label className="workflow-checklist-checkbox workflow-checklist-checkbox--inline">
              <input
                type="checkbox"
                checked={!!reviewChecklist.find((i) => i.id === 'reviewed')?.done}
                onChange={() => onChecklistToggle('reviewed')}
              />
              <span className="workflow-checklist-mark">
                {reviewChecklist.find((i) => i.id === 'reviewed')?.done ? '✓' : '○'}
              </span>
              <span>
                {reviewChecklist.find((i) => i.id === 'reviewed')?.done
                  ? 'Готово к генерации'
                  : 'Отметить после проверки'}
              </span>
            </label>
          ) : (
            <span>{reviewChecklist.find((i) => i.id === 'reviewed')?.done ? '✓ Отмечено' : '○ Не отмечено'}</span>
          )}
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
          <div className="workflow-checklist-item is-complete">
            <span className="workflow-checklist-mark">✓</span>
            <span>Сигналы, влияющие на черновик:</span>
          </div>
          {explainabilitySignals.map((signal) => (
            <div key={signal} className="workflow-checklist-item">
              <span className="workflow-checklist-mark">•</span>
              <span>{signal}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default WorkflowSummaryPanel
