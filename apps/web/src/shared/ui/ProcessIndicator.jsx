import React from 'react'
import './ProcessIndicator.css'

/** @typedef {{ id: string; label: string; hint?: string }} ProcessItem */

/** Словарь длительных операций: id → { label, hint } */
const PROCESS_LABELS = {
  parsing: {
    label: 'Парсинг конкурентов по ссылкам',
    hint: 'Запрос к парсеру и загрузка данных. Обычно 10–60 секунд.'
  },
  enriching: {
    label: 'Обогащение данных через LLM',
    hint: 'Анализ постов. При большом объёме — до нескольких минут.'
  },
  searchingPrecedents: {
    label: 'Поиск прецедентов',
    hint: 'Семантический поиск по базе.'
  },
  seedingPrecedents: {
    label: 'Загрузка демо-базы прецедентов',
    hint: 'Импорт демо-данных.'
  },
  generatingPlan: {
    label: 'Генерация чернового контент-плана',
    hint: 'RAG + LLM. Может занять 1–3 минуты.'
  },
  optimizingPlan: {
    label: 'Эволюционная оптимизация (2 уровня ГА)',
    hint: 'Генетический алгоритм. Обычно 2–5 минут и более.'
  },
  exportingOntology: {
    label: 'Экспорт онтологии в Excel',
    hint: 'Формирование файла.'
  },
  loadingOntology: {
    label: 'Загрузка агрегированной онтологии',
    hint: 'Сбор JSON со сущностями и связями.'
  }
}

/**
 * Индикатор длительного процесса.
 * Рекомендуется рендерить внутри секции, где запущена операция (`contextual`), а не вверху страницы.
 *
 * @param {{ active: boolean; processId?: string; contextual?: boolean }} props
 */
const ProcessIndicator = ({ active, processId, contextual = false }) => {
  if (!active || !processId) return null

  const meta = PROCESS_LABELS[processId]
  if (!meta) return null

  const rootClass = ['process-indicator', contextual ? 'process-indicator--contextual' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} role="status" aria-live="polite" aria-busy="true">
      <div className="process-indicator-spinner" aria-hidden="true" />
      <div className="process-indicator-content">
        <span className="process-indicator-label">{meta.label}</span>
        {meta.hint && <span className="process-indicator-hint">{meta.hint}</span>}
      </div>
    </div>
  )
}

export default ProcessIndicator
export { PROCESS_LABELS }
