import React from 'react'

const prettyJson = (value) => JSON.stringify(value, null, 2)

const TechnicalDetailsPanel = ({
  precedentSearchQuery,
  precedentSearchResults,
  draftPlanResult,
  optimizationResult
}) => {
  const hasTechnicalData = Boolean(
    precedentSearchQuery ||
      precedentSearchResults ||
      draftPlanResult?.draft?.draft_content_plan ||
      optimizationResult?.optimized_content_plan
  )

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Технические детали</h2>
          <p className="workflow-section-subtitle">
            Этот блок нужен для отладки и проверки структуры данных. Основной сценарий работы проходит без
            чтения JSON.
          </p>
        </div>
      </div>

      {!hasTechnicalData && (
        <div className="precedent-empty-state precedent-empty-state-light">
          Технические данные появятся после поиска прецедентов и генерации плана.
        </div>
      )}

      {hasTechnicalData && (
        <div className="workflow-technical-stack">
          {precedentSearchQuery && (
            <details className="workflow-technical-block">
              <summary>Поисковый запрос</summary>
              <div className="precedent-query-box">{precedentSearchQuery}</div>
            </details>
          )}

          {!!precedentSearchResults && (
            <details className="workflow-technical-block">
              <summary>Результаты поиска прецедентов (JSON)</summary>
              <div className="analysis-view">
                <pre>{prettyJson(precedentSearchResults)}</pre>
              </div>
            </details>
          )}

          {!!draftPlanResult?.draft?.draft_content_plan && (
            <details className="workflow-technical-block">
              <summary>Черновой план (JSON)</summary>
              <div className="analysis-view">
                <pre>{prettyJson(draftPlanResult.draft.draft_content_plan)}</pre>
              </div>
            </details>
          )}

          {!!optimizationResult?.optimized_content_plan && (
            <details className="workflow-technical-block">
              <summary>Оптимизированный план (JSON)</summary>
              <div className="analysis-view">
                <pre>{prettyJson(optimizationResult.optimized_content_plan)}</pre>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

export default TechnicalDetailsPanel
