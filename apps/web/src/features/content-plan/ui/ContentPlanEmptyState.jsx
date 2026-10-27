import React from 'react'
import { useUserRole } from '../../../app/providers/UserRoleContext'

/**
 * Экран «план не выбран»: список ранее созданных планов.
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
  const { isAnalyst } = useUserRole()
  const hasSavedPlans = Array.isArray(savedSnapshots) && savedSnapshots.length > 0

  return (
    <div className="content-plan-page">
      <div className="empty-state content-plan-empty-wide">
        <h2>Контент-план ещё не сформирован</h2>
        <p>Создайте новый контент-план в мастере или откройте один из ранее созданных планов.</p>
        <button type="button" className="primary-btn" onClick={() => navigate('/')}>
          Создать контент-план
        </button>

        {(hasSavedPlans || isAnalyst) && (
          <section className="saved-plans-section" aria-labelledby="saved-plans-heading">
            <h3 id="saved-plans-heading" className="saved-plans-section-title">
              Сохранённые контент-планы
            </h3>
            {savedListLoading && <p className="saved-plans-hint">Загрузка списка планов…</p>}
            {savedListError && (
              <div className="saved-plans-error-row">
                <p className="saved-plans-error">
                  Не удалось загрузить список планов. Проверьте подключение к серверу.
                </p>
                <button type="button" className="secondary-btn" onClick={() => refreshSavedSnapshots()}>
                  Повторить
                </button>
              </div>
            )}
            {!savedListLoading && !savedListError && hasSavedPlans && (
              <div className="saved-plans-search-row">
                <input
                  type="search"
                  className="saved-plans-search-input"
                  value={savedPlansFilter}
                  onChange={(e) => onSavedPlansFilterChange(e.target.value)}
                  placeholder="Поиск по названию, дате или платформам"
                  aria-label="Поиск среди сохранённых планов"
                />
              </div>
            )}
            {!savedListLoading &&
              !savedListError &&
              hasSavedPlans &&
              filteredSavedSnapshots.length === 0 && (
                <p className="saved-plans-hint">
                  Ничего не найдено по вашему запросу.
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

            {isAnalyst && (
              <details className="saved-plans-link-details">
                <summary>Открыть по ссылке или идентификатору</summary>
                <div className="saved-plans-token-row saved-plans-token-row-details">
                  <input
                    type="text"
                    className="saved-plans-token-input"
                    value={tokenInput}
                    onChange={(e) => onTokenInputChange(e.target.value)}
                    placeholder="Ссылка или токен плана"
                    disabled={openingToken}
                    aria-label="Ссылка или идентификатор плана"
                  />
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={openingToken || !tokenInput.trim()}
                    onClick={() => onOpenByToken(tokenInput)}
                  >
                    {openingToken ? 'Открытие…' : 'Открыть'}
                  </button>
                </div>
              </details>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
