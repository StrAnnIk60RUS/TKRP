import React from 'react'

const OPERATION_TITLES = {
  searchingPrecedents: 'Поиск прецедентов',
  generatingPlan: 'Генерация черновика',
  optimizingPlan: 'Оптимизация GA',
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

const TELEMETRY_LABELS = {
  idle: 'idle',
  running: 'running',
  success: 'ok',
  error: 'error'
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

const OperationStatusPanel = ({ operations, telemetry, onCancel, onRetry, isDeveloper = false }) => {
  const entries = Object.entries(operations).filter(([id]) => OPERATION_TITLES[id])
  const hasVisible = entries.some(([, op]) => op.status !== 'idle')

  if (!hasVisible) return null

  return (
    <section className="form-section precedent-workflow-section" aria-live="polite">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">{isDeveloper ? 'Статус pipeline' : 'Статус операций'}</h2>
          <p className="workflow-section-subtitle">
            {isDeveloper
              ? 'Отслеживание долгих операций: статус, тайминги, попытки и управление cancel/retry.'
              : 'Показывает прогресс долгих действий: выполнение, ошибки и повторный запуск.'}
          </p>
        </div>
      </div>

      {isDeveloper && (
        <div className="workflow-overview-grid">
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">Backend</span>
            <strong className="workflow-overview-value">{TELEMETRY_LABELS[telemetry.backend] || 'idle'}</strong>
          </div>
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">Python</span>
            <strong className="workflow-overview-value">{TELEMETRY_LABELS[telemetry.python] || 'idle'}</strong>
          </div>
          <div className="workflow-overview-card">
            <span className="workflow-overview-label">LLM</span>
            <strong className="workflow-overview-value">{TELEMETRY_LABELS[telemetry.llm] || 'idle'}</strong>
          </div>
        </div>
      )}

      {!isDeveloper && (
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
      )}

      <div className="workflow-checklist">
        {entries.map(([id, op]) => (
          <div key={id} className="workflow-checklist-item">
            <span className="workflow-checklist-mark">•</span>
            <span>
              {OPERATION_TITLES[id]}: {STATUS_LABELS[op.status]} | attempt #{op.attempt || 0} |{' '}
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
