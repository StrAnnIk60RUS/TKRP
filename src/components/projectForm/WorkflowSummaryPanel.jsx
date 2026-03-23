import React from 'react'

const WorkflowSummaryPanel = ({
  filledRequired,
  requiredCount,
  progress,
  competitorsCount,
  precedentsSummary,
  reviewChecklist,
  isEnrichmentServerAvailable,
  hasDraftPlan,
  hasOptimizedPlan
}) => {
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
          <span className="workflow-overview-label">Обязательные поля</span>
          <strong className="workflow-overview-value">
            {filledRequired} / {requiredCount}
          </strong>
          <span className="workflow-overview-meta">{Math.round(progress)}% готовности формы</span>
        </div>

        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Конкуренты</span>
          <strong className="workflow-overview-value">{competitorsCount}</strong>
          <span className="workflow-overview-meta">доступно в текущей сессии</span>
        </div>

        <div className="workflow-overview-card">
          <span className="workflow-overview-label">База прецедентов</span>
          <strong className="workflow-overview-value">
            {precedentsSummary?.publications_count || 0}
          </strong>
          <span className="workflow-overview-meta">
            публикаций и {precedentsSummary?.content_plans_count || 0} планов
          </span>
        </div>

        <div className="workflow-overview-card">
          <span className="workflow-overview-label">Статус результата</span>
          <strong className="workflow-overview-value">
            {hasOptimizedPlan ? 'Оптимизирован' : hasDraftPlan ? 'Черновик готов' : 'Ожидает запуска'}
          </strong>
          <span className="workflow-overview-meta">
            {hasOptimizedPlan
              ? 'Можно перейти к просмотру плана'
              : hasDraftPlan
              ? 'Можно запустить оптимизацию'
              : 'Сначала выполните поиск и генерацию'}
          </span>
        </div>
      </div>

      <div className="workflow-checklist">
        {reviewChecklist.map((item) => (
          <div
            key={item.id}
            className={`workflow-checklist-item ${item.done ? 'is-complete' : 'is-pending'}`}
          >
            <span className="workflow-checklist-mark">{item.done ? '✓' : '•'}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default WorkflowSummaryPanel
