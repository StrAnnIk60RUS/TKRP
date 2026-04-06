import React from 'react'
import {
  getFormatLabel,
  getObjectiveLabel,
  getPlatformLabel,
  getToneLabel,
  isMeaningfulCta,
  normalizePublicationForUi,
  truncateText
} from '../lib/publicationPresentation'

const PostCard = ({ post, showPlatformField, onEdit }) => {
  const normalizedPost = normalizePublicationForUi(post)
  const plannedDateLabel = normalizedPost.planned_date
    ? new Date(normalizedPost.planned_date).toLocaleDateString('ru-RU')
    : 'Дата не указана'
  const postHeading = normalizedPost.title || normalizedPost.topic || 'Без темы'
  const summaryPreview = truncateText(normalizedPost.summary, 320)
  const hasMeaningfulCta = isMeaningfulCta(normalizedPost.cta)

  return (
    <div className="post-card">
      <div className="post-header">
        <span className="post-date">{plannedDateLabel}</span>
        <span className="post-category">{postHeading}</span>
      </div>

      <div className="post-content">
        {showPlatformField && (
          <div>
            <strong>Платформа:</strong> {getPlatformLabel(normalizedPost.platform)}
          </div>
        )}
        <div>
          <strong>Формат:</strong> {getFormatLabel(normalizedPost.format)}
        </div>
        <div>
          <strong>Цель:</strong> {getObjectiveLabel(normalizedPost.objective)}
        </div>
        <div>
          <strong>Тон:</strong> {getToneLabel(normalizedPost.tone)}
        </div>
        <div>
          <strong>Ключевое сообщение:</strong> {normalizedPost.key_message || 'не задано'}
        </div>
        <div>
          <strong>Текст поста:</strong> {summaryPreview || 'не задан'}
        </div>
        {hasMeaningfulCta && (
          <div>
            <strong>CTA:</strong> {normalizedPost.cta}
          </div>
        )}
      </div>

      {normalizedPost.expected_kpi && (
        <div className="post-metrics">
          <p className="post-metrics-note">
            Ниже — внутренние оценки модели (шкала 0–100%), не фактические показатели из соцсети.
          </p>
          <span>
            Вовлечённость (оценка):{' '}
            {((normalizedPost.expected_kpi.engagement_rate || 0) * 100).toFixed(1)}%
            {normalizedPost.expected_kpi.engagement_rate_source === 'ml_relevance_prediction' ? ' (ML)' : ''}
          </span>
          <span>
            Конверсия (оценка):{' '}
            {((normalizedPost.expected_kpi.conversion_potential || 0) * 100).toFixed(1)}%
          </span>
          <span>
            Охват (оценка):{' '}
            {((normalizedPost.expected_kpi.reach_potential || 0) * 100).toFixed(1)}%
          </span>
          {normalizedPost.expected_kpi.ml_predicted_likes != null && (
            <span className="post-metrics-ml-counts">
              Прогноз ML (лайки / репосты / просмотры):{' '}
              {Number(normalizedPost.expected_kpi.ml_predicted_likes || 0).toFixed(0)} /{' '}
              {Number(normalizedPost.expected_kpi.ml_predicted_shares || 0).toFixed(0)} /{' '}
              {Number(normalizedPost.expected_kpi.ml_predicted_views || 0).toFixed(0)}
            </span>
          )}
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

