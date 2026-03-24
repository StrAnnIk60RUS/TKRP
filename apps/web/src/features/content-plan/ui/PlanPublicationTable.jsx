import React from 'react'

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const PlanPublicationTable = ({ publications, onEdit }) => {
  return (
    <div className="plan-table-wrapper">
      <table className="plan-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Платформа</th>
            <th>Тема</th>
            <th>Формат</th>
            <th>Цель</th>
            <th>Engagement</th>
            <th>CTA</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {publications.map((post, idx) => (
            <tr key={`${post.publication_id || 'pub'}_${post.planned_date || 'na'}_${idx}`}>
              <td data-label="Дата">{post.planned_date || '—'}</td>
              <td data-label="Платформа">{post.platform || '—'}</td>
              <td data-label="Тема">{post.topic || 'Без темы'}</td>
              <td data-label="Формат">{post.format || '—'}</td>
              <td data-label="Цель">{post.objective || '—'}</td>
              <td data-label="Engagement">{formatPercent(post.expected_kpi?.engagement_rate)}</td>
              <td data-label="CTA">{post.cta || '—'}</td>
              <td data-label="Действие">
                <button type="button" className="secondary-btn plan-table-edit-btn" onClick={() => onEdit(post)}>
                  Редактировать
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default PlanPublicationTable
