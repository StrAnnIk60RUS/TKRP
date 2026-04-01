/**
 * Анализ плана на риски: однообразие, воронка, слабые гипотезы
 */

/**
 * @param {Object} plan - draft_content_plan или optimized_content_plan
 * @param {Object} _formData - данные формы (зарезервировано для будущих проверок)
 * @returns {Array<{ id: string, severity: 'high'|'medium'|'low', label: string, detail: string }>}
 */
export function buildRiskSummary(plan, _formData = {}) {
  const risks = []
  if (!plan || typeof plan !== 'object') return risks

  const publications = Array.isArray(plan.publications) ? plan.publications : []
  // 1. Однообразие (мало форматов, целей, тонов)
  const formats = new Set(publications.map((p) => p.format).filter(Boolean))
  const objectives = new Set(publications.map((p) => p.objective).filter(Boolean))
  const tones = new Set(publications.map((p) => p.tone).filter(Boolean))
  if (publications.length >= 10 && (formats.size <= 1 || objectives.size <= 1 || tones.size <= 1)) {
    risks.push({
      id: 'low_diversity',
      severity: 'medium',
      label: 'Низкое разнообразие плана',
      detail: `Форматов: ${formats.size}, целей: ${objectives.size}, тонов: ${tones.size}. План может казаться однообразным аудитории.`
    })
  }

  // 2. Не покрывает воронку (только inform/educate, нет convert/retain)
  const hasConvert = publications.some((p) => p.objective === 'convert')
  const hasRetain = publications.some((p) => p.objective === 'retain')
  const hasEngage = publications.some((p) => p.objective === 'engage')
  if (publications.length >= 5 && !hasConvert && !hasRetain) {
    risks.push({
      id: 'funnel_gap',
      severity: 'medium',
      label: 'Воронка не покрыта',
      detail: 'Нет публикаций с целью convert или retain. Конверсия и удержание могут быть слабыми.'
    })
  }
  if (publications.length >= 5 && !hasEngage) {
    risks.push({
      id: 'no_engage',
      severity: 'low',
      label: 'Мало вовлекающего контента',
      detail: 'Нет публикаций с целью engage. Рекомендуется добавить вовлекающие посты.'
    })
  }

  // 3. Слабые гипотезы (нет used_precedent_ids, низкий engagement_rate)
  const withPrecedents = publications.filter((p) => Array.isArray(p.used_precedent_ids) && p.used_precedent_ids.length > 0)
  const precedentShare = publications.length ? withPrecedents.length / publications.length : 1
  if (publications.length >= 5 && precedentShare < 0.5) {
    risks.push({
      id: 'weak_hypotheses',
      severity: 'low',
      label: 'Мало опоры на прецеденты',
      detail: `Только ${Math.round(precedentShare * 100)}% публикаций привязаны к релевантным прецедентам. Гипотезы могут быть слабо обоснованы.`
    })
  }

  const avgEngagement =
    publications.length > 0
      ? publications.reduce((s, p) => s + (p.expected_kpi?.engagement_rate ?? 0), 0) / publications.length
      : 0
  if (publications.length >= 5 && avgEngagement < 0.02) {
    risks.push({
      id: 'low_engagement_target',
      severity: 'medium',
      label: 'Низкий целевой engagement',
      detail: `Средний целевой engagement_rate ≈ ${(avgEngagement * 100).toFixed(1)}%. Может быть занижена планка.`
    })
  }

  // 4. Мало публикаций при длинном горизонте
  const horizon = plan.planning_horizon || {}
  const start = horizon.start_date ? new Date(horizon.start_date) : null
  const end = horizon.end_date ? new Date(horizon.end_date) : null
  const days = start && end ? Math.ceil((end - start) / (1000 * 60 * 60 * 24)) : 0
  const pubsPerWeek = days > 0 ? (publications.length / days) * 7 : 0
  if (days >= 30 && pubsPerWeek < 1) {
    risks.push({
      id: 'sparse_schedule',
      severity: 'low',
      label: 'Редкий график публикаций',
      detail: `Менее 1 публикации в неделю при горизонте ${days} дней. Охват может быть низким.`
    })
  }

  return risks
}
