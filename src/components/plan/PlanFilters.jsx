import React from 'react'

const PlanFilters = ({
  filters,
  platformOptions,
  formatOptions,
  onChange,
  onReset
}) => {
  return (
    <section className="plan-section plan-filters-section">
      <div className="plan-filters-header">
        <div>
          <h2 className="section-title">Фильтры и поиск</h2>
          <p className="plan-filters-subtitle">
            Быстро отберите нужные публикации по платформе, формату, дате или ключевым словам.
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={onReset}>
          Сбросить фильтры
        </button>
      </div>

      <div className="plan-filters-grid">
        <label className="plan-filter-field">
          Поиск
          <input
            type="text"
            className="plan-filter-input"
            value={filters.search}
            onChange={(e) => onChange('search', e.target.value)}
            placeholder="Тема, сообщение, CTA"
          />
        </label>

        <label className="plan-filter-field">
          Платформа
          <select
            className="plan-filter-input"
            value={filters.platform}
            onChange={(e) => onChange('platform', e.target.value)}
          >
            <option value="all">Все платформы</option>
            {platformOptions.map((option) => (
              <option key={option} value={option}>
                {option.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label className="plan-filter-field">
          Формат
          <select
            className="plan-filter-input"
            value={filters.format}
            onChange={(e) => onChange('format', e.target.value)}
          >
            <option value="all">Все форматы</option>
            {formatOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="plan-filter-field">
          Дата от
          <input
            type="date"
            className="plan-filter-input"
            value={filters.dateFrom}
            onChange={(e) => onChange('dateFrom', e.target.value)}
          />
        </label>

        <label className="plan-filter-field">
          Дата до
          <input
            type="date"
            className="plan-filter-input"
            value={filters.dateTo}
            onChange={(e) => onChange('dateTo', e.target.value)}
          />
        </label>
      </div>
    </section>
  )
}

export default PlanFilters
