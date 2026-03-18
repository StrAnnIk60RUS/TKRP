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
              <td>{post.planned_date || '—'}</td>
              <td>{post.platform || '—'}</td>
              <td>{post.topic || 'Без темы'}</td>
              <td>{post.format || '—'}</td>
              <td>{post.objective || '—'}</td>
              <td>{formatPercent(post.expected_kpi?.engagement_rate)}</td>
              <td>{post.cta || '—'}</td>
              <td>
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
