/**
 * Экспорт контент-плана в форматы для SMM-специалистов: Excel (XLSX), PDF.
 * @module contentPlanExport
 */

import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const formatPercent = (v) => ((Number(v) || 0) * 100).toFixed(1) + '%'

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

/** Кэш base64 шрифта Roboto для кириллицы */
let robotoBase64Cache = null

async function loadRobotoFont() {
  if (robotoBase64Cache) return robotoBase64Cache
  try {
    const res = await fetch('/fonts/Roboto-Regular.ttf')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const dataUrl = reader.result
        resolve(typeof dataUrl === 'string' ? dataUrl.split(',')[1] : '')
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    robotoBase64Cache = base64
    return base64
  } catch (err) {
    console.warn('Не удалось загрузить шрифт Roboto для PDF, кириллица может отображаться некорректно:', err)
    return null
  }
}

function applyCyrillicFont(doc, base64) {
  if (!base64) return
  try {
    doc.addFileToVFS('Roboto-Regular.ttf', base64)
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
    doc.setFont('Roboto', 'normal')
  } catch (err) {
    console.warn('Ошибка применения шрифта Roboto:', err)
  }
}

/**
 * Подготавливает строки публикаций для экспорта
 * @param {Array} publications
 * @returns {Array<Object>}
 */
const COLUMN_KEYS = [
  '№', 'Дата', 'Платформа', 'Тема', 'Формат', 'Цель',
  'Ключевое сообщение', 'CTA', 'Тон', 'Вовлечённость %', 'Конверсия %', 'Охват %'
]

function buildPublicationRows(publications) {
  return (publications || []).map((pub, idx) => ({
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
    [COLUMN_KEYS[11]]: formatPercent(pub.expected_kpi?.reach_potential)
  }))
}

/**
 * Скачивает контент-план в Excel (XLSX)
 * @param {Object} contentPlan — план с publications
 * @param {string} [filename] — имя файла без расширения
 */
export function exportToExcel(contentPlan, filename) {
  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const rows = buildPublicationRows(pubs)

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

  const params = contentPlan?.planning_horizon
    ? [
        ['Параметр', 'Значение'],
        ...(displayName ? [['Название плана', displayName]] : []),
        ['Период', `${contentPlan.planning_horizon.start_date || '—'} — ${contentPlan.planning_horizon.end_date || '—'}`],
        ['Платформы', Array.isArray(contentPlan.platforms) ? contentPlan.platforms.join(', ').toUpperCase() : '—'],
        ['Всего публикаций', String(pubs.length)]
      ]
    : displayName
      ? [
          ['Параметр', 'Значение'],
          ['Название плана', displayName],
          ['Всего публикаций', String(pubs.length)]
        ]
      : [['Нет данных']]

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
  const { filename, isOptimized } = typeof options === 'string' ? { filename: options } : options
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const fontBase64 = await loadRobotoFont()
  applyCyrillicFont(doc, fontBase64)

  const pubs = Array.isArray(contentPlan?.publications) ? contentPlan.publications : []
  const rows = buildPublicationRows(pubs)

  const pdfTitleName =
    typeof contentPlan?.display_name === 'string' && contentPlan.display_name.trim()
      ? contentPlan.display_name.trim()
      : null

  doc.setFontSize(14)
  const headline = isOptimized ? 'Оптимизированный контент-план' : 'Контент-план'
  doc.text(pdfTitleName ? `${headline}: ${pdfTitleName}` : headline, 14, 12)
  doc.setFontSize(10)
  const period =
    contentPlan?.planning_horizon?.start_date && contentPlan?.planning_horizon?.end_date
      ? `${contentPlan.planning_horizon.start_date} — ${contentPlan.planning_horizon.end_date}`
      : '—'
  doc.text(`Период: ${period} | Публикаций: ${pubs.length}`, 14, 18)

  const head = rows.length ? COLUMN_KEYS : ['Статус']
  const body = rows.length ? rows.map((r) => Object.values(r)) : [['В плане пока нет публикаций']]

  const tableStyles = { fontSize: 8 }
  if (fontBase64) {
    tableStyles.font = 'Roboto'
    tableStyles.fontStyle = 'normal'
  }

  autoTable(doc, {
    head: [head],
    body,
    startY: 24,
    styles: tableStyles,
    headStyles: { fillColor: [66, 139, 202], font: tableStyles.font || undefined, fontStyle: 'normal' }
  })

  const base = filename ?? `content_plan_${new Date().toISOString().split('T')[0]}`
  doc.save(`${base}.pdf`)
}
