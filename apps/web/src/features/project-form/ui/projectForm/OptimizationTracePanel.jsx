import React, { useState } from 'react'
import './OptimizationTracePanel.css'

const formatNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—'
}

const formatStopReason = (reason) => {
  if (!reason) return 'достигнут оптимум'
  if (reason === 'stagnation') return 'стабилизация (популяция сошлась к оптимуму)'
  if (reason === 'max_generations') return 'достигнут лимит поколений'
  return String(reason)
}

/**
 * Панель детальной трассировки генетической оптимизации контент-плана (Stage 1 и Stage 2),
 * включая сходимость поколений GA, декомпозицию фитнеса и Парето-стратегии.
 * Доступна исключительно аналитикам и разработчикам.
 */
export default function OptimizationTracePanel({
  optimizationResult,
  bestPublication = null,
  isAnalyst = false,
  isDeveloper = false
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Блок строго скрыт для обычных SMM-пользователей и отображается только аналитикам
  if (!optimizationResult || (!isAnalyst && !isDeveloper)) {
    return null
  }

  const stage1 = optimizationResult?.stage1
  const stage2 = optimizationResult?.stage2
  const stage3 = optimizationResult?.stage3
  const ga1 = stage1?.ga
  const history = Array.isArray(ga1?.history) ? ga1.history : []
  const objectiveBreakdown =
    ga1?.best_meta?.objective_breakdown ||
    stage1?.objective_breakdown ||
    null
  const constraintsCheck = stage2?.constraints_check
  const ctaDist = stage2?.cta_distribution
  const paretoStrategies = optimizationResult?.pareto_strategies || stage1?.pareto_strategies || null

  // Расчёт точек для SVG-графика сходимости фитнеса
  const chartWidth = 520
  const chartHeight = 120
  const padding = { top: 12, right: 16, bottom: 24, left: 40 }
  const innerWidth = chartWidth - padding.left - padding.right
  const innerHeight = chartHeight - padding.top - padding.bottom

  let svgPathBest = ''
  let svgPathAvg = ''
  let minScore = 0
  let maxScore = 1

  if (history.length > 1) {
    const scores = history.map((h) => Number(h.best_score) || 0)
    const avgScores = history.map((h) => Number(h.generation_avg_score) || 0)
    minScore = Math.max(0, Math.min(...scores, ...avgScores) * 0.9)
    maxScore = Math.min(1, Math.max(...scores, ...avgScores) * 1.1 || 1)
    const scoreRange = Math.max(0.001, maxScore - minScore)

    const pointsBest = history.map((h, i) => {
      const x = padding.left + (i / (history.length - 1)) * innerWidth
      const y = padding.top + innerHeight - ((Number(h.best_score || 0) - minScore) / scoreRange) * innerHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    svgPathBest = `M ${pointsBest.join(' L ')}`

    const pointsAvg = history.map((h, i) => {
      const x = padding.left + (i / (history.length - 1)) * innerWidth
      const y = padding.top + innerHeight - ((Number(h.generation_avg_score || 0) - minScore) / scoreRange) * innerHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    svgPathAvg = `M ${pointsAvg.join(' L ')}`
  }

  return (
    <div className="optimization-trace-panel">
      <div
        className="trace-header"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
      >
        <span className="trace-title">
          📊 Аналитика генетического алгоритма (GA Trace)
        </span>
        <button
          type="button"
          className="trace-toggle-btn"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        >
          {isExpanded ? 'Скрыть трассировку' : 'Показать трассировку'}
        </button>
      </div>

      {isExpanded && (
        <div className="trace-content">
          {/* График сходимости поколений */}
          {history.length > 1 && (
            <div className="trace-chart-card">
              <div className="trace-chart-header">
                <strong className="trace-chart-title">Кривая сходимости фитнеса по поколениям:</strong>
                <div className="trace-chart-legend">
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 3, background: '#2563eb', marginRight: 4, verticalAlign: 'middle' }}></span>
                    Лучший фитнес
                  </span>
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 3, background: '#94a3b8', marginRight: 4, verticalAlign: 'middle' }}></span>
                    Средний по популяции
                  </span>
                </div>
              </div>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="trace-chart-svg">
                <line x1={padding.left} y1={padding.top} x2={padding.left + innerWidth} y2={padding.top} stroke="#cbd5e1" strokeDasharray="3 3" opacity="0.6" />
                <line x1={padding.left} y1={padding.top + innerHeight / 2} x2={padding.left + innerWidth} y2={padding.top + innerHeight / 2} stroke="#cbd5e1" strokeDasharray="3 3" opacity="0.6" />
                <line x1={padding.left} y1={padding.top + innerHeight} x2={padding.left + innerWidth} y2={padding.top + innerHeight} stroke="#cbd5e1" strokeWidth="1.5" />
                
                <text x={padding.left - 6} y={padding.top + 4} textAnchor="end" fontSize="9" fill="#94a3b8">{maxScore.toFixed(2)}</text>
                <text x={padding.left - 6} y={padding.top + innerHeight} textAnchor="end" fontSize="9" fill="#94a3b8">{minScore.toFixed(2)}</text>
                <text x={padding.left} y={chartHeight - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">Поколение 1</text>
                <text x={padding.left + innerWidth} y={chartHeight - 4} textAnchor="end" fontSize="9" fill="#94a3b8">Поколение {history.length}</text>

                <path d={svgPathAvg} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 2" />
                <path d={svgPathBest} fill="none" stroke="#2563eb" strokeWidth="2.5" />
              </svg>
            </div>
          )}

          {/* Этап 1: Структурная эволюция */}
          <div className="trace-section">
            <span className="trace-section-title">Этап 1: Оптимизация структуры плана (Stage 1)</span>
            <div>• Поколений выполнено: <strong>{ga1?.generations ?? '—'}</strong> (причина остановки: <em>{formatStopReason(ga1?.stop_reason)}</em>)</div>
            <div>• Итоговая комплексная оценка плана (LCB): <strong>{ga1?.best_score != null ? Number(ga1.best_score).toFixed(4) : '—'}</strong></div>
            <div className="trace-hint">• LCB (Lower Confidence Bound) — консервативная оценка с поправкой на неопределённость прогноза.</div>
            {objectiveBreakdown && (
              <div className="trace-breakdown-box">
                <div><strong>Декомпозиция критериев оптимизации плана:</strong></div>
                <div>• Прогноз вовлеченности (LCB-охват): <strong>{objectiveBreakdown.kpi != null ? Number(objectiveBreakdown.kpi).toFixed(3) : '—'}</strong></div>
                <div>• Разнообразие тем и форматов: <strong>{objectiveBreakdown.diversity != null ? Number(objectiveBreakdown.diversity).toFixed(3) : '—'}</strong></div>
                <div>• Ритмичность графика публикаций: <strong>{objectiveBreakdown.temporal != null ? Number(objectiveBreakdown.temporal).toFixed(3) : '—'}</strong></div>
                <div>• Конверсионный потенциал и CTA: <strong>{objectiveBreakdown.conversion != null ? Number(objectiveBreakdown.conversion).toFixed(3) : '—'}</strong></div>
              </div>
            )}
          </div>

          {/* Парето-стратегии */}
          {paretoStrategies && (
            <div className="trace-pareto-card">
              <span className="trace-section-title">🎯 Опорные стратегии Парето-фронта (NSGA-II):</span>
              <div className="trace-hint">Многокритериальная оптимизация выделила варианты с разным балансом охвата и конверсии:</div>
              <div className="trace-pareto-grid">
                {Object.entries(paretoStrategies).map(([key, strat]) => (
                  <div key={key} className="trace-pareto-item">
                    <div className="trace-pareto-item-title">{strat.title}</div>
                    <div className="trace-pareto-item-desc">{strat.description}</div>
                    <div className="trace-pareto-item-metrics">
                      Ожидаемые реакции: <strong>{formatNumber(strat.predictedLikes)}</strong> · Просмотры: <strong>{formatNumber(strat.predictedViews)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Этап 2: Параметры постов */}
          <div className="trace-section">
            <span className="trace-section-title">Этап 2: Тонкая настройка публикаций (Stage 2)</span>
            <div>• Оптимизировано публикаций: <strong>{stage2?.publications?.length ?? 0}</strong></div>
            <div>
              • Совокупный ML-прогноз плана: <strong>{formatNumber(stage2?.predicted_total_likes)}</strong> лайков, <strong>{formatNumber(stage2?.predicted_total_views)}</strong> просмотров, <strong>{formatNumber(stage2?.predicted_total_shares)}</strong> репостов
            </div>
            {ctaDist && (
              <div>
                • Распределение призывов к действию (CTA): <strong>{ctaDist.assigned_count ?? 0} из {ctaDist.target_count ?? 0}</strong> публикаций (целевая квота: {Math.round((ctaDist.target_share || 0) * 100)}%)
              </div>
            )}
            {constraintsCheck && (
              <div>
                • Проверка бизнес-ограничений: <strong>{constraintsCheck.valid ? 'все ограничения соблюдены' : 'скорректированы'}</strong>
                {constraintsCheck.repairs?.length ? ` (исправлений: ${constraintsCheck.repairs.length})` : ''}
              </div>
            )}
          </div>

          {bestPublication && (
            <div className="trace-section">
              <span className="trace-section-title">Лидирующая публикация по прогнозу:</span>
              <div>• Публикация ID: {bestPublication.publication_id || '—'} ({bestPublication.format || 'пост'}, {bestPublication.platform || 'соцсеть'})</div>
            </div>
          )}

          {stage3?.phase && (
            <div>
              <span className="trace-section-title">Этап 3: Семантическая диверсификация ({stage3.phase})</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
