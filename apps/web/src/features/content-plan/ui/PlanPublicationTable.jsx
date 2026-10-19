import React from 'react'
import {
  getCompactTopicHeading,
  getFormatLabel,
  getKpiPresentation,
  getObjectiveLabel,
  getPlatformLabel,
  isMeaningfulCta,
  normalizePublicationForUi
} from '../lib/publicationPresentation'

const PlanPublicationTable = ({ publications, onEdit }) => {
  return (
    <div className="plan-table-wrapper">
      <table className="plan-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Платформа</th>
            <th>Заголовок</th>
            <th>Формат</th>
            <th>Цель</th>
            <th>Статус</th>
            <th title="Внутренняя оценка модели, 0–100%, не метрика площадки">Вовлечённость (оценка)</th>
            <th>Призыв</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {publications.map((post, idx) => {
            const normalizedPost = normalizePublicationForUi(post)
            const kpi = getKpiPresentation(normalizedPost.expected_kpi)
            const fullHeading = normalizedPost.title || normalizedPost.topic || 'Без темы'
            const heading = getCompactTopicHeading(fullHeading) || fullHeading
            const status = normalizedPost.status || 'draft'
            return (
            <tr key={`${normalizedPost.publication_id || 'pub'}_${normalizedPost.planned_date || 'na'}_${idx}`}>
              <td data-label="Дата">{normalizedPost.planned_date || '—'}</td>
              <td data-label="Платформа">{getPlatformLabel(normalizedPost.platform)}</td>
              <td data-label="Заголовок" title={fullHeading !== heading ? fullHeading : undefined}>
                {heading}
              </td>
              <td data-label="Формат">{getFormatLabel(normalizedPost.format)}</td>
              <td data-label="Цель">{getObjectiveLabel(normalizedPost.objective)}</td>
              <td data-label="Статус">
                <span className={`post-status-badge post-status-${status}`}>
                  {status === 'published' && '🟢 Опубликован'}
                  {status === 'scheduled' && '⏰ Запланирован'}
                  {status === 'draft' && '📝 Черновик'}
                  {status === 'failed' && '❌ Ошибка'}
                </span>
                {normalizedPost.post_url && (
                  <div>
                    <a
                      href={normalizedPost.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}
                    >
                      Ссылка ↗
                    </a>
                  </div>
                )}
              </td>
              <td data-label="Вовлечённость (оценка)">
                <div>{kpi.engagementPercent}</div>
                {kpi.isRelativeScore && (
                  <div className="plan-table-kpi-band">Потенциал: {kpi.engagementBand}</div>
                )}
              </td>
              <td data-label="Призыв">{isMeaningfulCta(normalizedPost.cta) ? normalizedPost.cta : '—'}</td>
              <td data-label="Действие">
                <button type="button" className="secondary-btn plan-table-edit-btn" onClick={() => onEdit(normalizedPost)}>
                  Редактировать
                </button>
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PlanPublicationTable
