import React, { useState } from 'react'

const formatNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—'
}

/**
 * Панель детальной трассировки генетической оптимизации контент-плана (Stage 1 и Stage 2),
 * включая сходимость поколений GA, декомпозицию фитнеса и Парето-стратегии.
 */
export default function OptimizationTracePanel({
  optimizationResult,
  bestPublication = null,
  isAnalyst = false,
  isDeveloper = false
}) {
  const isDetailed = Boolean(isAnalyst || isDeveloper)
  const [isExpanded, setIsExpanded] = useState(false)
  if (!optimizationResult) return null

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
    <div
      className="optimization-trace-panel"
      style={{
        marginTop: '1rem',
        padding: '0.85rem 1rem',
        background: '#f8fafc',
        borderRadius: '6px',
        border: '1px solid #cbd5e1'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer'
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span style={{ fontWeight: 600, fontSize: '0.92rem', color: '#0f172a' }}>
          {isDetailed ? '📊 Трассировка генетической оптимизации и сходимости (GA Trace)' : '📊 Детали работы генетического оптимизатора'}
        </span>
        <button
          type="button"
          className="action-btn"
          style={{ padding: '3px 10px', fontSize: '0.8rem', background: '#e2e8f0', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        >
          {isExpanded ? 'Скрыть трассировку' : 'Показать трассировку'}
        </button>
      </div>

      {isExpanded && (
        <div style={{ marginTop: '0.9rem', fontSize: '0.85rem', color: '#334155', lineHeight: 1.6 }}>
          {/* График сходимости поколений */}
          {history.length > 1 && (
            <div style={{ marginBottom: '1rem', background: '#ffffff', padding: '10px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ color: '#0f172a', fontSize: '0.85rem' }}>Кривая сходимости фитнеса по поколениям:</strong>
                <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', gap: '12px' }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 3, background: '#2563eb', marginRight: 4, verticalAlign: 'middle' }}></span>Лучший фитнес</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 3, background: '#94a3b8', marginRight: 4, verticalAlign: 'middle' }}></span>Средний по популяции</span>
                </div>
              </div>
              <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: 'auto', maxHeight: '130px', overflow: 'visible' }}>
                <line x1={padding.left} y1={padding.top} x2={padding.left + innerWidth} y2={padding.top} stroke="#f1f5f9" strokeDasharray="3 3" />
                <line x1={padding.left} y1={padding.top + innerHeight / 2} x2={padding.left + innerWidth} y2={padding.top + innerHeight / 2} stroke="#f1f5f9" strokeDasharray="3 3" />
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
          <div style={{ marginBottom: '0.75rem' }}>
            <strong style={{ color: '#0f172a' }}>Этап 1: Эволюция структуры плана (Stage 1):</strong>
            <div>• Поколений выполнено: <strong>{ga1?.generations ?? '—'}</strong> (причина остановки: <em>{ga1?.stop_reason ?? 'достигнут оптимум'}</em>)</div>
            <div>• Лучший фитнес (LCB): <strong>{ga1?.best_score != null ? Number(ga1.best_score).toFixed(4) : '—'}</strong></div>
            {objectiveBreakdown && (
              <div style={{ marginTop: '4px', background: '#f1f5f9', padding: '6px 10px', borderRadius: '4px' }}>
                • <strong>Компоненты функции приспособленности:</strong>
                {' '}KPI (LCB-охват): <strong>{objectiveBreakdown.kpi != null ? Number(objectiveBreakdown.kpi).toFixed(3) : '—'}</strong>,
                {' '}Разнообразие тем и форматов: <strong>{objectiveBreakdown.diversity != null ? Number(objectiveBreakdown.diversity).toFixed(3) : '—'}</strong>,
                {' '}Ритмичность таймлайна (Cadence): <strong>{objectiveBreakdown.temporal != null ? Number(objectiveBreakdown.temporal).toFixed(3) : '—'}</strong>,
                {' '}Конверсия и CTA: <strong>{objectiveBreakdown.conversion != null ? Number(objectiveBreakdown.conversion).toFixed(3) : '—'}</strong>
              </div>
            )}
          </div>

          {/* Парето-стратегии */}
          {paretoStrategies && (
            <div style={{ marginBottom: '0.75rem', background: '#ffffff', padding: '8px 10px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
              <strong style={{ color: '#0f172a' }}>🎯 Опорные стратегии Парето-фронта (NSGA-II):</strong>
              <div style={{ marginTop: '4px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                {Object.entries(paretoStrategies).map(([key, strat]) => (
                  <div key={key} style={{ padding: '6px 8px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>{strat.title}</div>
                    <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{strat.description}</div>
                    <div style={{ marginTop: '4px', color: '#0369a1' }}>
                      Лайки: <strong>{formatNumber(strat.predictedLikes)}</strong> · Просмотры: <strong>{formatNumber(strat.predictedViews)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Этап 2: Параметры постов */}
          <div style={{ marginBottom: '0.75rem' }}>
            <strong style={{ color: '#0f172a' }}>Этап 2: Эволюция писательских решений постов (Stage 2):</strong>
            <div>• Оптимизировано публикаций: <strong>{stage2?.publications?.length ?? 0}</strong></div>
            <div>
              • Финальный ML-прогноз: <strong>{formatNumber(stage2?.predicted_total_likes)}</strong> лайков, <strong>{formatNumber(stage2?.predicted_total_views)}</strong> просмотров, <strong>{formatNumber(stage2?.predicted_total_shares)}</strong> репостов
            </div>
            {ctaDist && (
              <div>
                • Распределение CTA: <strong>{ctaDist.assigned_count ?? 0}/{ctaDist.target_count ?? 0}</strong> (целевая квота плана: {Math.round((ctaDist.target_share || 0) * 100)}%)
              </div>
            )}
            {constraintsCheck && (
              <div>
                • Проверка ограничений: <strong>{constraintsCheck.valid ? 'все ограничения выполнены' : 'скорректированы'}</strong>
                {constraintsCheck.repairs?.length ? ` (исправлений: ${constraintsCheck.repairs.length})` : ''}
              </div>
            )}
          </div>

          {bestPublication && (
            <div style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: '#0f172a' }}>Лидирующая публикация:</strong>
              <div>• ID: {bestPublication.publication_id || '—'} ({bestPublication.format || 'text'}, {bestPublication.platform || '—'})</div>
            </div>
          )}

          {stage3?.phase && (
            <div>
              <strong style={{ color: '#0f172a' }}>Этап 3:</strong> Семантическая диверсификация ({stage3.phase})
            </div>
          )}
        </div>
      )}
    </div>
  )
}
