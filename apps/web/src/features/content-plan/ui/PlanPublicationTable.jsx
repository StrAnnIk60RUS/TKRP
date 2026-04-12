import React from 'react'
import {
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
            <th title="Внутренняя оценка модели, 0–100%, не метрика площадки">Вовлечённость (оценка)</th>
            <th>CTA</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {publications.map((post, idx) => {
            const normalizedPost = normalizePublicationForUi(post)
            const kpi = getKpiPresentation(normalizedPost.expected_kpi)
            return (
            <tr key={`${normalizedPost.publication_id || 'pub'}_${normalizedPost.planned_date || 'na'}_${idx}`}>
              <td data-label="Дата">{normalizedPost.planned_date || '—'}</td>
              <td data-label="Платформа">{getPlatformLabel(normalizedPost.platform)}</td>
              <td data-label="Заголовок">{normalizedPost.title || normalizedPost.topic || 'Без темы'}</td>
              <td data-label="Формат">{getFormatLabel(normalizedPost.format)}</td>
              <td data-label="Цель">{getObjectiveLabel(normalizedPost.objective)}</td>
              <td data-label="Вовлечённость (оценка)">
                <div>{kpi.engagementPercent}</div>
                {kpi.isRelativeScore && (
                  <div className="plan-table-kpi-band">Потенциал: {kpi.engagementBand}</div>
                )}
              </td>
              <td data-label="CTA">{isMeaningfulCta(normalizedPost.cta) ? normalizedPost.cta : '—'}</td>
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
