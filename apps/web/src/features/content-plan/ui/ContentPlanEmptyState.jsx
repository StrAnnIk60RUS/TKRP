import React from 'react'

/**
 * Экран «план не выбран»: список снимков на сервере и открытие по ссылке/токену.
 */
export default function ContentPlanEmptyState({
  navigate,
  savedSnapshots,
  savedListLoading,
  savedListError,
  refreshSavedSnapshots,
  savedPlansFilter,
  onSavedPlansFilterChange,
  filteredSavedSnapshots,
  tokenInput,
  onTokenInputChange,
  openingToken,
  onOpenByToken,
  formatSavedAt,
  formatSavedPlatforms
}) {
  return (
    <div className="content-plan-page">
      <div className="empty-state content-plan-empty-wide">
        <h2>Контент-план не выбран</h2>
        <p>Создайте новый план на главной или откройте сохранённый снимок ниже.</p>
        <button type="button" className="primary-btn" onClick={() => navigate('/')}>
          Создать контент-план
        </button>

        <section className="saved-plans-section" aria-labelledby="saved-plans-heading">
          <h3 id="saved-plans-heading" className="saved-plans-section-title">
            Сохранённые планы на сервере
          </h3>
          <p className="saved-plans-intro">
            Выберите план из списка или найдите его по названию, дате сохранения или ID плана. Источник правды по
            данным плана — сервер; локальная история хранит только ссылки (токены).
          </p>
          {savedListLoading && <p className="saved-plans-hint">Загрузка списка…</p>}
          {savedListError && (
            <div className="saved-plans-error-row">
              <p className="saved-plans-error">
                Не удалось загрузить список снимков. Проверьте, что API запущен (порт 3001).
              </p>
              <button type="button" className="secondary-btn" onClick={() => refreshSavedSnapshots()}>
                Повторить
              </button>
            </div>
          )}
          {!savedListLoading && !savedListError && savedSnapshots.length > 0 && (
            <div className="saved-plans-search-row">
              <input
                type="search"
                className="saved-plans-search-input"
                value={savedPlansFilter}
                onChange={(e) => onSavedPlansFilterChange(e.target.value)}
                placeholder="Поиск по названию, дате, платформам или ID плана"
                aria-label="Поиск среди сохранённых планов"
              />
            </div>
          )}
          {!savedListLoading && !savedListError && savedSnapshots.length === 0 && (
            <p className="saved-plans-hint">На сервере пока нет сохранённых снимков.</p>
          )}
          {!savedListLoading &&
            !savedListError &&
            savedSnapshots.length > 0 &&
            filteredSavedSnapshots.length === 0 && (
              <p className="saved-plans-hint">
                Ничего не найдено — попробуйте другой запрос или откройте план по ссылке ниже.
              </p>
            )}
          {!savedListLoading && !savedListError && filteredSavedSnapshots.length > 0 && (
            <div className="precedent-cards saved-plans-cards">
              {filteredSavedSnapshots.map((item) => (
                <div key={item.token} className="precedent-card plan-history-card">
                  <div className="precedent-card-header">
                    <span
                      className="precedent-card-title"
                      title={String(item.summary?.display_name || item.summary?.plan_id || item.token)}
                    >
                      {item.summary?.display_name?.trim() || item.summary?.plan_id || 'Сохранённый план'}
                    </span>
                  </div>
                  <div className="precedent-card-body">
                    <div>Сохранён: {formatSavedAt(item.saved_at)}</div>
                    <div>Публикаций: {item.summary?.publications_count ?? 0}</div>
                    <div>Платформы: {formatSavedPlatforms(item.summary?.platforms) || 'не указаны'}</div>
                    <div>
                      Период: {item.summary?.start_date || '—'} — {item.summary?.end_date || '—'}
                    </div>
                  </div>
                  <div className="plan-history-card-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={openingToken}
                      onClick={() => onOpenByToken(item.token)}
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <details className="saved-plans-link-details">
            <summary>Нет в списке? Открыть по ссылке из браузера</summary>
            <p className="saved-plans-link-hint">
              Вставьте полный адрес страницы с планом (как в адресной строке) — система сама возьмёт из него
              идентификатор.
            </p>
            <div className="saved-plans-token-row saved-plans-token-row-details">
              <input
                type="text"
                className="saved-plans-token-input"
                value={tokenInput}
                onChange={(e) => onTokenInputChange(e.target.value)}
                placeholder="Ссылка или идентификатор из адресной строки"
                disabled={openingToken}
                aria-label="Ссылка на сохранённый план"
              />
              <button
                type="button"
                className="secondary-btn"
                disabled={openingToken || !tokenInput.trim()}
                onClick={() => onOpenByToken(tokenInput)}
              >
                {openingToken ? 'Открытие…' : 'Открыть план'}
              </button>
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}
