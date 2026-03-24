import React from 'react'

const formatScore = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—'
}

const renderHistory = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return <div className="workflow-result-placeholder">История поколений пока недоступна.</div>
  }

  return (
    <div className="workflow-result-list">
      {history.map((entry) => (
        <div key={`gen-${entry.generation}`}>
          Gen {entry.generation}: best {formatScore(entry.generation_best_score)} | avg {formatScore(entry.generation_avg_score)}
        </div>
      ))}
    </div>
  )
}

const OptimizationTracePanel = ({ optimizationResult }) => {
  const stage1History = optimizationResult?.stage1?.ga?.history || []
  const bestPublicationId = optimizationResult?.best_publication?.publication_id || null
  const bestPublicationTrace = bestPublicationId
    ? optimizationResult?.stage2?.publications?.find((item) => item.publication_id === bestPublicationId)?.ga?.history || []
    : []

  if (stage1History.length === 0 && bestPublicationTrace.length === 0) return null

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Trace Эволюции</h2>
          <p className="workflow-section-subtitle">
            Последовательность поколений для лучшего контент-плана и лучшего поста.
          </p>
        </div>
      </div>

      <div className="workflow-result-grid">
        <div className="workflow-result-card">
          <div className="workflow-result-header">
            <h3>Контент-план</h3>
          </div>
          {renderHistory(stage1History)}
        </div>

        <div className="workflow-result-card">
          <div className="workflow-result-header">
            <h3>Лучший пост</h3>
          </div>
          {bestPublicationId && <div className="workflow-result-list"><div>ID: {bestPublicationId}</div></div>}
          {renderHistory(bestPublicationTrace)}
        </div>
      </div>
    </section>
  )
}

export default OptimizationTracePanel
