const MONTH_INDEX = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12
}

const MONTH_NAMES = Object.keys(MONTH_INDEX).join('|')
const DATE_TOKEN_RE = new RegExp(
  `(\\d{4}-\\d{2}-\\d{2})|(\\d{1,2})\\.(\\d{2})(?:\\.(\\d{4}))?|(\\d{1,2})\\s+(${MONTH_NAMES})(?:\\s+(\\d{4}))?`,
  'gi'
)
const STRUCTURED_LINE_RE = /^(\d{4}-\d{2}-\d{2})(?:\s*[—–:-]\s*(.*))?$/

export const KEY_DATE_HOLIDAYS = [
  ['01-01', 'Новый год'],
  ['01-07', 'Рождество'],
  ['02-23', '23 февраля'],
  ['03-08', '8 марта'],
  ['05-01', 'Праздник труда'],
  ['05-09', 'День Победы'],
  ['06-12', 'День России'],
  ['11-04', 'День народного единства']
]

const pad = (value) => String(value).padStart(2, '0')

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const [year, month, day] = value.split('-').map(Number)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null
  }
  return date
}

export function toIsoDate(year, month, day) {
  const iso = `${year}-${pad(month)}-${pad(day)}`
  return parseIsoDate(iso) ? iso : null
}

export function listMonthKeys(startDate, endDate) {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end || start > end) return []

  const keys = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth() + 1
  const endKey = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}`

  while (keys.length < 36) {
    const key = `${year}-${pad(month)}`
    keys.push(key)
    if (key === endKey) break
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return keys
}

export function buildMonthCells(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number)
  if (!year || !month) return []
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells = Array(firstWeekday).fill(null)
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${monthKey}-${pad(day)}`)
  }
  return cells
}

export function formatKeyDate(iso) {
  const date = parseIsoDate(iso)
  if (!date) return iso
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    timeZone: 'UTC'
  }).format(date)
  return formatted.replace(/\s+/g, ' ')
}

export function formatMonthLabel(monthKey) {
  const date = parseIsoDate(`${monthKey}-01`)
  if (!date) return monthKey
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date)
  return formatted.replace(/\s*г\.?$/, '')
}

export function isDateInRange(iso, startDate, endDate) {
  if (!parseIsoDate(iso) || !parseIsoDate(startDate) || !parseIsoDate(endDate)) return false
  return iso >= startDate && iso <= endDate
}

export function holidaysInRange(startDate, endDate) {
  const months = listMonthKeys(startDate, endDate)
  if (!months.length) return []
  const startYear = Number(months[0].slice(0, 4))
  const endYear = Number(months[months.length - 1].slice(0, 4))
  const result = []

  for (let year = startYear; year <= endYear; year += 1) {
    KEY_DATE_HOLIDAYS.forEach(([suffix, label]) => {
      const iso = `${year}-${suffix}`
      if (isDateInRange(iso, startDate, endDate)) result.push({ date: iso, label })
    })
  }

  return result
}

function resolveYear(month, day, explicitYear, startDate, endDate) {
  if (explicitYear) return explicitYear
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (start && end) {
    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
      const iso = toIsoDate(year, month, day)
      if (iso && iso >= startDate && iso <= endDate) return year
    }
    return start.getUTCFullYear()
  }
  return new Date().getFullYear()
}

function tokenToIso(match, startDate, endDate) {
  if (match[1]) return parseIsoDate(match[1]) ? match[1] : null

  if (match[2] && match[3]) {
    const day = Number(match[2])
    const month = Number(match[3])
    const year = resolveYear(month, day, match[4] ? Number(match[4]) : null, startDate, endDate)
    return toIsoDate(year, month, day)
  }

  if (match[5] && match[6]) {
    const day = Number(match[5])
    const month = MONTH_INDEX[match[6].toLowerCase()]
    const year = resolveYear(month, day, match[7] ? Number(match[7]) : null, startDate, endDate)
    return toIsoDate(year, month, day)
  }

  return null
}

function cleanLegacyDescription(value) {
  return String(value || '')
    .replace(/^[\s,;.—–\-:]+/, '')
    .replace(/^г\.?\s*/i, '')
    .replace(/[\s,;.—–\-:]+$/, '')
    .trim()
}

function mergeItems(items) {
  const byDate = new Map()
  items.forEach((item) => {
    if (!item?.date) return
    const description = item.description ?? ''
    const existing = byDate.get(item.date)
    if (!existing) {
      byDate.set(item.date, { date: item.date, description })
      return
    }
    if (!existing.description) existing.description = description
    else if (description && !existing.description.includes(description)) {
      existing.description = `${existing.description}; ${description}`
    }
  })
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function hasStructuredLines(text) {
  return text.split('\n').some((line) => /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(line.trim()))
}

function parseStructured(text) {
  const items = []
  const noteLines = []

  text.split('\n').forEach((line) => {
    const match = line.match(STRUCTURED_LINE_RE)
    if (match && parseIsoDate(match[1])) {
      items.push({ date: match[1], description: match[2] ?? '' })
      return
    }
    noteLines.push(line)
  })

  while (noteLines[0] === '') noteLines.shift()
  while (noteLines.length && noteLines[noteLines.length - 1] === '') noteLines.pop()

  return {
    items: mergeItems(items),
    notes: noteLines.join('\n')
  }
}

function parseLegacy(text, startDate, endDate) {
  const tokens = []
  DATE_TOKEN_RE.lastIndex = 0
  let match = DATE_TOKEN_RE.exec(text)
  while (match) {
    const date = tokenToIso(match, startDate, endDate)
    if (date) tokens.push({ date, index: match.index, end: match.index + match[0].length })
    match = DATE_TOKEN_RE.exec(text)
  }

  if (!tokens.length) return { items: [], notes: text.trim() }

  const items = tokens.map((token, index) => {
    const next = tokens[index + 1]
    const raw = text.slice(token.end, next ? next.index : text.length)
    return { date: token.date, description: cleanLegacyDescription(raw) }
  })
  const notes = cleanLegacyDescription(text.slice(0, tokens[0].index))
  return { items: mergeItems(items), notes }
}

export function parseKeyDates(raw, range = {}) {
  const text = String(raw || '').replace(/\r\n/g, '\n')
  if (!text.trim()) return { items: [], notes: '' }
  const { startDate = '', endDate = '' } = range
  if (hasStructuredLines(text)) return parseStructured(text)
  return parseLegacy(text, startDate, endDate)
}

export function serializeKeyDates(items = [], notes = '') {
  const lines = mergeItems(items).map((item) => {
    const description = String(item.description ?? '').replace(/\s*\n\s*/g, ' ')
    return description ? `${item.date} — ${description}` : item.date
  })
  const noteText = String(notes ?? '')
  if (noteText.trim()) lines.push(noteText)
  return lines.join('\n')
}
