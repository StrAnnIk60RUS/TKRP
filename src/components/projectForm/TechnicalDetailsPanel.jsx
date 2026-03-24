import React from 'react'

const prettyJson = (value) => JSON.stringify(value, null, 2)
const toPairs = (value) => (value && typeof value === 'object' ? Object.entries(value) : [])

const renderPairs = (value) => {
  const pairs = toPairs(value)
  if (pairs.length === 0) {
    return <div className="workflow-result-placeholder">Данные пока отсутствуют.</div>
  }

  return (
    <div className="workflow-result-list">
      {pairs.map(([key, item]) => (
        <div key={key}>
          {key}: {typeof item === 'number' ? item.toFixed(3) : String(item)}
        </div>
      ))}
    </div>
  )
}

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
  const optimizedPlan = optimizationResult?.optimized_content_plan || null
  const bestPublication = optimizationResult?.best_publication || null
  const planFeatures = optimizedPlan?.plan_features || optimizationResult?.stage1?.plan_features || null
  const bestPublicationFeatures = bestPublication?.ontology_features || null

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

          {!!planFeatures && (
            <details className="workflow-technical-block">
              <summary>Признаки лучшего контент-плана</summary>
              {renderPairs(planFeatures)}
            </details>
          )}

          {!!bestPublicationFeatures && (
            <details className="workflow-technical-block">
              <summary>Признаки лучшего поста</summary>
              {renderPairs(bestPublicationFeatures)}
            </details>
          )}

          {!!optimizationResult?.stage1?.ga?.history && (
            <details className="workflow-technical-block">
              <summary>Trace эволюции контент-плана (JSON)</summary>
              <div className="analysis-view">
                <pre>{prettyJson(optimizationResult.stage1.ga.history)}</pre>
              </div>
            </details>
          )}

          {!!optimizationResult?.stage2?.cta_distribution && (
            <details className="workflow-technical-block">
              <summary>Распределение CTA</summary>
              {renderPairs(optimizationResult.stage2.cta_distribution)}
            </details>
          )}

          {!!bestPublication && (
            <details className="workflow-technical-block">
              <summary>Лучший пост (JSON)</summary>
              <div className="analysis-view">
                <pre>{prettyJson(bestPublication)}</pre>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

export default TechnicalDetailsPanel
