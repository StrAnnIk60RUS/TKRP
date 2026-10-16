/**
 * Отображение результатов RAG в UI (карточки прецедентов, режим retrieval).
 */

export function formatPrecedentScore(score) {
  return `${Math.round((Number(score) || 0) * 100)}%`
}

export function formatReliabilityLabel(reliability) {
  const r = Number(reliability)
  if (!Number.isFinite(r)) return null
  const pct = Math.round(r * 100)
  if (pct >= 75) return { label: `${pct}%`, tone: 'success', title: 'Высокая надёжность' }
  if (pct >= 50) return { label: `${pct}%`, tone: 'neutral', title: 'Средняя надёжность' }
  return { label: `${pct}%`, tone: 'warn', title: 'Низкая надёжность' }
}

export function renderMatchExplanation(matchedTokens = [], retrieval = null) {
  const type = retrieval?.type
  if (type === 'embedding_cosine') {
    return 'Поиск по смыслу: совпадение считается по смыслу, а не по словам'
  }
  if (type === 'token_overlap' || type === 'token_overlap_fallback') {
    if (!matchedTokens.length) return 'Запасной поиск по словам: совпадение по словам запроса'
    return `Запасной поиск по словам: ${matchedTokens.join(', ')}`
  }
  if (!matchedTokens.length) return 'Без совпавших токенов'
  return matchedTokens.join(', ')
}

export function buildRetrievalBadge(retrieval, { isDeveloper = true } = {}) {
  const type = retrieval?.type
  if (type === 'embedding_cosine') {
    return isDeveloper
      ? {
          label: 'Поиск по смыслу',
          hint: retrieval?.embedding_model ? `${retrieval.embedding_model}` : 'эмбеддинги',
          tone: 'success'
        }
      : { label: 'Поиск по смыслу', hint: '', tone: 'success' }
  }
  if (type === 'token_overlap' || type === 'token_overlap_fallback') {
    return isDeveloper
      ? { label: 'Поиск по ключевым словам', hint: 'запасной режим', tone: 'neutral' }
      : { label: 'Поиск по ключевым словам', hint: '', tone: 'neutral' }
  }
  if (!type) return null
  return { label: type, hint: '', tone: 'neutral' }
}

export function countPrecedentResults(results) {
  const pubs = Array.isArray(results?.publications) ? results.publications.length : 0
  const plans = Array.isArray(results?.content_plans) ? results.content_plans.length : 0
  return { publications: pubs, content_plans: plans, total: pubs + plans }
}
