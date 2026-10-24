import React from 'react'
import ProcessIndicator from '../../../../shared/ui/ProcessIndicator'
import OptimizationTracePanel from './OptimizationTracePanel'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`
const formatNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—'
}
const formatInteger = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : '—'
}
const toFiniteNumberOrNull = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const normalizeMetricByTotal = (items, rawKey, totalValue) => {
  const targetTotal = Math.max(0, Math.round(Number(totalValue) || 0))
  if (!Array.isArray(items) || items.length === 0) return new Array(0)
  if (targetTotal === 0) return items.map(() => 0)

  const weights = items.map((item) => Math.max(0, Number(item?.[rawKey]) || 0))
  const weightSum = weights.reduce((sum, value) => sum + value, 0)
  if (weightSum <= 0) {
    const base = Math.floor(targetTotal / items.length)
    let remainder = targetTotal - base * items.length
    return items.map(() => {
      if (remainder > 0) {
        remainder -= 1
        return base + 1
      }
      return base
    })
  }

  const exact = weights.map((value) => (value / weightSum) * targetTotal)
  const floored = exact.map((value) => Math.floor(value))
  let remainder = targetTotal - floored.reduce((sum, value) => sum + value, 0)
  const rankedRemainders = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (let idx = 0; idx < rankedRemainders.length && remainder > 0; idx += 1) {
    floored[rankedRemainders[idx].index] += 1
    remainder -= 1
  }
  return floored
}
const getPublicationDayModeLabel = (mode) => (mode === 'shared' ? 'Общие дни по всем платформам' : 'Разные дни')

const DraftPlanWorkflowPanel = ({
  draftPlanResult,
  optimizationResult,
  onGenerateDraftPlan,
  onGenerateWithPrecedents,
  onGenerateAndOptimizePlan,
  onOptimizeDraftPlan,
  onGoToOptimizeStep,
  onOpenPlan,
  isGeneratingDraftPlan,
  isOptimizingPlan,
  isProcessing,
  isEnrichmentServerAvailable,
  canGenerateDraft = true,
  smmBlockedReasons = [],
  canSearchPrecedents = true,
  smmSearchBlockedReasons = [],
  publicationDayMode = 'spread',
  isAnalyst = false,
  isDeveloper = false,
  isEmbedded = false,
  combineSearchAndDraft = false,
  isFlatSmmFlow = false,
  phase = 'draft'
}) => {
  const isAnalystMode = Boolean(isAnalyst || isDeveloper)
  const draftPlan = draftPlanResult?.draft?.draft_content_plan || null
  const optimizedPlan = optimizationResult?.optimized_content_plan || null
  const planFeatures = optimizedPlan?.plan_features || optimizationResult?.stage1?.plan_features || null
  const bestPublication = optimizationResult?.best_publication || null
  const bestPublicationFeatures = bestPublication?.ontology_features || null
  const objectiveBreakdown = optimizationResult?.stage1?.ga?.best_meta?.objective_breakdown || null
  const bestPostMeta = bestPublicationId => optimizationResult?.stage2?.publications?.find((item) => item.publication_id === bestPublicationId)?.ga?.best_meta || null
  const draftDayMode = draftPlan?.schedule_preferences?.publication_day_mode || publicationDayMode
  const optimizedDayMode = optimizedPlan?.schedule_preferences?.publication_day_mode || draftDayMode
  const draftPublicationsCount = draftPlan?.publications?.length || 0
  const optimizedPublicationsCount = optimizedPlan?.publications?.length || 0
  const draftPredictedTotalLikes = Number(draftPlan?.expected_kpi?.predicted_total_likes)
  const optimizedPublications = Array.isArray(optimizedPlan?.publications) ? optimizedPlan.publications : []
  const stage2Publications = Array.isArray(optimizationResult?.stage2?.publications)
    ? optimizationResult.stage2.publications
    : []
  const likesFromOptimizedPlan = optimizedPublications
    .map((publication) =>
      toFiniteNumberOrNull(
        publication?.expected_kpi?.ml_predicted_likes ?? publication?.expected_kpi?.predicted_likes
      )
    )
    .filter((likes) => likes != null)
  const likesFromStage2Raw = stage2Publications
    .map((publication) => toFiniteNumberOrNull(publication?.predicted_likes))
    .filter((likes) => likes != null)
  const apiOptimizedTotalLikes = Number(optimizedPlan?.expected_kpi?.predicted_total_likes)
  const shouldNormalizeStage2Likes =
    likesFromOptimizedPlan.length === 0 &&
    likesFromStage2Raw.length > 0 &&
    Number.isFinite(apiOptimizedTotalLikes) &&
    Math.abs(
      likesFromStage2Raw.reduce((sum, likes) => sum + likes, 0) - apiOptimizedTotalLikes
    ) > Math.max(1, apiOptimizedTotalLikes * 0.05)
  const postLikesList = likesFromOptimizedPlan.length > 0
    ? likesFromOptimizedPlan
    : shouldNormalizeStage2Likes
      ? normalizeMetricByTotal(stage2Publications, 'predicted_likes', apiOptimizedTotalLikes)
      : likesFromStage2Raw
  const summedOptimizedPostLikes = postLikesList.length > 0
    ? postLikesList.reduce((sum, likes) => sum + likes, 0)
    : NaN
  const bestPostPredictedLikesFromPlan = postLikesList.length > 0 ? Math.max(...postLikesList) : NaN
  const bestPostPredictedLikesFallback = Number(bestPublication?.expected_kpi?.predicted_likes)
  const bestPostPredictedLikes = Number.isFinite(bestPostPredictedLikesFromPlan)
    ? bestPostPredictedLikesFromPlan
    : bestPostPredictedLikesFallback
  const optimizedPredictedTotalLikes = Number.isFinite(summedOptimizedPostLikes)
    ? summedOptimizedPostLikes
    : apiOptimizedTotalLikes
  const draftToOptimizedLikesDelta = Number.isFinite(draftPredictedTotalLikes) && Number.isFinite(optimizedPredictedTotalLikes)
    ? optimizedPredictedTotalLikes - draftPredictedTotalLikes
    : null
  const ctaDistribution = optimizationResult?.stage2?.cta_distribution || null
  const ctaAssigned = Number(ctaDistribution?.assigned_count)
  const ctaTarget = Number(ctaDistribution?.target_count)
  const ctaCoverage = Number.isFinite(ctaAssigned) && Number.isFinite(ctaTarget) && ctaTarget > 0
    ? ctaAssigned / ctaTarget
    : null
  const constraintsCheck = optimizationResult?.stage2?.constraints_check || null
  const constraintMessages = Array.isArray(constraintsCheck?.messages) ? constraintsCheck.messages : []
  const constraintIssuesCount = constraintMessages.length
  const canRunCombinedAction = canSearchPrecedents && isEnrichmentServerAvailable !== false
  const combinedBlockedReasons = smmSearchBlockedReasons.length > 0 ? smmSearchBlockedReasons : smmBlockedReasons
  const canTriggerDraft = combineSearchAndDraft ? canRunCombinedAction : canGenerateDraft
  const gaChanges = draftPlan && optimizedPlan
    ? [
        ['min_publications', draftPlan.constraints?.min_publications, optimizedPlan.constraints?.min_publications]
      ].filter(([, beforeValue, afterValue]) => beforeValue !== afterValue)
    : []

  const draftActiveProcessId = isGeneratingDraftPlan
    ? 'generatingPlan'
    : isOptimizingPlan
      ? 'optimizingPlan'
      : null

  return (
    <section className={`precedent-workflow-section ${isEmbedded ? 'precedent-workflow-section-embedded' : 'form-section'}`}>
      <div className="workflow-section-heading">
        <div>
          {isFlatSmmFlow ? null : isEmbedded ? (
            <h3 className="smm-unified-step-title">
              {phase === 'optimize'
                ? 'Улучшение контент-плана (прогноз отклика и эволюционный отбор)'
                : 'Сборка чернового контент-плана'}
            </h3>
          ) : (
            <h2 className="section-title">
              {phase === 'optimize'
                ? 'Улучшение контент-плана (прогноз отклика и эволюционный отбор)'
                : 'Сборка чернового контент-плана'}
            </h2>
          )}
          {!isFlatSmmFlow && (
            <p className="workflow-section-subtitle">
              {phase === 'optimize'
                ? 'Двухэтапная оптимизация: модель машинного обучения прогнозирует ожидаемые просмотры, лайки и репосты, а эволюционный (генетический) алгоритм подбирает оптимальное сочетание тем, форматов, тональности и призывов к действию для максимизации отклика аудитории.'
                : 'Вы можете сначала собрать черновик от ИИ или сразу запустить полный цикл (генерация черновика + двухэтапная оптимизация на основе прогноза вовлечённости и эволюционного алгоритма подбора) одной кнопкой.'}
            </p>
          )}
        </div>
      </div>

      <ProcessIndicator active={Boolean(draftActiveProcessId)} processId={draftActiveProcessId} contextual />

      <div className="workflow-action-row workflow-action-row-tight">
        {phase !== 'optimize' && (
          <>
            {typeof onGenerateAndOptimizePlan === 'function' && (
              <button
                type="button"
                className="submit-button primary"
                onClick={onGenerateAndOptimizePlan}
                disabled={
                  isProcessing ||
                  isGeneratingDraftPlan ||
                  isOptimizingPlan ||
                  isEnrichmentServerAvailable === false ||
                  !canTriggerDraft
                }
                title={
                  combinedBlockedReasons.length > 0
                    ? `Сначала выполните: ${combinedBlockedReasons.join(', ')}`
                    : 'Рекомендуется: подобрать прецеденты, создать черновик и сразу улучшить его алгоритмом'
                }
              >
                <span>
                  {isGeneratingDraftPlan
                    ? 'ШАГ 1/2: ГЕНЕРАЦИЯ ЧЕРНОВИКА...'
                    : isOptimizingPlan
                      ? 'ШАГ 2/2: ОПТИМИЗАЦИЯ ПЛАНА...'
                      : 'СОЗДАТЬ И ОПТИМИЗИРОВАТЬ ПЛАН (РЕКОМЕНДУЕТСЯ)'}
                </span>
              </button>
            )}

            <button
              type="button"
              className={typeof onGenerateAndOptimizePlan === 'function' ? 'submit-button secondary' : 'submit-button primary'}
              onClick={combineSearchAndDraft ? onGenerateWithPrecedents : onGenerateDraftPlan}
              disabled={
                isProcessing ||
                isGeneratingDraftPlan ||
                isEnrichmentServerAvailable === false ||
                !canTriggerDraft
              }
              title={
                combinedBlockedReasons.length > 0
                  ? `Сначала выполните: ${combinedBlockedReasons.join(', ')}`
                  : combineSearchAndDraft
                    ? 'Подобрать прецеденты и сформировать только черновой план'
                    : 'Сформировать черновой план по данным формы и прецедентам'
              }
            >
              <span>{isGeneratingDraftPlan ? 'ГЕНЕРАЦИЯ...' : 'ТОЛЬКО ЧЕРНОВОЙ ПЛАН'}</span>
            </button>

            {draftPlan && (
              <button
                type="button"
                className="submit-button secondary"
                onClick={onOpenPlan}
                title="Посмотреть сгенерированный план в календаре"
              >
                <span>{optimizedPlan ? 'ОТКРЫТЬ ОПТИМИЗИРОВАННЫЙ ПЛАН' : 'ОТКРЫТЬ ЧЕРНОВИК'}</span>
              </button>
            )}
          </>
        )}

        {phase === 'optimize' && (
          <>
            {draftPlan ? (
              <button
                type="button"
                className="submit-button primary"
                onClick={onOptimizeDraftPlan}
                disabled={
                  isOptimizingPlan ||
                  isProcessing ||
                  isEnrichmentServerAvailable === false
                }
                title={
                  isAnalystMode
                    ? 'Запустить оптимизацию структуры плана (этап 1), затем параметров постов (этап 2)'
                    : 'Улучшить план на основе модели прогноза вовлечённости и эволюционного поиска'
                }
              >
                <span>
                  {isOptimizingPlan
                    ? 'ИДЁТ ОПТИМИЗАЦИЯ ПЛАНА...'
                    : optimizedPlan
                      ? 'ПЕРЕЗАПУСТИТЬ ОПТИМИЗАЦИЮ'
                      : 'ЗАПУСТИТЬ ОПТИМИЗАЦИЮ ПЛАНА'}
                </span>
              </button>
            ) : (
              typeof onGenerateAndOptimizePlan === 'function' && (
                <button
                  type="button"
                  className="submit-button primary"
                  onClick={onGenerateAndOptimizePlan}
                  disabled={
                    isProcessing ||
                    isGeneratingDraftPlan ||
                    isOptimizingPlan ||
                    isEnrichmentServerAvailable === false ||
                    !canTriggerDraft
                  }
                  title="Собрать черновик и сразу выполнить оптимизацию"
                >
                  <span>
                    {isGeneratingDraftPlan
                      ? 'ШАГ 1/2: ГЕНЕРАЦИЯ ЧЕРНОВИКА...'
                      : isOptimizingPlan
                        ? 'ШАГ 2/2: ОПТИМИЗАЦИЯ...'
                        : 'СОЗДАТЬ ЧЕРНОВИК И СРАЗУ ОПТИМИЗИРОВАТЬ'}
                  </span>
                </button>
              )
            )}

            <button
              type="button"
              className={optimizedPlan ? 'submit-button primary' : 'submit-button secondary'}
              onClick={onOpenPlan}
              disabled={!draftPlan && !optimizedPlan}
              title={
                optimizedPlan
                  ? 'Открыть готовый оптимизированный план в календаре'
                  : 'Открыть черновик без улучшения'
              }
            >
              <span>{optimizedPlan ? 'ОТКРЫТЬ ГОТОВЫЙ КОНТЕНТ-ПЛАН' : 'ОТКРЫТЬ ЧЕРНОВИК'}</span>
            </button>
          </>
        )}
      </div>
      {!canTriggerDraft && combinedBlockedReasons.length > 0 && (
        <div className="precedent-empty-state precedent-empty-state-light" role="status" aria-live="polite">
          <strong>Что осталось сделать перед запуском:</strong> {combinedBlockedReasons.join(' · ')}.
        </div>
      )}

      {!draftPlan && (
        <div className="precedent-empty-state precedent-empty-state-light">
          {phase === 'optimize'
            ? 'Черновик ещё не создан. Нажмите «Создать черновик и сразу оптимизировать» выше — возвращаться на предыдущий шаг не обязательно!'
            : 'Нажмите «Создать и оптимизировать план», чтобы система автоматически прошла весь пайплайн, или «Только черновой план», если хотите проверить черновик перед оптимизацией.'}
        </div>
      )}

      {!!draftPlan && (
        <div className="workflow-result-grid">
          <div className="workflow-result-card">
            <div className="workflow-result-header">
              <h3>Черновой план</h3>
              <span className="ui-badge ui-badge-neutral">{isAnalystMode ? 'RAG + LLM генерация' : 'Черновик ИИ'}</span>
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
                Целевая вовлечённость:{' '}
                {draftPlan.kpi_targets?.avg_engagement_rate !== undefined
                  ? formatPercent(draftPlan.kpi_targets.avg_engagement_rate)
                  : '—'}
              </div>
            </div>
            <div className="workflow-next-action">
              <strong>
                {phase === 'optimize'
                  ? 'Черновик готов. Запустите оптимизацию или откройте план.'
                  : optimizedPlan
                    ? 'План уже оптимизирован и готов к просмотру!'
                    : 'Черновик готов! Теперь улучшите его алгоритмом или откройте в календаре.'}
              </strong>
              {phase !== 'optimize' && !optimizedPlan && typeof onGoToOptimizeStep === 'function' && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" className="action-btn" onClick={onGoToOptimizeStep}>
                    <span>Перейти к шагу оптимизации</span>
                  </button>
                  <button type="button" className="action-btn" onClick={onOpenPlan}>
                    <span>Открыть черновик в календаре</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {(phase === 'optimize' || !!optimizedPlan) && (
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
                <div>Публикаций после оптимизации: {optimizedPublicationsCount}</div>
                <div>Режим дат: {getPublicationDayModeLabel(optimizedDayMode)}</div>
                <div>Прогноз лайков плана (сумма по всем постам): {formatNumber(optimizedPredictedTotalLikes)}</div>
                {draftPublicationsCount > 0 && (
                  <div>
                    Эффект оптимизации (по числу постов): {formatInteger(draftPublicationsCount)} → {formatInteger(optimizedPublicationsCount)}
                  </div>
                )}
                {draftToOptimizedLikesDelta !== null && (
                  <div>
                    Эффект оптимизации (по прогнозу лайков): {draftToOptimizedLikesDelta >= 0 ? '+' : ''}
                    {formatNumber(draftToOptimizedLikesDelta)}
                  </div>
                )}
                {planFeatures && <div>Уникальных тем: {planFeatures.unique_topics ?? '—'}</div>}
                {planFeatures && <div>Уникальных тонов: {planFeatures.unique_tones ?? '—'}</div>}
                {planFeatures && <div>Средняя креативность (шкала 0-1): {formatNumber(planFeatures.avg_creativity)}</div>}
                {planFeatures && <div>Доля постов с призывом: {formatPercent(planFeatures.cta_share)}</div>}
                {isAnalystMode && <div>Целевое число постов: {optimizationResult?.stage1?.target_posts_count ?? '—'}</div>}
                {isAnalystMode && <div>Этап 1, причина остановки: {optimizationResult?.stage1?.ga?.stop_reason ?? '—'}</div>}
                {isAnalystMode && <div>Этап 1 поколений: {optimizationResult?.stage1?.ga?.generations ?? '—'}</div>}
                {isAnalystMode && <div>Лучший пост: {optimizationResult?.best_publication?.publication_id ?? '—'}</div>}
                {bestPublication && <div>Лайки лучшего поста (максимум по постам): {formatNumber(bestPostPredictedLikes)}</div>}
                {bestPublicationFeatures && <div>Креативность лучшего поста (шкала 0-1): {formatNumber(bestPublicationFeatures.creativity)}</div>}
                {bestPublicationFeatures && <div>Призыв у лучшего поста: {bestPublicationFeatures.has_cta ? 'да' : 'нет'}</div>}
                {bestPublicationFeatures && <div>Тонов в лучшем посте (кол-во): {bestPublicationFeatures.tones_count ?? '—'}</div>}
                {objectiveBreakdown && <div>Соответствие аудитории (0-1): {formatNumber(objectiveBreakdown.audience_alignment)}</div>}
                {objectiveBreakdown && <div>Согласованность онтологии (0-1): {formatNumber(objectiveBreakdown.ontology_consistency)}</div>}
                {objectiveBreakdown && <div>Баланс форматов (0-1): {formatNumber(objectiveBreakdown.format_mix_fit)}</div>}
                {bestPublication && bestPostMeta(bestPublication.publication_id) && (
                  <div>
                    Стратегия призыва для лучшего поста:{' '}
                    {bestPublicationFeatures?.has_cta
                      ? bestPostMeta(bestPublication.publication_id)?.cta_preference || 'не определена'
                      : 'не применимо (призыв отсутствует)'}
                  </div>
                )}
                {ctaDistribution && (
                  <div>
                    Покрытие призывом (факт/цель): {formatInteger(ctaAssigned)}/{formatInteger(ctaTarget)}
                    {ctaCoverage !== null ? ` (${formatPercent(ctaCoverage)})` : ''}
                  </div>
                )}
                <div>
                  Проверка ограничений:{' '}
                  {constraintsCheck?.valid === true
                    ? `пройдена (нарушений: ${constraintIssuesCount})`
                    : constraintsCheck?.valid === false
                      ? 'есть замечания'
                      : 'не проверялись'}
                </div>
                {constraintsCheck?.valid === false && constraintMessages.length > 0 && (
                    <div className="draft-plan-constraint-detail">
                      {constraintMessages.map((msg, idx) => (
                        <div key={idx}>{msg}</div>
                      ))}
                    </div>
                  )}
                {isAnalystMode && <div>Изменено ограничений алгоритма: {gaChanges.length}</div>}
                {isAnalystMode &&
                  gaChanges.map(([key, beforeValue, afterValue]) => (
                    <div key={key}>
                      {key === 'min_publications' ? 'Минимум публикаций' : key}: {String(beforeValue ?? '—')} → {String(afterValue ?? '—')}
                    </div>
                  ))}
              </div>
            )}
            {!!optimizedPlan && (
              <OptimizationTracePanel
                optimizationResult={optimizationResult}
                bestPublication={bestPublication}
                isAnalyst={isAnalystMode}
              />
            )}
          </div>
          )}
        </div>
      )}
    </section>
  )
}

export default DraftPlanWorkflowPanel
