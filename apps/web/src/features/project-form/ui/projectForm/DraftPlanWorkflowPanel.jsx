import React from 'react'
import ProcessIndicator from '../../../../shared/ui/ProcessIndicator'

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
  onOptimizeDraftPlan,
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
  isDeveloper = false,
  isEmbedded = false,
  combineSearchAndDraft = false,
  isFlatSmmFlow = false
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
            <h3 className="smm-unified-step-title">Шаг 2. Генерация и оптимизация плана</h3>
          ) : (
            <h2 className="section-title">Шаг 2. Генерация и оптимизация плана</h2>
          )}
          {!isFlatSmmFlow && (
            <p className="workflow-section-subtitle">
              {isDeveloper
                ? 'Сначала создайте черновик, затем при необходимости улучшите его через генетическую оптимизацию.'
                : 'Сначала создайте черновик плана, затем при необходимости запустите улучшение результата.'}
            </p>
          )}
        </div>
      </div>

      <ProcessIndicator active={Boolean(draftActiveProcessId)} processId={draftActiveProcessId} contextual />

      <div className="workflow-action-row workflow-action-row-tight">
        <button
          type="button"
          className="submit-button primary"
          onClick={combineSearchAndDraft ? onGenerateWithPrecedents : onGenerateDraftPlan}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isEnrichmentServerAvailable === false ||
            (combineSearchAndDraft ? !canRunCombinedAction : !canGenerateDraft)
          }
          title={
            combinedBlockedReasons.length > 0
              ? `Сначала выполните: ${combinedBlockedReasons.join(', ')}`
              : combineSearchAndDraft
                ? 'Подобрать прецеденты и сразу сформировать черновой план'
                : 'Сформировать черновой план по данным формы и прецедентам'
          }
        >
          <span>
            {isGeneratingDraftPlan
              ? 'ГЕНЕРАЦИЯ...'
              : combineSearchAndDraft
                ? 'СФОРМИРОВАТЬ ЧЕРНОВОЙ ПЛАН'
                : 'СФОРМИРОВАТЬ ЧЕРНОВОЙ ПЛАН'}
          </span>
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
      {!combineSearchAndDraft && !canGenerateDraft && smmBlockedReasons.length > 0 && (
        <div className="precedent-empty-state precedent-empty-state-light" role="status" aria-live="polite">
          <strong>Почему кнопка неактивна:</strong> {smmBlockedReasons.join(' · ')}
        </div>
      )}
      {combineSearchAndDraft && !canRunCombinedAction && combinedBlockedReasons.length > 0 && (
        <div className="precedent-empty-state precedent-empty-state-light" role="status" aria-live="polite">
          <strong>Почему кнопка неактивна:</strong> {combinedBlockedReasons.join(' · ')}
        </div>
      )}

      {!draftPlan && (
        <div className="precedent-empty-state precedent-empty-state-light">
          {combineSearchAndDraft
            ? 'После запуска здесь появится краткая сводка по структуре чернового плана.'
            : isDeveloper
            ? 'После нажатия `Сформировать черновой план` здесь появится краткая сводка по структуре плана. Технический JSON будет доступен ниже в блоке `Технические детали`.'
            : 'После нажатия `Сформировать черновой план` здесь появится краткая сводка по структуре плана.'}
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
                {planFeatures && <div>Доля постов с CTA: {formatPercent(planFeatures.cta_share)}</div>}
                {isDeveloper && <div>Целевое число постов: {optimizationResult?.stage1?.target_posts_count ?? '—'}</div>}
                {isDeveloper && <div>Этап 1 stop reason: {optimizationResult?.stage1?.ga?.stop_reason ?? '—'}</div>}
                {isDeveloper && <div>Этап 1 поколений: {optimizationResult?.stage1?.ga?.generations ?? '—'}</div>}
                {isDeveloper && <div>Лучший пост: {optimizationResult?.best_publication?.publication_id ?? '—'}</div>}
                {bestPublication && <div>Лайки лучшего поста (максимум по постам): {formatNumber(bestPostPredictedLikes)}</div>}
                {bestPublicationFeatures && <div>Креативность лучшего поста (шкала 0-1): {formatNumber(bestPublicationFeatures.creativity)}</div>}
                {bestPublicationFeatures && <div>CTA у лучшего поста: {bestPublicationFeatures.has_cta ? 'да' : 'нет'}</div>}
                {bestPublicationFeatures && <div>Тонов в лучшем посте (кол-во): {bestPublicationFeatures.tones_count ?? '—'}</div>}
                {objectiveBreakdown && <div>Соответствие аудитории (0-1): {formatNumber(objectiveBreakdown.audience_alignment)}</div>}
                {objectiveBreakdown && <div>Согласованность онтологии (0-1): {formatNumber(objectiveBreakdown.ontology_consistency)}</div>}
                {objectiveBreakdown && <div>Баланс форматов (0-1): {formatNumber(objectiveBreakdown.format_mix_fit)}</div>}
                {bestPublication && bestPostMeta(bestPublication.publication_id) && (
                  <div>
                    Стратегия CTA для лучшего поста:{' '}
                    {bestPublicationFeatures?.has_cta
                      ? bestPostMeta(bestPublication.publication_id)?.cta_preference || 'не определена'
                      : 'не применимо (CTA отсутствует)'}
                  </div>
                )}
                {ctaDistribution && (
                  <div>
                    Покрытие CTA (факт/цель): {formatInteger(ctaAssigned)}/{formatInteger(ctaTarget)}
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
