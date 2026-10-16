import React from 'react'

const VIEWS = [
  { id: 'cards', label: 'Карточки' },
  { id: 'table', label: 'Таблица' },
  { id: 'calendar', label: 'Календарь' }
]

const PlanViewToggle = ({ viewMode, onChange, filteredCount }) => {
  return (
    <div className="plan-view-toggle">
      <div className="plan-view-toggle-buttons">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`plan-view-toggle-btn ${viewMode === view.id ? 'active' : ''}`}
            onClick={() => onChange(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>
      <span className="plan-view-toggle-meta">Отображается публикаций: {filteredCount}</span>
    </div>
  )
}

export default PlanViewToggle
