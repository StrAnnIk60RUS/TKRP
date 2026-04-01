/** Утилиты страницы контент-плана (без React), общие для UI. */

export const DEFAULT_FILTERS = {
  search: '',
  platform: 'all',
  format: 'all',
  dateFrom: '',
  dateTo: ''
}

export const MAX_PLAN_DISPLAY_NAME_LEN = 120

export const ensureUniquePublicationIds = (plan) => {
  if (!plan || typeof plan !== 'object') return plan
  const pubs = Array.isArray(plan.publications) ? plan.publications : []
  if (!pubs.length) return plan

  const used = new Set()
  const normalized = pubs.map((pub, idx) => {
    const base = typeof pub?.publication_id === 'string' ? pub.publication_id.trim() : ''
    let next = base || `pub_${String(idx + 1).padStart(3, '0')}`
    while (used.has(next)) next = `${next}_${idx + 1}`
    used.add(next)
    return { ...pub, publication_id: next }
  })

  return { ...plan, publications: normalized }
}

export const sanitizeExportBasename = (name) => {
  const t = typeof name === 'string' ? name.trim().slice(0, 80) : ''
  if (!t) return null
  const forbidden = new Set('<>:"/\\|?*')
  const cleaned = Array.from(t, (ch) => {
    const code = ch.codePointAt(0)
    if (forbidden.has(ch) || (code >= 0 && code <= 31)) return '_'
    return ch
  })
    .join('')
    .replace(/\s+/g, '_')
  return cleaned || null
}

export const getPlatformsFromPublications = (pubs) => {
  const allowed = new Set(['vk', 'linkedin'])
  const set = new Set()
  pubs.forEach((p) => {
    if (allowed.has(p?.platform)) set.add(p.platform)
  })
  return Array.from(set)
}

export const getDateTimestamp = (value) => {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export const sortPublicationsByDate = (pubs) =>
  [...pubs].sort((a, b) => getDateTimestamp(a?.planned_date) - getDateTimestamp(b?.planned_date))

export const normalizeText = (value) => (typeof value === 'string' ? value.toLowerCase() : '')
export const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

export const formatSavedAt = (value) => {
  if (!value) return 'Дата неизвестна'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU')
}

export const formatSavedPlatforms = (items) =>
  Array.from(
    new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
  )
    .sort()
    .join(', ')

/** 32 hex — идентификатор снимка на сервере (в URL, ссылках, API). */
export const SNAPSHOT_TOKEN_RE = /^[a-f0-9]{32}$/i

/**
 * Из поля ввода: голый токен, URL с ?token=..., путь .../snapshots/<token>.
 */
export function extractSnapshotTokenFromInput(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return ''
  if (SNAPSHOT_TOKEN_RE.test(s)) return s.toLowerCase()
  try {
    const absolute = /^https?:\/\//i.test(s)
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const u = absolute ? new URL(s) : new URL(s, base)
    const fromQuery = u.searchParams.get('token')?.trim()
    if (fromQuery && SNAPSHOT_TOKEN_RE.test(fromQuery)) return fromQuery.toLowerCase()
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && SNAPSHOT_TOKEN_RE.test(last)) return last.toLowerCase()
  } catch {
    /* не URL */
  }
  const embedded = s.match(/[a-f0-9]{32}/i)
  return embedded && SNAPSHOT_TOKEN_RE.test(embedded[0]) ? embedded[0].toLowerCase() : ''
}

export const matchesFilters = (publication, filters) => {
  if (filters.platform !== 'all' && publication.platform !== filters.platform) return false
  if (filters.format !== 'all' && publication.format !== filters.format) return false

  const plannedDate = publication.planned_date || ''
  if (filters.dateFrom && plannedDate && plannedDate < filters.dateFrom) return false
  if (filters.dateTo && plannedDate && plannedDate > filters.dateTo) return false

  if (filters.search.trim()) {
    const haystack = [
      publication.topic,
      publication.key_message,
      publication.cta,
      publication.objective,
      publication.tone
    ]
      .map(normalizeText)
      .join(' ')

    if (!haystack.includes(filters.search.trim().toLowerCase())) return false
  }

  return true
}
