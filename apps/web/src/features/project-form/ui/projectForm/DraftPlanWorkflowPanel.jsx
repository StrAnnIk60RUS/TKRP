import React from 'react'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`
const formatNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—'
}
const getPublicationDayModeLabel = (mode) => (mode === 'shared' ? 'Общие дни по всем платформам' : 'Разные дни')

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
  smmBlockedReasons = [],
  publicationDayMode = 'spread',
  isDeveloper = false
}) => {
  const draftPlan = draftPlanResult?.draft?.draft_content_plan || null
  const optimizedPlan = optimizationResult?.optimized_content_plan || null
  const planFeatures = optimizedPlan?.plan_features || optimizationResult?.stage1?.plan_features || null
  const bestPublication = optimizationResult?.best_publication || null
  const bestPublicationFeatures = bestPublication?.ontology_features || null
  const objectiveBreakdown = optimizationResult?.stage1?.ga?.best_meta?.objective_breakdown || null
  const bestPostMeta = bestPublicationId => optimizationResult?.stage2?.publications?.find((item) => item.publication_id === bestPublicationId)?.ga?.best_meta || null
  const draftDayMode = draftPlan?.schedule_preferences?.publication_day_mode || publicationDayMode
  const optimizedDayMode = optimizedPlan?.schedule_preferences?.publication_day_mode || draftDayMode
  const gaChanges = draftPlan && optimizedPlan
    ? [
        ['min_publications', draftPlan.constraints?.min_publications, optimizedPlan.constraints?.min_publications]
      ].filter(([, beforeValue, afterValue]) => beforeValue !== afterValue)
    : []

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Шаг 2. Генерация и оптимизация плана</h2>
          <p className="workflow-section-subtitle">
            {isDeveloper
              ? 'Сначала создайте черновик, затем при необходимости улучшите его через генетическую оптимизацию.'
              : 'Сначала создайте черновик плана, затем при необходимости запустите улучшение результата.'}
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
          disabled={
            !draftPlan ||
            isOptimizingPlan ||
            isProcessing ||
            isEnrichmentServerAvailable === false
          }
          title={
            isDeveloper
              ? 'Запустить 2-уровневую оптимизацию (ГА)'
              : 'Улучшить план на основе ограничений и целей'
          }
        >
          <span>
            {isOptimizingPlan
              ? isDeveloper
                ? 'ОПТИМИЗАЦИЯ...'
                : 'УЛУЧШЕНИЕ...'
              : isDeveloper
              ? 'ОПТИМИЗИРОВАТЬ (ГА)'
              : 'УЛУЧШИТЬ ПЛАН'}
          </span>
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
      {!canGenerateDraft && smmBlockedReasons.length > 0 && (
        <div className="precedent-empty-state precedent-empty-state-light" role="status" aria-live="polite">
          <strong>Почему кнопка неактивна:</strong> {smmBlockedReasons.join(' · ')}
        </div>
      )}

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
              <span className="ui-badge ui-badge-neutral">{isDeveloper ? 'RAG → LLM' : 'AI-черновик'}</span>
            </div>
            <div className="workflow-result-list">
              <div>План: {draftPlan.plan_id || '—'}</div>
              <div>
                Период: {draftPlan.planning_horizon?.start_date || '—'} -{' '}
                {draftPlan.planning_horizon?.end_date || '—'}
              </div>
              <div>Публикаций: {draftPlan.publications?.length || 0}</div>
              <div>Режим дат: {getPublicationDayModeLabel(draftDayMode)}</div>
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
                После запуска оптимизации здесь появится лучший контент-план, прогноз лайков и результат эволюции постов.
              </div>
            )}

            {!!optimizedPlan && (
              <div className="workflow-result-list">
                <div>Публикаций после оптимизации: {optimizedPlan.publications?.length || 0}</div>
                <div>Режим дат: {getPublicationDayModeLabel(optimizedDayMode)}</div>
                <div>Прогноз лайков плана: {formatNumber(optimizedPlan.expected_kpi?.predicted_total_likes)}</div>
                {planFeatures && <div>Уникальных тем: {planFeatures.unique_topics ?? '—'}</div>}
                {planFeatures && <div>Уникальных тонов: {planFeatures.unique_tones ?? '—'}</div>}
                {planFeatures && <div>Средняя креативность: {formatNumber(planFeatures.avg_creativity)}</div>}
                {planFeatures && <div>Доля CTA: {formatNumber(planFeatures.cta_share)}</div>}
                {isDeveloper && <div>Целевое число постов: {optimizationResult?.stage1?.target_posts_count ?? '—'}</div>}
                {isDeveloper && <div>Этап 1 stop reason: {optimizationResult?.stage1?.ga?.stop_reason ?? '—'}</div>}
                {isDeveloper && <div>Этап 1 поколений: {optimizationResult?.stage1?.ga?.generations ?? '—'}</div>}
                {isDeveloper && <div>Лучший пост: {optimizationResult?.best_publication?.publication_id ?? '—'}</div>}
                {bestPublication && <div>Лайки лучшего поста: {formatNumber(bestPublication?.expected_kpi?.predicted_likes)}</div>}
                {bestPublicationFeatures && <div>Креативность поста: {formatNumber(bestPublicationFeatures.creativity)}</div>}
                {bestPublicationFeatures && <div>CTA у лучшего поста: {bestPublicationFeatures.has_cta ? 'да' : 'нет'}</div>}
                {bestPublicationFeatures && <div>Тонов в посте: {bestPublicationFeatures.tones_count ?? '—'}</div>}
                {objectiveBreakdown && <div>Audience alignment: {formatNumber(objectiveBreakdown.audience_alignment)}</div>}
                {objectiveBreakdown && <div>Ontology consistency: {formatNumber(objectiveBreakdown.ontology_consistency)}</div>}
                {objectiveBreakdown && <div>Format mix fit: {formatNumber(objectiveBreakdown.format_mix_fit)}</div>}
                {bestPublication && bestPostMeta(bestPublication.publication_id) && (
                  <div>CTA strategy: {bestPostMeta(bestPublication.publication_id)?.cta_preference || '—'}</div>
                )}
                {optimizationResult?.stage2?.cta_distribution && (
                  <div>
                    CTA распределено: {optimizationResult.stage2.cta_distribution.assigned_count}/
                    {optimizationResult.stage2.cta_distribution.target_count}
                  </div>
                )}
                <div>
                  Ограничения:{' '}
                  {optimizationResult?.stage2?.constraints_check?.valid === true
                    ? 'соблюдены'
                    : optimizationResult?.stage2?.constraints_check?.valid === false
                      ? 'есть замечания'
                      : 'не проверялись'}
                </div>
                {optimizationResult?.stage2?.constraints_check?.valid === false &&
                  Array.isArray(optimizationResult?.stage2?.constraints_check?.messages) &&
                  optimizationResult.stage2.constraints_check.messages.length > 0 && (
                    <div className="draft-plan-constraint-detail">
                      {optimizationResult.stage2.constraints_check.messages.map((msg, idx) => (
                        <div key={idx}>{msg}</div>
                      ))}
                    </div>
                  )}
                {isDeveloper && <div>Изменено ограничений GA: {gaChanges.length}</div>}
                {isDeveloper &&
                  gaChanges.map(([key, beforeValue, afterValue]) => (
                    <div key={key}>
                      {key}: {String(beforeValue ?? '—')} → {String(afterValue ?? '—')}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default DraftPlanWorkflowPanel
