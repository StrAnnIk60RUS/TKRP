import React from 'react'

const formatDate = (value) => {
  if (!value) return 'Дата неизвестна'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU')
}

const buildDiffSummary = (item, currentSummary) => {
  if (!currentSummary) return []

  const diffs = []
  const publicationDelta = (item.summary?.publications_count || 0) - (currentSummary.publications_count || 0)
  if (publicationDelta !== 0) {
    diffs.push(`${publicationDelta > 0 ? '+' : ''}${publicationDelta} публикаций`)
  }

  const currentPlatforms = (currentSummary.platforms || []).join(', ')
  const itemPlatforms = (item.summary?.platforms || []).join(', ')
  if (currentPlatforms !== itemPlatforms) {
    diffs.push(`платформы: ${itemPlatforms || 'не указаны'}`)
  }

  if (
    item.summary?.start_date !== currentSummary.start_date ||
    item.summary?.end_date !== currentSummary.end_date
  ) {
    diffs.push(`период: ${item.summary?.start_date || '—'} - ${item.summary?.end_date || '—'}`)
  }

  if (item.summary?.optimization_valid !== currentSummary.optimization_valid) {
    diffs.push(
      `ограничения: ${
        item.summary?.optimization_valid === null
          ? 'без проверки'
          : item.summary?.optimization_valid
          ? 'OK'
          : 'есть нарушения'
      }`
    )
  }

  return diffs
}

const PlanHistoryPanel = ({ history, onLoad, currentPlanId, currentPlanType, currentSummary }) => {
  if (!Array.isArray(history) || history.length === 0) {
    return (
      <section className="plan-section">
        <h2 className="section-title">История планов</h2>
        <div className="empty-state">
          <p>История пока пуста. После генерации или оптимизации здесь появятся сохраненные версии.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="plan-section">
      <div className="plan-history-header">
        <div>
          <h2 className="section-title">История планов</h2>
          <p className="plan-history-subtitle">
            Быстро переключайтесь между сохранёнными версиями и сравнивайте их с текущим состоянием.
          </p>
        </div>
      </div>
      <div className="precedent-cards">
        {history.map((item) => {
          const isCurrent = item.id === currentPlanId && item.type === currentPlanType
          const diffs = buildDiffSummary(item, currentSummary)

          return (
            <div
              key={`${item.id}-${item.type}-${item.saved_at}`}
              className={`precedent-card plan-history-card ${isCurrent ? 'is-current' : ''}`}
            >
              <div className="precedent-card-header">
                <span className="precedent-card-title">{item.summary?.plan_id || item.id}</span>
                <span className="precedent-card-score">{item.type === 'optimized' ? 'optimized' : 'draft'}</span>
              </div>
              <div className="precedent-card-body">
                <div>Сохранен: {formatDate(item.saved_at)}</div>
                <div>Публикаций: {item.summary?.publications_count || 0}</div>
                <div>Платформы: {(item.summary?.platforms || []).join(', ') || 'не указаны'}</div>
                <div>
                  Период: {item.summary?.start_date || '—'} - {item.summary?.end_date || '—'}
                </div>
                <div>
                  Budget: {item.summary?.total_budget ?? '—'}; max/post:{' '}
                  {item.summary?.max_cost_per_publication ?? '—'}
                </div>
              </div>

              {isCurrent && <div className="plan-history-current-badge">Текущая версия</div>}

              {!isCurrent && diffs.length > 0 && (
                <div className="plan-history-diff">
                  <strong>Отличия от текущей версии:</strong> {diffs.join(' • ')}
                </div>
              )}

              <button
                type="button"
                className="secondary-btn"
                onClick={() => onLoad(item.id, item.type, item.saved_at)}
              >
                {isCurrent ? 'Открыта сейчас' : 'Загрузить'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default PlanHistoryPanel
