import React from 'react'
import {
  getCompactTopicHeading,
  getFormatLabel,
  getKpiPresentation,
  getMediaKind,
  getMediaPromptLabel,
  getObjectiveLabel,
  getPlatformLabel,
  getPublicationStatusLabel,
  getToneLabel,
  isMeaningfulCta,
  normalizePublicationForUi,
  truncateText
} from '../lib/publicationPresentation'
import PostMediaBlock from './PostMediaBlock'
import './PostCard.css'

const getEngagementSourceLabel = (source) => {
  if (source === 'ml_post_metrics_calculated') return 'рассчитано на основе прогноза модели'
  if (source === 'ml_relevance_prediction') return 'оценено моделью'
  return 'оценка по эвристикам'
}

const getAbsoluteSourceLabel = (source) => {
  if (source === 'stage2_post_evolution') return 'этап оптимизации постов'
  if (source === 'stage2_post_evolution_normalized')
    return 'этап оптимизации постов (приведено к общему прогнозу плана)'
  if (source === 'ml_post_metrics_prediction') return 'прогноз метрик поста моделью'
  if (source === 'final_best_post_template') return 'итоговый шаблон лучшего поста'
  if (source === 'ga_post_metrics_model') return 'генетический отбор с оценкой модели'
  return 'источник не указан'
}

const PostCard = ({ post, showPlatformField, onEdit, onPublish }) => {
  const normalizedPost = normalizePublicationForUi(post)
  const plannedDateLabel = normalizedPost.planned_date
    ? new Date(normalizedPost.planned_date).toLocaleDateString('ru-RU')
    : 'Дата не указана'
  const fullHeading = normalizedPost.title || normalizedPost.topic || 'Без темы'
  const postHeading = getCompactTopicHeading(fullHeading) || fullHeading
  const showFullHeadingTooltip = fullHeading !== postHeading
  const summaryPreview = truncateText(normalizedPost.summary, 320)
  const hasMeaningfulCta = isMeaningfulCta(normalizedPost.cta)
  const mediaKind = getMediaKind(normalizedPost.format)
  const mediaPrompt = normalizedPost.media_prompt || ''
  const kpi = getKpiPresentation(normalizedPost.expected_kpi)
  const expectedKpi = normalizedPost.expected_kpi || {}
  const mlLikesRaw = expectedKpi.ml_predicted_likes ?? expectedKpi.predicted_likes
  const mlSharesRaw = expectedKpi.ml_predicted_shares ?? expectedKpi.predicted_shares
  const mlViewsRaw = expectedKpi.ml_predicted_views ?? expectedKpi.predicted_views
  const hasAnyMlAbsoluteMetric = mlLikesRaw != null || mlSharesRaw != null || mlViewsRaw != null
  const mlSource = expectedKpi.predicted_likes_source || 'не указан'
  const engagementSourceLabel = getEngagementSourceLabel(expectedKpi.engagement_rate_source)
  const absoluteSourceLabel = getAbsoluteSourceLabel(mlSource)

  const status = normalizedPost.status || 'draft'
  const actualKpi = normalizedPost.actual_kpi

  return (
    <div className={`post-card post-card-${status}`}>
      <div className="post-header">
        <div className="post-header-meta">
          <span className="post-date">{plannedDateLabel}</span>
          <span className={`post-status-badge post-status-${status}`}>
            <span className="post-status-dot" aria-hidden="true" />
            <span>{getPublicationStatusLabel(status)}</span>
          </span>
        </div>
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
            <strong>Призыв:</strong> {normalizedPost.cta}
          </div>
        )}
        {mediaKind && (
          <div>
            <strong>{getMediaPromptLabel(normalizedPost.format)}:</strong>{' '}
            {truncateText(mediaPrompt, 280) || 'не задан'}
          </div>
        )}
      </div>

      {mediaKind && <PostMediaBlock media={normalizedPost.media} />}

      {normalizedPost.expected_kpi && (
        <div className="post-metrics">
          <p className="post-metrics-note">
            Ниже показаны 2 блока: (1) ориентиры по качеству поста, (2) прогноз результата от аналитической модели.
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
            {hasAnyMlAbsoluteMetric ? (
              <>
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
              </>
            ) : (
              <span className="post-metrics-ml-counts">
                По этому посту прогноз модели не рассчитан. Можно ориентироваться на относительные оценки выше.
              </span>
            )}
          </div>
        </div>
      )}

      {normalizedPost.post_url && (
        <div className="post-published-link-row">
          <span className="post-published-label">Опубликовано в соцсети:</span>
          <a
            href={normalizedPost.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="post-published-link"
          >
            <svg
              className="post-published-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{normalizedPost.post_url}</span>
          </a>
        </div>
      )}

      {actualKpi && (
        <div className="post-actual-kpi-block">
          <div className="post-actual-kpi-title">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            <span>Фактическая статистика поста (Факт vs Прогноз):</span>
          </div>
          <div className="post-actual-kpi-grid">
            <div className="post-actual-kpi-item">
              <span className="post-actual-kpi-name">Лайки</span>
              <span className="post-actual-kpi-val">{actualKpi.likes}</span>
              {mlLikesRaw != null && (
                <span className="post-actual-kpi-delta">
                  (прогноз: {Number(mlLikesRaw).toFixed(0)})
                </span>
              )}
            </div>
            <div className="post-actual-kpi-item">
              <span className="post-actual-kpi-name">Просмотры</span>
              <span className="post-actual-kpi-val">{actualKpi.views}</span>
              {mlViewsRaw != null && (
                <span className="post-actual-kpi-delta">
                  (прогноз: {Number(mlViewsRaw).toFixed(0)})
                </span>
              )}
            </div>
            <div className="post-actual-kpi-item">
              <span className="post-actual-kpi-name">Репосты</span>
              <span className="post-actual-kpi-val">{actualKpi.shares}</span>
              {mlSharesRaw != null && (
                <span className="post-actual-kpi-delta">
                  (прогноз: {Number(mlSharesRaw).toFixed(0)})
                </span>
              )}
            </div>
            <div className="post-actual-kpi-item">
              <span className="post-actual-kpi-name">Комментарии</span>
              <span className="post-actual-kpi-val">{actualKpi.comments || 0}</span>
            </div>
            {actualKpi.er_percent != null && (
              <div className="post-actual-kpi-item">
                <span className="post-actual-kpi-name">Вовлечённость</span>
                <span className="post-actual-kpi-val">{actualKpi.er_percent}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="post-edit-actions">
        {onPublish && status !== 'published' && (
          <button
            type="button"
            className="primary-btn post-publish-now-btn"
            onClick={onPublish}
            title="Опубликовать этот пост в соцсеть прямо сейчас"
          >
            <svg
              className="publish-btn-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>Опубликовать сейчас</span>
          </button>
        )}
        {onEdit && (
          <button type="button" className="secondary-btn post-edit-btn" onClick={onEdit}>
            Редактировать
          </button>
        )}
      </div>
    </div>
  )
}

export default PostCard

