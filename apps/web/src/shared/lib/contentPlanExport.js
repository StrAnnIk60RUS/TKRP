/**
 * Экспорт контент-плана в форматы для SMM-специалистов: Excel (XLSX), PDF.
 * @module contentPlanExport
 */

import * as XLSX from 'xlsx'
import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

const formatPercent = (v) => ((Number(v) || 0) * 100).toFixed(1) + '%'

const toFiniteNumberOrNull = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Табуляция и переносы строк ломают колонки в Excel (TSV) и плывёт PDF-таблица. */
function sanitizeCellForExport(value) {
  if (value === null || value === undefined) return '—'
  const s = String(value)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || '—'
}

const vfsPayload = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs
if (vfsPayload) {
  pdfMake.vfs = vfsPayload
}

/**
 * Подготавливает строки публикаций для экспорта
 * @param {Array} publications
 * @returns {Array<Object>}
 */
const COLUMN_KEYS = [
  '№',
  'Дата',
  'Платформа',
  'Тема',
  'Формат',
  'Цель',
  'Ключевое сообщение',
  'CTA',
  'Тон',
  'Вовлечённость %',
  'Конверсия %',
  'Охват %',
  'ML лайки',
  'ML репосты',
  'ML просмотры'
]

function buildPublicationRows(publications) {
  return (publications || []).map((pub, idx) => {
    const mlLikes =
      toFiniteNumberOrNull(pub.expected_kpi?.ml_predicted_likes) ??
      toFiniteNumberOrNull(pub.expected_kpi?.predicted_likes)
    const mlShares =
      toFiniteNumberOrNull(pub.expected_kpi?.ml_predicted_shares) ??
      toFiniteNumberOrNull(pub.expected_kpi?.predicted_shares)
    const mlViews =
      toFiniteNumberOrNull(pub.expected_kpi?.ml_predicted_views) ??
      toFiniteNumberOrNull(pub.expected_kpi?.predicted_views)

    return {
      [COLUMN_KEYS[0]]: idx + 1,
      [COLUMN_KEYS[1]]: sanitizeCellForExport(pub.planned_date),
      [COLUMN_KEYS[2]]: sanitizeCellForExport((pub.platform || '—').toUpperCase()),
      [COLUMN_KEYS[3]]: sanitizeCellForExport(pub.topic),
      [COLUMN_KEYS[4]]: sanitizeCellForExport(pub.format),
      [COLUMN_KEYS[5]]: sanitizeCellForExport(pub.objective),
      [COLUMN_KEYS[6]]: sanitizeCellForExport(pub.key_message),
      [COLUMN_KEYS[7]]: sanitizeCellForExport(pub.cta),
      [COLUMN_KEYS[8]]: sanitizeCellForExport(pub.tone),
      [COLUMN_KEYS[9]]: formatPercent(pub.expected_kpi?.engagement_rate),
      [COLUMN_KEYS[10]]: formatPercent(pub.expected_kpi?.conversion_potential),
      [COLUMN_KEYS[11]]: formatPercent(pub.expected_kpi?.reach_potential),
      [COLUMN_KEYS[12]]: mlLikes != null ? String(Math.round(mlLikes)) : '—',
      [COLUMN_KEYS[13]]: mlShares != null ? String(Math.round(mlShares)) : '—',
      [COLUMN_KEYS[14]]: mlViews != null ? String(Math.round(mlViews)) : '—'
    }
  })
}

function buildStage2PublicationResolver(optimizationMeta = null) {
  const stage2Publications = Array.isArray(optimizationMeta?.stage2?.publications)
    ? optimizationMeta.stage2.publications
    : []
  const byId = new Map(
    stage2Publications
      .filter((item) => typeof item?.publication_id === 'string' && item.publication_id.trim())
      .map((item) => [item.publication_id.trim(), item])
  )
  return (publication, index) => {
    const publicationId =
      typeof publication?.publication_id === 'string' ? publication.publication_id.trim() : ''
    return byId.get(publicationId) || stage2Publications[index] || null
  }
}

function resolvePostMlMetrics(publication, stage2Match = null) {
  const likes =
    toFiniteNumberOrNull(publication?.expected_kpi?.ml_predicted_likes) ??
    toFiniteNumberOrNull(publication?.expected_kpi?.predicted_likes) ??
    toFiniteNumberOrNull(stage2Match?.predicted_likes)
  const shares =
    toFiniteNumberOrNull(publication?.expected_kpi?.ml_predicted_shares) ??
    toFiniteNumberOrNull(publication?.expected_kpi?.predicted_shares) ??
    toFiniteNumberOrNull(stage2Match?.predicted_shares)
  const views =
    toFiniteNumberOrNull(publication?.expected_kpi?.ml_predicted_views) ??
    toFiniteNumberOrNull(publication?.expected_kpi?.predicted_views) ??
    toFiniteNumberOrNull(stage2Match?.predicted_views)
  return { likes, shares, views }
}

function buildDetailedPostRowsForMonth(month, optimizationMeta = null) {
  const rows = [[
    { text: 'Дата', style: 'detailHeaderCell' },
    { text: 'Платф.', style: 'detailHeaderCell' },
    { text: 'Тема', style: 'detailHeaderCell' },
    { text: 'Формат', style: 'detailHeaderCell' },
    { text: 'Цель', style: 'detailHeaderCell' },
    { text: 'CTA', style: 'detailHeaderCell' },
    { text: 'Тон', style: 'detailHeaderCell' },
    { text: 'ER', style: 'detailHeaderCell' },
    { text: 'CVR', style: 'detailHeaderCell' },
    { text: 'Reach', style: 'detailHeaderCell' },
    { text: 'ML', style: 'detailHeaderCell' }
  ]]
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const detailed = month.days
    .flatMap((day) =>
      (Array.isArray(day?.publications) ? day.publications : []).map((post, index) => ({
        date: day.date,
        post,
        stage2: resolveStage2(post, index)
      }))
    )
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  detailed.forEach(({ date, post, stage2 }) => {
    const metrics = resolvePostMlMetrics(post, stage2)
    rows.push([
      sanitizeCellForExport(date),
      sanitizeCellForExport((post?.platform || '—').toUpperCase()),
      sanitizeCellForExport(post?.topic || post?.key_message || post?.objective || '—'),
      sanitizeCellForExport(post?.format),
      sanitizeCellForExport(post?.objective),
      sanitizeCellForExport(post?.cta),
      sanitizeCellForExport(post?.tone),
      formatPercent(post?.expected_kpi?.engagement_rate),
      formatPercent(post?.expected_kpi?.conversion_potential),
      formatPercent(post?.expected_kpi?.reach_potential),
      `L ${metrics.likes != null ? Math.round(metrics.likes) : '-'} | S ${
        metrics.shares != null ? Math.round(metrics.shares) : '-'
      } | V ${metrics.views != null ? Math.round(metrics.views) : '-'}`
    ])
  })

  return rows
}

const HOLIDAYS = [
  ['01-01', 'Новый год'],
  ['01-07', 'Рождество'],
  ['02-23', '23 февраля'],
  ['03-08', '8 марта'],
  ['05-01', 'Праздник труда'],
  ['05-09', 'День Победы'],
  ['06-12', 'День России'],
  ['11-04', 'День народного единства']
]

function parseIsoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function toIso(date) {
  return date.toISOString().slice(0, 10)
}

function toMonthKey(dateIso) {
  return dateIso.slice(0, 7)
}

function toMonthLabel(monthKey) {
  const date = parseIsoDate(`${monthKey}-01`)
  if (!date) return monthKey
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function getHolidayLabel(isoDate) {
  const suffix = isoDate.slice(5)
  const match = HOLIDAYS.find(([key]) => key === suffix)
  return match ? match[1] : null
}

function buildDateRange(start, end) {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (!from || !to || from > to) return []

  const result = []
  const cursor = new Date(from)
  while (cursor <= to) {
    result.push(toIso(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

function clampText(value, maxLen = 24) {
  const text = sanitizeCellForExport(value)
  if (!text || text === '—') return '—'
  if (text.length <= maxLen) return text
  return `${text.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`
}

function groupPublicationsByMonthAndDay(contentPlan) {
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const start = contentPlan?.planning_horizon?.start_date
  const end = contentPlan?.planning_horizon?.end_date
  const dates =
    start && end && buildDateRange(start, end).length > 0
      ? buildDateRange(start, end)
      : Array.from(
          new Set(
            pubs
              .map((p) => (typeof p?.planned_date === 'string' ? p.planned_date.slice(0, 10) : null))
              .filter(Boolean)
          )
        ).sort()

  const byDate = pubs.reduce((acc, pub) => {
    const date = typeof pub?.planned_date === 'string' ? pub.planned_date.slice(0, 10) : null
    if (!date) return acc
    if (!acc[date]) acc[date] = []
    acc[date].push(pub)
    return acc
  }, {})

  const months = {}
  dates.forEach((dateIso) => {
    const monthKey = toMonthKey(dateIso)
    if (!months[monthKey]) {
      months[monthKey] = {
        days: [],
        meta: {
          totalPublications: 0
        }
      }
    }
    const month = months[monthKey]
    const dayPublications = (byDate[dateIso] || []).sort((a, b) => {
      const aPlatform = String(a?.platform || '').toLowerCase()
      const bPlatform = String(b?.platform || '').toLowerCase()
      if (aPlatform === bPlatform) return 0
      return aPlatform.localeCompare(bPlatform)
    })
    month.days.push({ date: dateIso, publications: dayPublications })
    month.meta.totalPublications += dayPublications.length
  })

  Object.keys(months).forEach((monthKey) => {
    const month = months[monthKey]
    const firstDay = parseIsoDate(month.days[0]?.date)
    if (!firstDay) return
    const startWeekday = firstDay.getUTCDay()
    const weekdayOffset = startWeekday === 0 ? 6 : startWeekday - 1
    for (let i = 0; i < weekdayOffset; i += 1) {
      const date = new Date(firstDay)
      date.setUTCDate(firstDay.getUTCDate() - (weekdayOffset - i))
      month.days.unshift({ date: toIso(date), publications: [] })
    }
    while (month.days.length % 7 !== 0) {
      const lastDay = parseIsoDate(month.days[month.days.length - 1].date)
      const next = new Date(lastDay)
      next.setUTCDate(lastDay.getUTCDate() + 1)
      month.days.push({ date: toIso(next), publications: [] })
    }
    const weeks = []
    for (let i = 0; i < month.days.length; i += 7) {
      weeks.push(month.days.slice(i, i + 7))
    }
    month.weeks = weeks
  })

  return months
}

function toDayNumber(dateIso) {
  const date = parseIsoDate(dateIso)
  if (!date) return '—'
  return String(date.getUTCDate())
}

function getDayKeyDateLabel(rawNotes, dateIso) {
  if (typeof rawNotes !== 'string' || !rawNotes.trim()) return null
  const line = rawNotes
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.includes(dateIso))
  if (!line) return null
  const label = line.replace(dateIso, '').replace(/^[-:.\s]+/, '').trim()
  return label || 'Ключевая дата'
}

function buildDayCellByPlatformLanes(day, options = {}) {
  const { keyDates = '', maxPostsPerLane = 2, maxLinesPerCell = 8, maxTopicLen = 18 } = options
  const pubs = Array.isArray(day?.publications) ? day.publications : []
  const dayNumber = toDayNumber(day?.date || '')
  const holidayLabel = getHolidayLabel(day?.date || '')
  const keyDateLabel = getDayKeyDateLabel(keyDates, day?.date || '')
  const headerMarkers = [holidayLabel, keyDateLabel].filter(Boolean)
  const lines = [headerMarkers.length > 0 ? `${dayNumber} • ${headerMarkers[0]}` : dayNumber]

  const platforms = ['vk', 'linkedin']
  platforms.forEach((platformKey) => {
    const lanePosts = pubs.filter((item) => String(item?.platform || '').toLowerCase() === platformKey)
    const laneTitle = platformKey === 'vk' ? 'VK:' : 'LinkedIn:'
    lines.push(laneTitle)
    if (lanePosts.length === 0) {
      lines.push(' -')
      return
    }
    lanePosts.slice(0, maxPostsPerLane).forEach((post) => {
      const topic = clampText(post?.topic || post?.key_message || post?.objective || 'Пост', maxTopicLen)
      lines.push(` • ${topic}`)
    })
    if (lanePosts.length > maxPostsPerLane) {
      lines.push(` +${lanePosts.length - maxPostsPerLane}`)
    }
  })

  if (lines.length > maxLinesPerCell) {
    return [...lines.slice(0, maxLinesPerCell - 1), '…']
  }
  return lines
}

function buildPdfLane(publications, label, options = {}) {
  const { maxPostsPerLane = 1, maxTopicLen = 18, compact = false } = options
  const lines = [{ text: label, bold: true, color: '#1f2937', fontSize: compact ? 6.4 : 7 }]
  if (!publications.length) {
    lines.push({ text: '—', color: '#9ca3af', fontSize: compact ? 6.2 : 6.6 })
  } else {
    publications.slice(0, maxPostsPerLane).forEach((post) => {
      const topic = clampText(post?.topic || post?.key_message || post?.objective || 'Пост', maxTopicLen)
      const format = clampText(post?.format || '—', compact ? 10 : 12)
      const objective = clampText(post?.objective || '—', compact ? 12 : 14)
      const cta = clampText(post?.cta || '—', compact ? 12 : 14)
      const keyMessage = clampText(post?.key_message || '—', compact ? 12 : 16)
      const tone = clampText(post?.tone || '—', compact ? 10 : 12)
      const engagement = formatPercent(post?.expected_kpi?.engagement_rate)
      const conversion = formatPercent(post?.expected_kpi?.conversion_potential)
      const reach = formatPercent(post?.expected_kpi?.reach_potential)
      const metrics = resolvePostMlMetrics(post, post?.__stage2_match || null)
      lines.push({ text: `• ${topic}`, fontSize: compact ? 6.2 : 6.6, color: '#111827' })
      lines.push({ text: `формат: ${format} | цель: ${objective}`, fontSize: compact ? 5.8 : 6.2, color: '#4b5563' })
      lines.push({ text: `сообщение: ${keyMessage}`, fontSize: compact ? 5.8 : 6.2, color: '#4b5563' })
      lines.push({ text: `CTA: ${cta} | тон: ${tone}`, fontSize: compact ? 5.8 : 6.2, color: '#4b5563' })
      lines.push({ text: `ER: ${engagement} | CVR: ${conversion} | Reach: ${reach}`, fontSize: compact ? 5.8 : 6.2, color: '#374151' })
      lines.push({
        text: `ML: L ${metrics.likes != null ? Math.round(metrics.likes) : '-'} | S ${metrics.shares != null ? Math.round(metrics.shares) : '-'} | V ${metrics.views != null ? Math.round(metrics.views) : '-'}`,
        fontSize: compact ? 5.8 : 6.2,
        color: '#1d4ed8'
      })
    })
    if (publications.length > maxPostsPerLane) {
      lines.push({ text: `+${publications.length - maxPostsPerLane}`, color: '#2563eb', fontSize: compact ? 6.2 : 6.6 })
    }
  }
  return {
    margin: [0, 1, 0, 0],
    fillColor: '#f8fafc',
    border: [false, false, false, false],
    stack: lines
  }
}

function buildPdfDayCell(day, monthKey, options = {}) {
  const {
    keyDates = '',
    compact = false,
    maxPostsPerLane = 1,
    maxTopicLen = 18,
    optimizationMeta = null
  } = options
  const inCurrentMonth = String(day?.date || '').startsWith(monthKey)
  const dayNumber = toDayNumber(day?.date || '')
  const holidayLabel = getHolidayLabel(day?.date || '')
  const keyDateLabel = getDayKeyDateLabel(keyDates, day?.date || '')
  const all = Array.isArray(day?.publications) ? day.publications : []
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const allWithMatches = all.map((item, index) => ({
    ...item,
    __stage2_match: resolveStage2(item, index)
  }))
  const vkPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'vk')
  const linkedInPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'linkedin')

  const header = {
    columns: [
      { text: dayNumber, bold: true, fontSize: compact ? 8 : 9, color: inCurrentMonth ? '#111827' : '#9ca3af' },
      {
        text: holidayLabel ? 'Праздник' : keyDateLabel ? 'Ключевая дата' : '',
        alignment: 'right',
        fontSize: 6.2,
        color: holidayLabel ? '#dc2626' : '#6b7280'
      }
    ]
  }

  const lanes = [
    buildPdfLane(vkPosts, 'VK', { maxPostsPerLane, maxTopicLen, compact }),
    buildPdfLane(linkedInPosts, 'LinkedIn', { maxPostsPerLane, maxTopicLen, compact })
  ]

  return {
    margin: [0, 0, 0, 0],
    stack: [header, ...lanes],
    fillColor: inCurrentMonth ? '#ffffff' : '#f9fafb'
  }
}

function buildPlanMlSummary(contentPlan, optimizationMeta = null) {
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const engagementValues = pubs
    .map((item) => toFiniteNumberOrNull(item?.expected_kpi?.engagement_rate))
    .filter((value) => Number.isFinite(value))
  const conversionValues = pubs
    .map((item) => toFiniteNumberOrNull(item?.expected_kpi?.conversion_potential))
    .filter((value) => Number.isFinite(value))
  const reachValues = pubs
    .map((item) => toFiniteNumberOrNull(item?.expected_kpi?.reach_potential))
    .filter((value) => Number.isFinite(value))
  const totalMlLikes = pubs.reduce((sum, item, index) => {
    const metrics = resolvePostMlMetrics(item, resolveStage2(item, index))
    return sum + (metrics.likes ?? 0)
  }, 0)
  const totalMlShares = pubs.reduce((sum, item, index) => {
    const metrics = resolvePostMlMetrics(item, resolveStage2(item, index))
    return sum + (metrics.shares ?? 0)
  }, 0)
  const totalMlViews = pubs.reduce((sum, item, index) => {
    const metrics = resolvePostMlMetrics(item, resolveStage2(item, index))
    return sum + (metrics.views ?? 0)
  }, 0)
  const avgEngagement =
    engagementValues.length > 0
      ? engagementValues.reduce((acc, value) => acc + value, 0) / engagementValues.length
      : 0
  const avgConversion =
    conversionValues.length > 0
      ? conversionValues.reduce((acc, value) => acc + value, 0) / conversionValues.length
      : 0
  const avgReach =
    reachValues.length > 0 ? reachValues.reduce((acc, value) => acc + value, 0) / reachValues.length : 0

  return {
    totalMlLikes,
    totalMlShares,
    totalMlViews,
    avgEngagement,
    avgConversion,
    avgReach
  }
}

/**
 * Скачивает контент-план в Excel (XLSX)
 * @param {Object} contentPlan — план с publications
 * @param {string} [filename] — имя файла без расширения
 */
export function exportToExcel(contentPlan, filename, options = {}) {
  const optimizationMeta = options?.optimizationMeta || null
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const rows = buildPublicationRows(pubs).map((row, index) => {
    const metrics = resolvePostMlMetrics(pubs[index], resolveStage2(pubs[index], index))
    return {
      ...row,
      [COLUMN_KEYS[12]]: metrics.likes != null ? String(Math.round(metrics.likes)) : '—',
      [COLUMN_KEYS[13]]: metrics.shares != null ? String(Math.round(metrics.shares)) : '—',
      [COLUMN_KEYS[14]]: metrics.views != null ? String(Math.round(metrics.views)) : '—'
    }
  })

  const wb = XLSX.utils.book_new()

  const wsData = rows.length
    ? [COLUMN_KEYS, ...rows.map((r) => Object.values(r))]
    : [COLUMN_KEYS]

  const ws = XLSX.utils.aoa_to_sheet(wsData)
  XLSX.utils.book_append_sheet(wb, ws, 'Публикации')

  const displayName =
    typeof contentPlan?.display_name === 'string' && contentPlan.display_name.trim()
      ? contentPlan.display_name.trim()
      : null

  const mlSummary = buildPlanMlSummary(contentPlan, optimizationMeta)
  const params = contentPlan?.planning_horizon
    ? [
        ['Параметр', 'Значение'],
        ...(displayName ? [['Название плана', displayName]] : []),
        ['Период', `${contentPlan.planning_horizon.start_date || '—'} — ${contentPlan.planning_horizon.end_date || '—'}`],
        ['Платформы', Array.isArray(contentPlan.platforms) ? contentPlan.platforms.join(', ').toUpperCase() : '—'],
        ['Всего публикаций', String(pubs.length)],
        ['', ''],
        ['ML метрики плана', ''],
        ['Суммарные ML лайки (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
        ['Суммарные ML репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
        ['Суммарные ML просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
        ['Средняя вовлечённость (по постам)', formatPercent(mlSummary.avgEngagement)],
        ['Средняя конверсия (по постам)', formatPercent(mlSummary.avgConversion)],
        ['Средний охват (по постам)', formatPercent(mlSummary.avgReach)]
      ]
    : displayName
      ? [
          ['Параметр', 'Значение'],
          ['Название плана', displayName],
          ['Всего публикаций', String(pubs.length)],
          ['', ''],
          ['ML метрики плана', ''],
          ['Суммарные ML лайки (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
          ['Суммарные ML репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
          ['Суммарные ML просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
          ['Средняя вовлечённость (по постам)', formatPercent(mlSummary.avgEngagement)],
          ['Средняя конверсия (по постам)', formatPercent(mlSummary.avgConversion)],
          ['Средний охват (по постам)', formatPercent(mlSummary.avgReach)]
        ]
      : [
          ['Параметр', 'Значение'],
          ['Всего публикаций', String(pubs.length)],
          ['', ''],
          ['ML метрики плана', ''],
          ['Суммарные ML лайки (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
          ['Суммарные ML репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
          ['Суммарные ML просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
          ['Средняя вовлечённость (по постам)', formatPercent(mlSummary.avgEngagement)],
          ['Средняя конверсия (по постам)', formatPercent(mlSummary.avgConversion)],
          ['Средний охват (по постам)', formatPercent(mlSummary.avgReach)]
        ]

  const wsParams = XLSX.utils.aoa_to_sheet(params)
  XLSX.utils.book_append_sheet(wb, wsParams, 'Параметры плана')

  const base = filename || `content_plan_${new Date().toISOString().split('T')[0]}`
  XLSX.writeFile(wb, `${base}.xlsx`)
}

/**
 * Скачивает контент-план в PDF (с поддержкой кириллицы через Roboto)
 * @param {Object} contentPlan
 * @param {Object} [options] — { filename?, isOptimized? }
 */
export async function exportToPdf(contentPlan, options = {}) {
  const { filename, isOptimized, optimizationMeta = null } =
    typeof options === 'string' ? { filename: options } : options
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const pdfTitleName =
    typeof contentPlan?.display_name === 'string' && contentPlan.display_name.trim()
      ? contentPlan.display_name.trim()
      : null
  const headline = isOptimized ? 'Оптимизированный контент-план' : 'Контент-план'
  const period =
    contentPlan?.planning_horizon?.start_date && contentPlan?.planning_horizon?.end_date
      ? `${contentPlan.planning_horizon.start_date} — ${contentPlan.planning_horizon.end_date}`
      : '—'
  const months = groupPublicationsByMonthAndDay(contentPlan)
  const weekdayHead = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const monthKeys = Object.keys(months).sort()
  const content = []
  if (monthKeys.length === 0) {
    content.push(
      { text: pdfTitleName ? `${headline}: ${pdfTitleName}` : headline, style: 'title' },
      { text: `Период: ${period} | Публикаций: ${pubs.length}`, style: 'subtitle' },
      { text: 'В плане пока нет публикаций', margin: [0, 16, 0, 0] }
    )
  } else {
    monthKeys.forEach((monthKey, index) => {
      const month = months[monthKey]
      const compact = month.weeks.length >= 6
      const dayRows = month.weeks.map((week) =>
        week.map((day) =>
          buildPdfDayCell(day, monthKey, {
            keyDates: contentPlan?.notes || '',
            compact,
            maxPostsPerLane: compact ? 1 : 1,
            maxTopicLen: compact ? 11 : 15,
            optimizationMeta
          })
        )
      )
      content.push({
        pageBreak: index > 0 ? 'before' : undefined,
        stack: [
          { text: pdfTitleName ? `${headline}: ${pdfTitleName}` : headline, style: 'title' },
          { text: `Период: ${period} | Публикаций: ${pubs.length}`, style: 'subtitle' },
          { text: toMonthLabel(monthKey), style: 'monthTitle' },
          {
            table: {
              headerRows: 1,
              widths: ['14.28%', '14.28%', '14.28%', '14.28%', '14.28%', '14.28%', '14.28%'],
              body: [weekdayHead, ...dayRows]
            },
            layout: {
              fillColor: (rowIndex) => (rowIndex === 0 ? '#2563eb' : null),
              hLineColor: (rowIndex) => (rowIndex === 0 ? '#1d4ed8' : '#d1d5db'),
              vLineColor: (colIndex, rowIndex) => (rowIndex === 0 ? '#1d4ed8' : '#d1d5db'),
              paddingLeft: () => 4,
              paddingRight: () => 4,
              paddingTop: (rowIndex) => (rowIndex === 0 ? 6 : compact ? 4 : 5),
              paddingBottom: (rowIndex) => (rowIndex === 0 ? 6 : compact ? 4 : 5)
            }
          },
          {
            text: 'Детализация постов за месяц',
            style: 'detailsTitle',
            margin: [0, 12, 0, 6]
          },
          {
            table: {
              headerRows: 1,
              widths: ['8%', '6%', '18%', '8%', '10%', '12%', '8%', '6%', '6%', '7%', '11%'],
              body: buildDetailedPostRowsForMonth(month, optimizationMeta)
            },
            layout: {
              fillColor: (rowIndex) => (rowIndex === 0 ? '#374151' : rowIndex % 2 === 0 ? '#f9fafb' : null),
              hLineColor: () => '#d1d5db',
              vLineColor: () => '#d1d5db',
              paddingLeft: () => 3,
              paddingRight: () => 3,
              paddingTop: () => 3,
              paddingBottom: () => 3
            },
            fontSize: 7
          }
        ]
      })
    })
  }

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [20, 18, 20, 18],
    content,
    styles: {
      title: { fontSize: 16, bold: true, color: '#111827' },
      subtitle: { fontSize: 10, color: '#4b5563', margin: [0, 4, 0, 0] },
      monthTitle: { fontSize: 13, bold: true, color: '#111827', margin: [0, 12, 0, 8] },
      detailsTitle: { fontSize: 10, bold: true, color: '#111827' },
      detailHeaderCell: { bold: true, color: '#ffffff' }
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 8,
      color: '#111827'
    }
  }

  const base = filename ?? `content_plan_${new Date().toISOString().split('T')[0]}`
  pdfMake.createPdf(docDefinition).download(`${base}.pdf`)
}
