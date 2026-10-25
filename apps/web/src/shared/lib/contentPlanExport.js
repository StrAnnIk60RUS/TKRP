/**
 * Экспорт контент-плана в форматы для SMM-специалистов: Excel (XLSX), PDF.
 * @module contentPlanExport
 */

let cachedPdfMake = null

async function loadPdfMake() {
  if (cachedPdfMake) return cachedPdfMake
  const [pdfMakeMod, pdfFontsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts')
  ])
  const pdfMake = pdfMakeMod.default || pdfMakeMod
  const pdfFonts = pdfFontsMod.default || pdfFontsMod
  const vfsPayload = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs
  if (vfsPayload) {
    pdfMake.vfs = vfsPayload
  }
  cachedPdfMake = pdfMake
  return pdfMake
}

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

/** Сохраняет переносы строк для многострочного текста постов в Excel. */
function sanitizeMultilineTextForExport(value) {
  if (value === null || value === undefined) return '—'
  const s = String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .trim()
  return s || '—'
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
  'Текст поста',
  'Призыв',
  'Тон',
  'Медиа: Тип',
  'Медиа: Ссылка',
  'Медиа: Промпт',
  'Вовлечённость %',
  'Конверсия %',
  'Охват %',
  'Прогноз лайков',
  'Прогноз репостов',
  'Прогноз просмотров',
  'Статус публикации',
  'Ссылка на публикацию'
]

export function buildPublicationRows(publications) {
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

    const mediaKind =
      pub.media?.kind ||
      (pub.format === 'video'
        ? 'video'
        : pub.format === 'image' || pub.format === 'combined'
          ? 'image'
          : '')

    return {
      '№': idx + 1,
      'Дата': sanitizeCellForExport(pub.planned_date),
      'Платформа': sanitizeCellForExport((pub.platform || '—').toUpperCase()),
      'Тема': sanitizeCellForExport(pub.topic),
      'Формат': sanitizeCellForExport(pub.format),
      'Цель': sanitizeCellForExport(pub.objective),
      'Ключевое сообщение': sanitizeCellForExport(pub.key_message),
      'Текст поста': sanitizeMultilineTextForExport(pub.summary || pub.text || pub.content),
      'Призыв': sanitizeCellForExport(pub.cta),
      'Тон': sanitizeCellForExport(pub.tone),
      'Медиа: Тип': sanitizeCellForExport(mediaKind),
      'Медиа: Ссылка': sanitizeCellForExport(pub.media?.url || pub.post_url),
      'Медиа: Промпт': sanitizeCellForExport(pub.media_prompt || pub.media?.prompt),
      'Вовлечённость %': formatPercent(pub.expected_kpi?.engagement_rate),
      'Конверсия %': formatPercent(pub.expected_kpi?.conversion_potential),
      'Охват %': formatPercent(pub.expected_kpi?.reach_potential),
      'Прогноз лайков': mlLikes != null ? String(Math.round(mlLikes)) : '—',
      'Прогноз репостов': mlShares != null ? String(Math.round(mlShares)) : '—',
      'Прогноз просмотров': mlViews != null ? String(Math.round(mlViews)) : '—',
      'Статус публикации': sanitizeCellForExport(pub.status || 'черновик'),
      'Ссылка на публикацию': sanitizeCellForExport(pub.post_url)
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
    if (publicationId && byId.has(publicationId)) {
      return byId.get(publicationId)
    }
    const resolvedIndex = Number.isInteger(index)
      ? index
      : Number.isInteger(publication?.__global_index)
        ? publication.__global_index
        : null
    return resolvedIndex != null ? stage2Publications[resolvedIndex] || null : null
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
    { text: 'Призыв', style: 'detailHeaderCell' },
    { text: 'Тон', style: 'detailHeaderCell' },
    { text: 'Вовлеч.', style: 'detailHeaderCell' },
    { text: 'Конверсия', style: 'detailHeaderCell' },
    { text: 'Охват', style: 'detailHeaderCell' },
    { text: 'Прогноз', style: 'detailHeaderCell' }
  ]]
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const detailed = month.days
    .flatMap((day) =>
      (Array.isArray(day?.publications) ? day.publications : []).map((post) => ({
        date: day.date,
        post,
        stage2: resolveStage2(post, post?.__global_index)
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

  const byDate = pubs.reduce((acc, pub, globalIdx) => {
    const date = typeof pub?.planned_date === 'string' ? pub.planned_date.slice(0, 10) : null
    if (!date) return acc
    if (!acc[date]) acc[date] = []
    acc[date].push({ ...pub, __global_index: globalIdx })
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
      lines.push({ text: `призыв: ${cta} | тон: ${tone}`, fontSize: compact ? 5.8 : 6.2, color: '#4b5563' })
      lines.push({ text: `вовлечённость: ${engagement} | конверсия: ${conversion} | охват: ${reach}`, fontSize: compact ? 5.8 : 6.2, color: '#374151' })
      lines.push({
        text: `прогноз: лайки ${metrics.likes != null ? Math.round(metrics.likes) : '—'} | репосты ${metrics.shares != null ? Math.round(metrics.shares) : '—'} | просмотры ${metrics.views != null ? Math.round(metrics.views) : '—'}`,
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
  const allWithMatches = all.map((item) => ({
    ...item,
    __stage2_match: resolveStage2(item, item?.__global_index)
  }))
  const vkPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'vk')
  const linkedInPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'linkedin')
  const telegramPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'telegram')
  const instagramPosts = allWithMatches.filter((item) => String(item?.platform || '').toLowerCase() === 'instagram')

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
    buildPdfLane(linkedInPosts, 'LinkedIn', { maxPostsPerLane, maxTopicLen, compact }),
    ...(telegramPosts.length
      ? [buildPdfLane(telegramPosts, 'Telegram', { maxPostsPerLane, maxTopicLen, compact })]
      : []),
    ...(instagramPosts.length
      ? [buildPdfLane(instagramPosts, 'Instagram', { maxPostsPerLane, maxTopicLen, compact })]
      : [])
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
export async function exportToExcel(contentPlan, filename, options = {}) {
  const XLSX = await import('xlsx')
  const optimizationMeta = options?.optimizationMeta || null
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
  const rows = buildPublicationRows(pubs).map((row, index) => {
    const metrics = resolvePostMlMetrics(pubs[index], resolveStage2(pubs[index], index))
    return {
      ...row,
      'Прогноз лайков': metrics.likes != null ? String(Math.round(metrics.likes)) : row['Прогноз лайков'],
      'Прогноз репостов': metrics.shares != null ? String(Math.round(metrics.shares)) : row['Прогноз репостов'],
      'Прогноз просмотров': metrics.views != null ? String(Math.round(metrics.views)) : row['Прогноз просмотров']
    }
  })

  const wb = XLSX.utils.book_new()

  const wsData = rows.length
    ? [COLUMN_KEYS, ...rows.map((r) => COLUMN_KEYS.map((colKey) => r[colKey] ?? '—'))]
    : [COLUMN_KEYS]

  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [
    { wch: 5 },
    { wch: 12 },
    { wch: 12 },
    { wch: 28 },
    { wch: 14 },
    { wch: 16 },
    { wch: 32 },
    { wch: 60 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 34 },
    { wch: 42 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 34 }
  ]
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
        ['Прогнозные метрики плана', ''],
        ['Суммарный прогноз лайков (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
        ['Суммарные прогнозные репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
        ['Суммарные прогнозные просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
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
          ['Прогнозные метрики плана', ''],
          ['Суммарный прогноз лайков (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
          ['Суммарные прогнозные репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
          ['Суммарные прогнозные просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
          ['Средняя вовлечённость (по постам)', formatPercent(mlSummary.avgEngagement)],
          ['Средняя конверсия (по постам)', formatPercent(mlSummary.avgConversion)],
          ['Средний охват (по постам)', formatPercent(mlSummary.avgReach)]
        ]
      : [
          ['Параметр', 'Значение'],
          ['Всего публикаций', String(pubs.length)],
          ['', ''],
          ['Прогнозные метрики плана', ''],
          ['Суммарный прогноз лайков (по постам)', String(Math.round(mlSummary.totalMlLikes || 0))],
          ['Суммарные прогнозные репосты (по постам)', String(Math.round(mlSummary.totalMlShares || 0))],
          ['Суммарные прогнозные просмотры (по постам)', String(Math.round(mlSummary.totalMlViews || 0))],
          ['Средняя вовлечённость (по постам)', formatPercent(mlSummary.avgEngagement)],
          ['Средняя конверсия (по постам)', formatPercent(mlSummary.avgConversion)],
          ['Средний охват (по постам)', formatPercent(mlSummary.avgReach)]
        ]

  const wsParams = XLSX.utils.aoa_to_sheet(params)
  XLSX.utils.book_append_sheet(wb, wsParams, 'Параметры плана')

  const base = filename || `content_plan_${new Date().toISOString().split('T')[0]}`
  XLSX.writeFile(wb, `${base}.xlsx`)
}

async function blobToCompatibleImageDataUrl(blob) {
  if (typeof FileReader === 'undefined' || !blob) return null

  if (blob.type === 'image/jpeg' || blob.type === 'image/png') {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  }

  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      const objectUrl = URL.createObjectURL(blob)
      const dataUrl = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth || img.width || 400
            canvas.height = img.naturalHeight || img.height || 300
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            const result = canvas.toDataURL('image/png')
            resolve(result)
          } catch {
            resolve(null)
          }
        }
        img.onerror = () => resolve(null)
        img.src = objectUrl
      })
      URL.revokeObjectURL(objectUrl)
      if (dataUrl) return dataUrl
    } catch {
      // fallback to FileReader
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

async function preloadPublicationImages(publications = []) {
  const map = new Map()
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return map
  }

  const tasks = publications.map(async (pub, idx) => {
    const key = pub?.publication_id || pub?.__global_index || idx
    const rawDataUrl = pub?.media?.dataUrl || pub?.dataUrl
    if (typeof rawDataUrl === 'string' && rawDataUrl.startsWith('data:image/')) {
      map.set(key, rawDataUrl)
      return
    }

    const rawUrl = pub?.media?.url || pub?.image_url || pub?.photo_url
    if (!rawUrl || typeof rawUrl !== 'string') return
    if (rawUrl.startsWith('data:image/')) {
      map.set(key, rawUrl)
      return
    }

    try {
      let blob = null
      if (rawUrl.startsWith('/api/plan/media/files/')) {
        try {
          const { fetchPlanMediaBlob } = await import('../api/enrichmentService.js')
          blob = await fetchPlanMediaBlob(rawUrl)
        } catch {
          blob = null
        }
      }
      if (!blob) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3500)
        const res = await fetch(rawUrl, { signal: controller.signal })
        clearTimeout(timer)
        if (res.ok) {
          blob = await res.blob()
        }
      }
      if (blob && (blob.type.startsWith('image/') || !blob.type)) {
        const dataUrl = await blobToCompatibleImageDataUrl(blob)
        if (dataUrl) {
          map.set(key, dataUrl)
        }
      }
    } catch {
      // Игнорируем сетевые сбои при загрузке отдельных картинок
    }
  })

  await Promise.allSettled(tasks)
  return map
}

function buildPublicationDetailCard(pub, index, imageMap, stage2Match = null) {
  const metrics = resolvePostMlMetrics(pub, stage2Match)
  const platform = String(pub.platform || '—').toUpperCase()
  const format = String(pub.format || 'текст')
  const objective = String(pub.objective || '—')
  const tone = String(pub.tone || 'экспертный')
  const topic = String(pub.topic || 'Без темы')
  const fullText = String(pub.summary || pub.text || pub.content || 'Текст публикации не сформирован')
  const keyMessage = String(pub.key_message || '—')
  const cta = String(pub.cta || '—')
  const status = String(pub.status || 'черновик')
  const postUrl = typeof pub.post_url === 'string' && pub.post_url.trim() ? pub.post_url.trim() : null
  const mediaPrompt = String(pub.media_prompt || pub.media?.prompt || '').trim()
  const mediaKind =
    pub.media?.kind ||
    (format === 'video' ? 'video' : format === 'image' || format === 'combined' ? 'image' : null)
  const isVideo = mediaKind === 'video' || format === 'video'
  const postKey = pub.publication_id || pub.__global_index || index
  const imageDataUrl = imageMap?.get(postKey) || null
  const isImage = !isVideo && (mediaKind === 'image' || format === 'image' || format === 'combined' || !!imageDataUrl)

  let platformColor = '#1e40af'
  if (platform === 'VK') platformColor = '#0077ff'
  else if (platform === 'TELEGRAM') platformColor = '#0284c7'
  else if (platform === 'LINKEDIN') platformColor = '#0369a1'
  else if (platform === 'INSTAGRAM') platformColor = '#b91c1c'

  let mediaBlock
  if (isImage) {
    const mediaStack = [
      { text: '[ИЗОБРАЖЕНИЕ К ПУБЛИКАЦИИ]', bold: true, fontSize: 7.5, color: '#0f172a', margin: [0, 0, 0, 3] }
    ]
    if (imageDataUrl) {
      mediaStack.push({
        image: imageDataUrl,
        fit: [260, 150],
        alignment: 'center',
        margin: [0, 2, 0, 4]
      })
    } else {
      mediaStack.push({
        text: 'Файл изображения: ожидает генерации или загрузки',
        italics: true,
        fontSize: 7,
        color: '#64748b',
        margin: [0, 2, 0, 3]
      })
    }
    if (mediaPrompt) {
      mediaStack.push({
        text: [
          { text: 'Промпт генерации: ', bold: true, fontSize: 6.8, color: '#475569' },
          { text: mediaPrompt, fontSize: 6.8, color: '#475569' }
        ],
        margin: [0, 2, 0, 2]
      })
    }
    if (pub.media?.url) {
      mediaStack.push({
        text: [
          { text: 'Файл: ', bold: true, fontSize: 6.5, color: '#64748b' },
          { text: pub.media.file_name || pub.media.url, fontSize: 6.5, color: '#64748b' }
        ],
        margin: [0, 1, 0, 0]
      })
    }
    mediaBlock = {
      table: {
        widths: ['*'],
        body: [[
          {
            fillColor: '#f8fafc',
            border: [true, true, true, true],
            borderColor: ['#e2e8f0', '#e2e8f0', '#e2e8f0', '#e2e8f0'],
            padding: [6, 5, 6, 5],
            stack: mediaStack
          }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 5]
    }
  } else if (isVideo) {
    const videoStack = [
      { text: '[ВИДЕОМАТЕРИАЛ]', bold: true, fontSize: 8, color: '#1d4ed8', margin: [0, 0, 0, 2] }
    ]
    if (pub.media?.url || postUrl) {
      const videoHref = pub.media?.url || postUrl
      videoStack.push({
        text: 'Смотреть / скачать видеофайл (онлайн-ссылка)',
        link: videoHref,
        color: '#2563eb',
        decoration: 'underline',
        fontSize: 7.5,
        bold: true,
        margin: [0, 2, 0, 3]
      })
    }
    videoStack.push({
      text: `Параметры: ${pub.media?.aspect_ratio || (platform === 'LINKEDIN' ? '16:9' : '9:16')} | Формат: ${format}`,
      fontSize: 7,
      color: '#475569',
      margin: [0, 1, 0, 2]
    })
    if (mediaPrompt) {
      videoStack.push({
        text: [
          { text: 'Сценарий / Промпт: ', bold: true, fontSize: 6.8, color: '#1e3a8a' },
          { text: mediaPrompt, fontSize: 6.8, color: '#334155' }
        ],
        margin: [0, 2, 0, 2]
      })
    }
    videoStack.push({
      text: 'Примечание: видеоконтент воспроизводится онлайн по указанной ссылке',
      italics: true,
      fontSize: 6.5,
      color: '#64748b',
      margin: [0, 2, 0, 0]
    })

    mediaBlock = {
      table: {
        widths: ['*'],
        body: [[
          {
            fillColor: '#eff6ff',
            border: [true, true, true, true],
            borderColor: ['#bfdbfe', '#bfdbfe', '#bfdbfe', '#bfdbfe'],
            padding: [6, 5, 6, 5],
            stack: videoStack
          }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 5]
    }
  } else {
    mediaBlock = {
      table: {
        widths: ['*'],
        body: [[
          {
            fillColor: '#f8fafc',
            border: [true, true, true, true],
            borderColor: ['#e2e8f0', '#e2e8f0', '#e2e8f0', '#e2e8f0'],
            padding: [5, 4, 5, 4],
            text: 'Формат: Текстовый пост (медиа не предусмотрено)',
            fontSize: 7,
            color: '#64748b'
          }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 5]
    }
  }

  const kpiStack = [
    { text: 'Прогнозные показатели (ML / KPI):', bold: true, fontSize: 7.2, color: '#0f172a' },
    {
      text: `Вовлечённость: ${formatPercent(pub.expected_kpi?.engagement_rate)} | Конверсия: ${formatPercent(pub.expected_kpi?.conversion_potential)} | Охват: ${formatPercent(pub.expected_kpi?.reach_potential)}`,
      fontSize: 7,
      color: '#334155',
      margin: [0, 2, 0, 2]
    },
    {
      text: `Прогноз ML: Лайки: ${metrics.likes != null ? Math.round(metrics.likes) : '—'} | Репосты: ${metrics.shares != null ? Math.round(metrics.shares) : '—'} | Просмотры: ${metrics.views != null ? Math.round(metrics.views) : '—'}`,
      fontSize: 7,
      bold: true,
      color: '#1d4ed8'
    }
  ]
  if (pub.actual_kpi) {
    kpiStack.push({
      text: `Факт: Лайки: ${pub.actual_kpi.likes ?? '—'} | Репосты: ${pub.actual_kpi.shares ?? '—'} | Просмотры: ${pub.actual_kpi.views ?? '—'} | ER: ${pub.actual_kpi.er_percent ?? '—'}%`,
      fontSize: 7,
      bold: true,
      color: '#15803d',
      margin: [0, 2, 0, 0]
    })
  }

  const kpiBlock = {
    table: {
      widths: ['*'],
      body: [[
        {
          fillColor: '#f8fafc',
          border: [true, true, true, true],
          borderColor: ['#e2e8f0', '#e2e8f0', '#e2e8f0', '#e2e8f0'],
          padding: [5, 4, 5, 4],
          stack: kpiStack
        }
      ]]
    },
    layout: 'noBorders'
  }

  const leftStack = [
    {
      text: [
        { text: 'Ключевое сообщение: ', bold: true, fontSize: 7.5, color: '#334155' },
        { text: keyMessage, fontSize: 7.5, color: '#0f172a' }
      ],
      margin: [0, 0, 0, 3]
    },
    {
      text: 'Полный текст публикации:',
      bold: true,
      fontSize: 7.8,
      color: '#1e40af',
      margin: [0, 2, 0, 2]
    },
    {
      table: {
        widths: ['*'],
        body: [[
          {
            fillColor: '#fbfcfd',
            border: [true, true, true, true],
            borderColor: ['#e2e8f0', '#e2e8f0', '#e2e8f0', '#e2e8f0'],
            padding: [6, 5, 6, 5],
            text: fullText,
            fontSize: 7.5,
            lineHeight: 1.25,
            color: '#1e293b'
          }
        ]]
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 4]
    },
    {
      text: [
        { text: 'Призыв к действию (CTA): ', bold: true, fontSize: 7.2, color: '#334155' },
        { text: cta, fontSize: 7.2, color: '#0f172a' }
      ],
      margin: [0, 0, 0, 3]
    },
    {
      columns: [
        {
          text: [
            { text: 'Тон: ', bold: true, fontSize: 7, color: '#475569' },
            { text: tone, fontSize: 7, color: '#1e293b' }
          ]
        },
        {
          text: [
            { text: 'Статус: ', bold: true, fontSize: 7, color: '#475569' },
            { text: status, fontSize: 7, color: '#1e293b' }
          ]
        },
        ...(postUrl ? [
          {
            text: 'Ссылка на публикацию',
            link: postUrl,
            fontSize: 7,
            color: '#2563eb',
            decoration: 'underline',
            alignment: 'right'
          }
        ] : [])
      ],
      margin: [0, 2, 0, 0]
    }
  ]

  return {
    unbreakable: true,
    margin: [0, 0, 0, 10],
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: '#f1f5f9',
            border: [true, true, true, false],
            borderColor: ['#cbd5e1', '#cbd5e1', '#cbd5e1', '#cbd5e1'],
            padding: [8, 5, 8, 5],
            columns: [
              {
                text: [
                  { text: `№ ${index + 1}  `, bold: true, color: platformColor, fontSize: 9.5 },
                  { text: `[${platform}] `, bold: true, color: platformColor, fontSize: 8.5 },
                  { text: topic, bold: true, fontSize: 9, color: '#0f172a' }
                ]
              },
              {
                text: `Дата: ${pub.planned_date || '—'} | Формат: ${format} | Цель: ${objective}`,
                alignment: 'right',
                fontSize: 7.5,
                color: '#475569'
              }
            ]
          }
        ],
        [
          {
            fillColor: '#ffffff',
            border: [true, false, true, true],
            borderColor: ['#cbd5e1', '#cbd5e1', '#cbd5e1', '#cbd5e1'],
            padding: [8, 6, 8, 6],
            columns: [
              { width: '60%', stack: leftStack },
              { width: '40%', stack: [mediaBlock, kpiBlock], margin: [10, 0, 0, 0] }
            ]
          }
        ]
      ]
    },
    layout: 'noBorders'
  }
}

/**
 * Скачивает контент-план в PDF (с поддержкой кириллицы через Roboto)
 * @param {Object} contentPlan
 * @param {Object} [options] — { filename?, isOptimized?, optimizationMeta? }
 */
export async function exportToPdf(contentPlan, options = {}) {
  const pdfMake = await loadPdfMake()
  const { filename, isOptimized, optimizationMeta = null } =
    typeof options === 'string' ? { filename: options } : options
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const imageMap = await preloadPublicationImages(pubs)
  const resolveStage2 = buildStage2PublicationResolver(optimizationMeta)
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

      const monthPosts = month.days
        .flatMap((day) =>
          (Array.isArray(day?.publications) ? day.publications : []).map((post) => ({
            post,
            stage2: resolveStage2(post, post?.__global_index)
          }))
        )

      const detailCards = monthPosts.map(({ post, stage2 }, postIdx) =>
        buildPublicationDetailCard(post, post.__global_index ?? postIdx, imageMap, stage2)
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
          },
          ...(detailCards.length > 0
            ? [
                {
                  text: `Полные карточки публикаций (${toMonthLabel(monthKey)})`,
                  style: 'sectionTitle',
                  pageBreak: 'before',
                  margin: [0, 4, 0, 8]
                },
                ...detailCards
              ]
            : [])
        ]
      })
    })

    const unassignedPosts = pubs.filter((p) => !p?.planned_date)
    if (unassignedPosts.length > 0) {
      const unassignedCards = unassignedPosts.map((post, postIdx) =>
        buildPublicationDetailCard(post, post.__global_index ?? postIdx, imageMap, resolveStage2(post, postIdx))
      )
      content.push({
        pageBreak: 'before',
        stack: [
          { text: 'Дополнительные публикации (без даты)', style: 'sectionTitle', margin: [0, 4, 0, 8] },
          ...unassignedCards
        ]
      })
    }
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
      sectionTitle: { fontSize: 12, bold: true, color: '#1e40af', margin: [0, 6, 0, 8] },
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
