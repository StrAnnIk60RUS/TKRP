/**
 * Сценарии мастера: готовность, упрощённый поток маркетолога, блокировка при недоступном backend.
 */

/** Порядок операций для роли маркетолога (UC: поиск → генерация одной кнопкой). */
export const MARKETER_COMBINED_WORKFLOW_STEPS = ['searchPrecedents', 'generateDraftPlan']

export function planMarketerCombinedWorkflow({ searchCompleted }) {
  const steps = [...MARKETER_COMBINED_WORKFLOW_STEPS]
  if (!searchCompleted) {
    return { steps: ['searchPrecedents'], blocked: 'generateDraftPlan', reason: 'search_failed' }
  }
  return { steps, blocked: null, reason: null }
}

export function isGenerationBlockedByBackend(isEnrichmentServerAvailable) {
  return isEnrichmentServerAvailable === false
}

export function buildReadinessOverview({
  filledRequired,
  requiredCount,
  competitorsCount,
  precedentsSummary,
  hasDraftPlan,
  hasOptimizedPlan
}) {
  const precedentsInDb =
    (Number(precedentsSummary?.publications_count) || 0) +
    (Number(precedentsSummary?.content_plans_count) || 0)

  return {
    dataLine: `${filledRequired}/${requiredCount} · ${competitorsCount} конкр. · ${precedentsInDb} прец.`,
    statusLine: hasOptimizedPlan
      ? 'Оптимизирован'
      : hasDraftPlan
        ? 'Черновик'
        : 'Ожидает',
    statusMeta: hasOptimizedPlan
      ? 'план готов'
      : hasDraftPlan
        ? 'можно оптимизировать'
        : 'поиск → генерация'
  }
}
