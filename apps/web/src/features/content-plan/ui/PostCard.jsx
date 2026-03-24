import React from 'react'

const PostCard = ({ post, showPlatformField, onEdit }) => {
  const plannedDateLabel = post.planned_date
    ? new Date(post.planned_date).toLocaleDateString('ru-RU')
    : 'Дата не указана'

  return (
    <div className="post-card">
      <div className="post-header">
        <span className="post-date">{plannedDateLabel}</span>
        <span className="post-category">{post.topic || 'Без темы'}</span>
      </div>

      <div className="post-content">
        {showPlatformField && (
          <div>
            <strong>Платформа:</strong> {post.platform || 'не указана'}
          </div>
        )}
        <div>
          <strong>Формат:</strong> {post.format || 'не указан'}
        </div>
        <div>
          <strong>Цель:</strong> {post.objective || 'не указана'}
        </div>
        <div>
          <strong>Тон:</strong> {post.tone || 'не указан'}
        </div>
        <div>
          <strong>Ключевое сообщение:</strong> {post.key_message || 'не задано'}
        </div>
        <div>
          <strong>CTA:</strong> {post.cta || 'не задано'}
        </div>
      </div>

      {post.expected_kpi && (
        <div className="post-metrics">
          <span>
            Вовлечённость:{' '}
            {((post.expected_kpi.engagement_rate || 0) * 100).toFixed(1)}%
            {post.expected_kpi.engagement_rate_source === 'ml_relevance_prediction' ? ' (ML)' : ''}
          </span>
          <span>
            Потенциал конверсии:{' '}
            {((post.expected_kpi.conversion_potential || 0) * 100).toFixed(1)}%
          </span>
          <span>
            Потенциал охвата:{' '}
            {((post.expected_kpi.reach_potential || 0) * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {onEdit && (
        <div className="post-edit-actions">
          <button type="button" className="secondary-btn post-edit-btn" onClick={onEdit}>
            Редактировать
          </button>
        </div>
      )}
    </div>
  )
}

export default PostCard

