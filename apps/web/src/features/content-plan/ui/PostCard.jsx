import React from 'react'
import {
  getCompactTopicHeading,
  getFormatLabel,
  getKpiPresentation,
  getObjectiveLabel,
  getPlatformLabel,
  getToneLabel,
  isMeaningfulCta,
  normalizePublicationForUi,
  truncateText
} from '../lib/publicationPresentation'

const getEngagementSourceLabel = (source) => {
  if (source === 'ml_post_metrics_calculated') return 'рассчитано на основе ML-прогноза'
  if (source === 'ml_relevance_prediction') return 'оценено ML-моделью'
  return 'оценка по эвристикам'
}

const getAbsoluteSourceLabel = (source) => {
  if (source === 'stage2_post_evolution') return 'этап оптимизации постов (Stage 2)'
  if (source === 'stage2_post_evolution_normalized')
    return 'этап оптимизации постов (Stage 2, нормализовано к общему прогнозу плана)'
  if (source === 'ml_post_metrics_prediction') return 'прогноз пост-метрик ML-модели'
  if (source === 'final_best_post_template') return 'итоговый шаблон лучшего поста'
  if (source === 'ga_post_metrics_model') return 'генетический отбор с ML-оценкой'
  return 'источник не указан'
}

const PostCard = ({ post, showPlatformField, onEdit }) => {
  const normalizedPost = normalizePublicationForUi(post)
  const plannedDateLabel = normalizedPost.planned_date
    ? new Date(normalizedPost.planned_date).toLocaleDateString('ru-RU')
    : 'Дата не указана'
  const fullHeading = normalizedPost.title || normalizedPost.topic || 'Без темы'
  const postHeading = getCompactTopicHeading(fullHeading) || fullHeading
  const showFullHeadingTooltip = fullHeading !== postHeading
  const summaryPreview = truncateText(normalizedPost.summary, 320)
  const hasMeaningfulCta = isMeaningfulCta(normalizedPost.cta)
  const kpi = getKpiPresentation(normalizedPost.expected_kpi)
  const expectedKpi = normalizedPost.expected_kpi || {}
  const mlLikesRaw = expectedKpi.ml_predicted_likes ?? expectedKpi.predicted_likes
  const mlSharesRaw = expectedKpi.ml_predicted_shares ?? expectedKpi.predicted_shares
  const mlViewsRaw = expectedKpi.ml_predicted_views ?? expectedKpi.predicted_views
  const hasAnyMlAbsoluteMetric = mlLikesRaw != null || mlSharesRaw != null || mlViewsRaw != null
  const mlSource = expectedKpi.predicted_likes_source || 'не указан'
  const engagementSourceLabel = getEngagementSourceLabel(expectedKpi.engagement_rate_source)
  const absoluteSourceLabel = getAbsoluteSourceLabel(mlSource)

  return (
    <div className="post-card">
      <div className="post-header">
        <span className="post-date">{plannedDateLabel}</span>
        <span className="post-category" title={showFullHeadingTooltip ? fullHeading : undefined}>
          {postHeading}
        </span>
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
            Ниже показаны 2 блока: (1) ориентиры по качеству поста, (2) абсолютный прогноз результата от ML.
          </p>
          <div className="post-metrics-section">
            <div className="post-metrics-section-title">Оценки качества поста (относительные)</div>
            <ul className="post-metrics-list">
              <li title="Доля активных реакций: лайки, комментарии, взаимодействия.">
                <strong>Вовлечённость:</strong> {kpi.engagementPercent} · потенциал: {kpi.engagementBand}
              </li>
              <li title="Вероятность целевого действия: клик, заявка, регистрация, покупка.">
                <strong>Конверсия:</strong> {kpi.conversionPercent} · потенциал: {kpi.conversionBand}
              </li>
              <li title="Потенциальный объём аудитории, которая может увидеть пост.">
                <strong>Охват:</strong> {kpi.reachPercent} · потенциал: {kpi.reachBand}
              </li>
            </ul>
            <p className="post-metrics-source">Источник: {engagementSourceLabel} (часть оценок может быть эвристической).</p>
          </div>

          <div className="post-metrics-section">
            <div className="post-metrics-section-title">Прогноз результата (абсолютные значения)</div>
            <ul className="post-metrics-list post-metrics-list-absolute">
              <li>
                <strong>Лайки:</strong> {mlLikesRaw != null ? Number(mlLikesRaw).toFixed(0) : 'не получены из API'}
              </li>
              <li>
                <strong>Репосты:</strong> {mlSharesRaw != null ? Number(mlSharesRaw).toFixed(0) : 'не получены из API'}
              </li>
              <li>
                <strong>Просмотры:</strong> {mlViewsRaw != null ? Number(mlViewsRaw).toFixed(0) : 'не получены из API'}
              </li>
            </ul>
            <p className="post-metrics-source">Источник: {absoluteSourceLabel}.</p>
          </div>
          {!hasAnyMlAbsoluteMetric && (
            <span className="post-metrics-ml-counts">
              По этому посту абсолютный ML-прогноз не пришёл. Можно ориентироваться на относительные оценки выше.
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

