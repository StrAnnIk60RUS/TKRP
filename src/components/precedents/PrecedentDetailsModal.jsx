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
            <p>
              <strong>Релевантность:</strong> {formatPercent(item.score)}
            </p>
            <p>
              <strong>Источник:</strong> {subtitle}
            </p>
            <p>
              <strong>Retrieval:</strong> {prettyRetrievalType(retrieval)}
              {retrieval?.embedding_model ? ` · ${retrieval.embedding_model}` : ''}
            </p>
            {Array.isArray(item.matched_tokens) && item.matched_tokens.length > 0 && (
              <p>
                <strong>Совпавшие токены:</strong> {item.matched_tokens.join(', ')}
              </p>
            )}
            {retrieval?.type === 'embedding_cosine' && (
              <p>
                <strong>Почему совпавшие токены пустые:</strong> в режиме эмбеддингов релевантность считается по
                косинусной близости, а не по совпадению слов.
              </p>
            )}
          </div>

          <div className="preview-json">
            <h4>Детали (JSON)</h4>
            <pre className="json-preview">{jsonString}</pre>
          </div>
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

