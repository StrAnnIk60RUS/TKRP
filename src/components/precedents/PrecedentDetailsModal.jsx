import React, { useMemo } from 'react'
import '../PreviewModal.css'

function formatPercent(score) {
  return `${Math.round((Number(score) || 0) * 100)}%`
}

function prettyRetrievalType(retrieval) {
  const type = retrieval?.type
  if (type === 'embedding_cosine') return 'Semantic retrieval (эмбеддинги · cosine similarity)'
  if (type === 'token_overlap_fallback') return 'Token overlap (фолбэк)'
  return type || 'unknown'
}

const PrecedentDetailsModal = ({ item, retrieval, onClose }) => {
  const jsonString = useMemo(() => JSON.stringify(item, null, 2), [item])

  if (!item) return null

  const title =
    item.type === 'publication'
      ? item.data?.publication_model?.topic || 'Публикация-прецедент'
      : item.data?.competitor_name || item.data?.plan_id || 'Контент-план-прецедент'

  const subtitle =
    item.type === 'publication'
      ? `${item.data?.competitor_name || 'Неизвестный конкурент'} · ${item.data?.platform || 'unknown'}`
      : `${item.data?.platform || 'unknown'} · ${item.data?.content_plan_model?.total_publications || 0} публикаций`

  const summaryMetrics =
    item.type === 'publication'
      ? [
          ['Формат', item.data?.publication_model?.format || '—'],
          ['Категория', item.data?.publication_model?.content_category || '—'],
          ['Аудитория', (item.data?.publication_model?.audience_segments || []).join(', ') || 'не указана'],
          ['Почему найдено', Array.isArray(item.matched_tokens) && item.matched_tokens.length > 0 ? item.matched_tokens.join(', ') : 'semantic / без токенов']
        ]
      : [
          ['Платформа', item.data?.platform || '—'],
          ['Постов в неделю', item.data?.content_plan_model?.posting_frequency_per_week || 0],
          ['Публикаций в плане', item.data?.content_plan_model?.total_publications || 0],
          ['Аудитория', (item.data?.content_plan_model?.audience_segments || []).join(', ') || 'не указана']
        ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="preview-info">
            <div className="precedent-modal-hero">
              <div>
                <div className="precedent-modal-eyebrow">Прецедент</div>
                <h4 className="precedent-modal-title">{title}</h4>
                <p className="precedent-modal-subtitle">{subtitle}</p>
              </div>
              <div className="precedent-modal-score">{formatPercent(item.score)}</div>
            </div>

            <div className="precedent-modal-grid">
              {summaryMetrics.map(([label, value]) => (
                <div key={label} className="precedent-modal-card">
                  <span className="precedent-modal-card-label">{label}</span>
                  <strong className="precedent-modal-card-value">{value}</strong>
                </div>
              ))}
            </div>

            <div className="precedent-modal-context">
              <p>
                <strong>Retrieval:</strong> {prettyRetrievalType(retrieval)}
                {retrieval?.embedding_model ? ` · ${retrieval.embedding_model}` : ''}
              </p>
              {retrieval?.type === 'embedding_cosine' && (
                <p>
                  В режиме эмбеддингов релевантность считается по косинусной близости, поэтому список совпавших
                  токенов может быть пустым.
                </p>
              )}
            </div>
          </div>

          <details className="precedent-technical-details">
            <summary>Технические детали и JSON</summary>
            <div className="preview-json">
              {Array.isArray(item.matched_tokens) && item.matched_tokens.length > 0 && (
                <p className="precedent-technical-line">
                  <strong>Совпавшие токены:</strong> {item.matched_tokens.join(', ')}
                </p>
              )}
              <h4>Детали (JSON)</h4>
              <pre className="json-preview">{jsonString}</pre>
            </div>
          </details>
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            <span>Закрыть</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PrecedentDetailsModal

