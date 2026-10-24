import React from 'react'

const OPERATION_TITLES = {
  searchingPrecedents: 'Поиск прецедентов',
  generatingPlan: 'Генерация черновика',
  optimizingPlan: 'Генетическая оптимизация',
  seedingPrecedents: 'Загрузка демо-прецедентов',
  loadingOntology: 'Загрузка онтологии',
  exportingOntology: 'Экспорт онтологии'
}

const STATUS_LABELS = {
  idle: 'Ожидает',
  running: 'Выполняется',
  success: 'Успешно',
  error: 'Ошибка',
  cancelled: 'Отменено'
}

const TELEMETRY_LABELS_RU = {
  idle: 'ожидание',
  running: 'выполняется',
  success: 'готово',
  error: 'ошибка'
}

const formatDuration = (ms) => {
  if (!ms) return '0s'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const OperationStatusPanel = ({ operations, telemetry, onCancel, onRetry, isAnalyst = false, isDeveloper = false }) => {
  const isDetailed = Boolean(isAnalyst || isDeveloper);
  const entries = Object.entries(operations).filter(([id]) => OPERATION_TITLES[id])
  const hasVisible = entries.some(([, op]) => op.status !== 'idle')
  const hasRunning = entries.some(([, op]) => op.status === 'running')

  if (!hasVisible) return null

  return (
    <section
      className={`form-section precedent-workflow-section operation-status-panel ${
        hasRunning ? 'operation-status-panel-running' : ''
      }`}
      aria-live="polite"
    >
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">{isDetailed ? 'Статус конвейера (телеметрия)' : 'Статус операций'}</h2>
          <p className="workflow-section-subtitle">
            {isDetailed
              ? 'Отслеживание долгих операций: статус, длительность, попытки, отмена и повтор.'
              : 'Показывает прогресс долгих действий: выполнение, ошибки и повторный запуск.'}
          </p>
        </div>
      </div>

      <div className="workflow-overview-grid">
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">Сервер</span>
            <strong className="workflow-overview-value">
              {TELEMETRY_LABELS_RU[telemetry.backend] || TELEMETRY_LABELS_RU.idle}
            </strong>
          </div>
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">Обработка данных</span>
            <strong className="workflow-overview-value">
              {TELEMETRY_LABELS_RU[telemetry.python] || TELEMETRY_LABELS_RU.idle}
            </strong>
          </div>
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">Генерация текста</span>
            <strong className="workflow-overview-value">
              {TELEMETRY_LABELS_RU[telemetry.llm] || TELEMETRY_LABELS_RU.idle}
            </strong>
          </div>
        </div>

      <div className="workflow-checklist">
        {entries.map(([id, op]) => (
          <div key={id} className="workflow-checklist-item">
            <span className="workflow-checklist-mark">•</span>
            <span>
              {OPERATION_TITLES[id]}: {STATUS_LABELS[op.status]} | попытка {op.attempt || 0} |{' '}
              {formatDuration(op.durationMs)}
              {op.error ? ` | ${op.error}` : ''}
            </span>
            {op.status === 'running' && (
              <button type="button" className="submit-button secondary" onClick={() => onCancel(id)}>
                <span>Отменить</span>
              </button>
            )}
            {op.status === 'error' || op.status === 'cancelled' ? (
              <button type="button" className="submit-button secondary" onClick={() => onRetry(id)}>
                <span>Повторить</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export default OperationStatusPanel
