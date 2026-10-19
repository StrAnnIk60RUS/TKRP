import React, { useState } from 'react'

const formatNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—'
}

/**
 * Панель детальной трассировки генетической оптимизации контент-плана (Stage 1 и Stage 2).
 */
export default function OptimizationTracePanel({
  optimizationResult,
  bestPublication = null,
  isDeveloper = false
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  if (!optimizationResult) return null

  const stage1 = optimizationResult?.stage1
  const stage2 = optimizationResult?.stage2
  const stage3 = optimizationResult?.stage3
  const ga1 = stage1?.ga
  const objectiveBreakdown = stage1?.objective_breakdown
  const constraintsCheck = stage2?.constraints_check
  const ctaDist = stage2?.cta_distribution

  return (
    <div
      className="optimization-trace-panel"
      style={{
        marginTop: '1rem',
        padding: '0.85rem',
        background: '#f8fafc',
        borderRadius: '6px',
        border: '1px solid #e2e8f0'
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
        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
          {isDeveloper ? 'Трассировка генетической оптимизации (GA Trace)' : 'Детали работы оптимизатора'}
        </span>
        <button
          type="button"
          className="action-btn"
          style={{ padding: '2px 8px', fontSize: '0.8rem' }}
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        >
          {isExpanded ? 'Скрыть детали' : 'Показать детали'}
        </button>
      </div>

      {isExpanded && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#334155', lineHeight: 1.6 }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong style={{ color: '#0f172a' }}>Этап 1 (Эволюция структуры плана):</strong>
            <div>• Поколений: {ga1?.generations ?? '—'} (остановка: {ga1?.stop_reason ?? 'достигнут оптимум'})</div>
            <div>• Оценка приспособленности (фитнес): {ga1?.best_score != null ? Number(ga1.best_score).toFixed(4) : '—'}</div>
            {objectiveBreakdown && (
              <div>
                • Компоненты фитнеса:
                {' '}аудитория: {objectiveBreakdown.audience_alignment != null ? Number(objectiveBreakdown.audience_alignment).toFixed(2) : '—'},
                {' '}онтология: {objectiveBreakdown.ontology_consistency != null ? Number(objectiveBreakdown.ontology_consistency).toFixed(2) : '—'},
                {' '}баланс форматов: {objectiveBreakdown.format_mix_fit != null ? Number(objectiveBreakdown.format_mix_fit).toFixed(2) : '—'}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '0.5rem' }}>
            <strong style={{ color: '#0f172a' }}>Этап 2 (Эволюция параметров постов):</strong>
            <div>• Оптимизировано публикаций: {stage2?.publications?.length ?? 0}</div>
            <div>
              • Прогноз охвата: {formatNumber(stage2?.predicted_total_likes)} лайков, {formatNumber(stage2?.predicted_total_views)} просмотров
            </div>
            {ctaDist && (
              <div>
                • Распределение CTA: {ctaDist.assigned_count ?? 0}/{ctaDist.target_count ?? 0} (целевая доля: {Math.round((ctaDist.target_share || 0) * 100)}%)
              </div>
            )}
            {constraintsCheck && (
              <div>
                • Проверка ограничений: {constraintsCheck.valid ? 'все ограничения выполнены' : 'есть корректировки'}
                {constraintsCheck.repairs?.length ? ` (исправлений: ${constraintsCheck.repairs.length})` : ''}
              </div>
            )}
          </div>

          {bestPublication && (
            <div style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: '#0f172a' }}>Лучшая публикация:</strong>
              <div>• ID: {bestPublication.publication_id || '—'} ({bestPublication.format || 'text'}, {bestPublication.platform || '—'})</div>
            </div>
          )}

          {stage3?.phase && (
            <div>
              <strong style={{ color: '#0f172a' }}>Этап 3:</strong> Текстовое разнообразие ({stage3.phase})
            </div>
          )}
        </div>
      )}
    </div>
  )
}
