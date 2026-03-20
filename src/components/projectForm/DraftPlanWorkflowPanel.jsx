import React from 'react'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const DraftPlanWorkflowPanel = ({
  draftPlanResult,
  optimizationResult,
  onGenerateDraftPlan,
  onOptimizeDraftPlan,
  onOpenPlan,
  isGeneratingDraftPlan,
  isOptimizingPlan,
  isProcessing,
  isEnrichmentServerAvailable,
  canGenerateDraft = true,
  smmBlockedReasons = []
}) => {
  const draftPlan = draftPlanResult?.draft?.draft_content_plan || null
  const optimizedPlan = optimizationResult?.optimized_content_plan || null

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Шаг 2. Генерация и оптимизация плана</h2>
          <p className="workflow-section-subtitle">
            Сначала создайте черновик, затем при необходимости улучшите его через генетическую оптимизацию.
          </p>
        </div>
      </div>

      <div className="workflow-action-row workflow-action-row-tight">
        <button
          type="button"
          className="submit-button primary"
          onClick={onGenerateDraftPlan}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isEnrichmentServerAvailable === false ||
            !canGenerateDraft
          }
          title={
            smmBlockedReasons.length > 0
              ? `Сначала выполните: ${smmBlockedReasons.join(', ')}`
              : 'Сформировать черновой план по данным формы и прецедентам'
          }
        >
          <span>{isGeneratingDraftPlan ? 'ГЕНЕРАЦИЯ...' : 'СФОРМИРОВАТЬ ЧЕРНОВОЙ ПЛАН'}</span>
        </button>

        <button
          type="button"
          className="submit-button secondary"
          onClick={onOptimizeDraftPlan}
          disabled={!draftPlan || isOptimizingPlan}
          title="Запустить 2-уровневую оптимизацию (ГА)"
        >
          <span>{isOptimizingPlan ? 'ОПТИМИЗАЦИЯ...' : 'ОПТИМИЗИРОВАТЬ (ГА)'}</span>
        </button>

        <button
          type="button"
          className="submit-button secondary"
          onClick={onOpenPlan}
          disabled={!draftPlan && !optimizedPlan}
        >
          <span>ПЕРЕЙТИ К ГОТОВОМУ ПЛАНУ</span>
        </button>
      </div>

      {!draftPlan && (
        <div className="precedent-empty-state precedent-empty-state-light">
          После нажатия `Сформировать черновой план` здесь появится краткая сводка по структуре плана.
          Технический JSON будет доступен ниже в блоке `Технические детали`.
        </div>
      )}

      {!!draftPlan && (
        <div className="workflow-result-grid">
          <div className="workflow-result-card">
            <div className="workflow-result-header">
              <h3>Черновой план</h3>
              <span className="ui-badge ui-badge-neutral">RAG → LLM</span>
            </div>
            <div className="workflow-result-list">
              <div>План: {draftPlan.plan_id || '—'}</div>
              <div>
                Период: {draftPlan.planning_horizon?.start_date || '—'} -{' '}
                {draftPlan.planning_horizon?.end_date || '—'}
              </div>
              <div>Публикаций: {draftPlan.publications?.length || 0}</div>
              <div>
                Целевой engagement:{' '}
                {draftPlan.kpi_targets?.avg_engagement_rate !== undefined
                  ? formatPercent(draftPlan.kpi_targets.avg_engagement_rate)
                  : '—'}
              </div>
            </div>
            <div className="workflow-next-action">
              <strong>Следующий шаг: откройте план или запустите оптимизацию.</strong>
            </div>
          </div>

          <div className="workflow-result-card">
            <div className="workflow-result-header">
              <h3>Оптимизация</h3>
              <span className={`ui-badge ui-badge-${optimizedPlan ? 'success' : 'neutral'}`}>
                {optimizedPlan ? 'Готово' : 'Не запускалась'}
              </span>
            </div>

            {!optimizedPlan && (
              <div className="workflow-result-placeholder">
                После запуска оптимизации здесь появится результат по числу публикаций, ограничениям и F_kp.
              </div>
            )}

            {!!optimizedPlan && (
              <div className="workflow-result-list">
                <div>Публикаций после оптимизации: {optimizedPlan.publications?.length || 0}</div>
                <div>F_kp: {optimizationResult?.stage2?.f_kp ?? '—'}</div>
                <div>Stop reason: {optimizationResult?.stage2?.ga?.stop_reason ?? '—'}</div>
                <div>Поколений: {optimizationResult?.stage2?.ga?.generations ?? '—'}</div>
                <div>
                  Ограничения:{' '}
                  {optimizationResult?.stage2?.constraints_check?.valid ? 'соблюдены' : 'есть нарушения'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default DraftPlanWorkflowPanel
