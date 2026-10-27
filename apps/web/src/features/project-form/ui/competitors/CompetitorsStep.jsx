import React from 'react'
import ProcessIndicator from '../../../../shared/ui/ProcessIndicator'

const CompetitorsStep = ({
  competitorUrls,
  competitorsData,
  competitorsFileName,
  postsLimit,
  isParsingFromUrls,
  isEnriching,
  isSeedingPrecedents = false,
  isProcessing,
  isEnrichmentServerAvailable,
  canEnrich,
  showEnrichButton = true,
  precedentsAlreadyInDb = false,
  precedentsSummary = null,
  allowInstagram = false,
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  onPostsLimitChange,
  onParseFromUrls,
  onEnrichUploaded,
  onRemoveData,
  onSeedDemoPrecedents,
  onSkipToNextStep
}) => {
  const isActionsDisabled = isParsingFromUrls || isEnriching || isSeedingPrecedents || isProcessing
  const competitorsCount = competitorsData?.competitors?.length || 0
  const parsedPostsCount = (competitorsData?.competitors || []).reduce((sum, c) => {
    const posts = Array.isArray(c?.posts) ? c.posts.length : 0
    return sum + posts
  }, 0)

  const dbPublicationsCount = Number(precedentsSummary?.publications_count) || 0
  const dbPlansCount = Number(precedentsSummary?.content_plans_count) || 0
  const dbTotalCount = dbPublicationsCount + dbPlansCount
  const isSourceReady = precedentsAlreadyInDb || competitorsCount > 0 || dbTotalCount > 0

  const normalizedLimit = postsLimit === 'all' ? null : Number(postsLimit)
  const estimatedMaxPosts =
    normalizedLimit && Number.isFinite(normalizedLimit)
      ? normalizedLimit * (competitorUrls?.length || 0)
      : null

  const serverBadge =
    isEnrichmentServerAvailable === false
      ? { text: 'Сервер недоступен', tone: 'danger' }
      : isEnrichmentServerAvailable === true
      ? { text: 'Сервер подключён', tone: 'success' }
      : { text: 'Проверка соединения…', tone: 'neutral' }

  return (
    <div className="quick-actions competitors-step">
      <div className="actions-group competitors-actions-group">
        <div className="competitors-step-header">
          <span className="actions-label">Шаг 1. Источники успешных примеров (Конкуренты и база)</span>
          <span className="actions-description">
            Чтобы контент-план был эффективным, искусственный интеллект и модель прогноза вовлечённости опираются на реальные посты с известным охватом.
            Выберите удобный вариант ниже: используйте уже накопленную базу примеров или добавьте ссылки на конкурентов.
          </span>
        </div>

        {/* Блок 1: Быстрый путь через базу прецедентов */}
        <div className="ui-panel competitors-dashboard">
          <div className="ui-panel-header">
            <div className="ui-panel-title">Вариант 1 (Быстрый): База прецедентов</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`ui-badge ui-badge-${isSourceReady ? 'success' : 'danger'}`}>
                {isSourceReady ? 'Источник данных готов' : 'Нужны примеры в базе или ссылки'}
              </span>
              {serverBadge && <div className={`ui-badge ui-badge-${serverBadge.tone}`}>{serverBadge.text}</div>}
            </div>
          </div>

          <div className="ui-panel-grid">
            <div className="ui-metric">
              <div className="ui-metric-label">Публикаций в базе</div>
              <div className="ui-metric-value">{dbPublicationsCount}</div>
              <div className="ui-metric-hint">Готовые примеры постов</div>
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Планов в базе</div>
              <div className="ui-metric-value">{dbPlansCount}</div>
              <div className="ui-metric-hint">Эталонные структуры</div>
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Новых конкурентов в форме</div>
              <div className="ui-metric-value">{competitorsCount}</div>
              <div className="ui-metric-hint">Добавлено в этой сессии</div>
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Новых постов в форме</div>
              <div className="ui-metric-value">{parsedPostsCount}</div>
              {estimatedMaxPosts !== null && parsedPostsCount === 0 && (
                <div className="ui-metric-hint">Лимит парсинга: до {estimatedMaxPosts}</div>
              )}
            </div>
          </div>

          {isSeedingPrecedents && (
            <div style={{ marginTop: '12px' }}>
              <ProcessIndicator active processId="seedingPrecedents" contextual />
            </div>
          )}

          <div
            className={`ui-callout ${isSourceReady ? 'ui-callout-light' : 'ui-callout-warning'}`}
            style={{ marginTop: '12px' }}
          >
            <div className="ui-callout-title">
              {isSourceReady
                ? 'Что делать сейчас: можно сразу переходить к следующему шагу!'
                : 'База прецедентов пока пуста — загрузите демо-базу в 1 клик или спарсите конкурентов'}
            </div>
            <div className="ui-callout-text">
              {isSourceReady
                ? `В системе уже доступно ${dbTotalCount} прецедентов в базе${
                    competitorsCount > 0 ? ` и ${parsedPostsCount} постов в форме` : ''
                  }. Парсить ссылки ниже необязательно — нажмите «Продолжить с текущей базой», чтобы перейти к описанию проекта.`
                : 'Если у вас нет под рукой ссылок на группы конкурентов или вы хотите быстро протестировать систему, нажмите «Загрузить демо-базу примеров» — это займёт пару секунд.'}
            </div>
            <div className="competitors-controls" style={{ marginTop: '12px' }}>
              {isSourceReady && typeof onSkipToNextStep === 'function' && (
                <button
                  type="button"
                  className="action-btn competitors-parse-btn"
                  onClick={onSkipToNextStep}
                  disabled={isActionsDisabled}
                  style={{ background: '#ff6b9d', borderColor: '#ff6b9d' }}
                >
                  <span>Продолжить с текущей базой</span>
                </button>
              )}
              {typeof onSeedDemoPrecedents === 'function' && (
                <button
                  type="button"
                  className="action-btn"
                  onClick={onSeedDemoPrecedents}
                  disabled={isActionsDisabled || isEnrichmentServerAvailable === false}
                  title="Заполнить базу проверенными IT-публикациями и контент-планами для быстрого старта"
                >
                  <span>
                    {isSeedingPrecedents
                      ? 'Загрузка демо-базы...'
                      : dbTotalCount > 0
                        ? 'Обновить демо-базу прецедентов'
                        : 'Загрузить демо-базу примеров (1 клик)'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Блок 2: Парсинг конкурентов по ссылкам */}
        <div className="ui-panel competitors-dashboard">
          <div className="ui-panel-header">
            <div className="ui-panel-title">
              Вариант 2 (Опционально): Собрать посты конкурентов по ссылкам
            </div>
          </div>

          <div className="ui-callout" style={{ marginBottom: '12px' }}>
            <div className="ui-callout-title">Как добавить своих конкурентов</div>
            <div className="ui-callout-text">
              Вставьте ссылку на публичную группу или страницу конкурента в VK или LinkedIn
              {allowInstagram ? ' или Instagram' : ''} и нажмите <strong>«Спарсить по ссылкам»</strong>.
            </div>
          </div>

          {isParsingFromUrls && (
            <ProcessIndicator active processId="parsing" contextual />
          )}

          <div className="competitors-inputs">
            {competitorUrls.map((url, index) => (
              <div key={index} className="competitor-url-row">
                <input
                  type="text"
                  value={url}
                  onChange={(e) => onUrlChange(index, e.target.value)}
                  placeholder={
                    allowInstagram
                      ? 'Например: https://vk.com/company или https://www.linkedin.com/company/... или https://www.instagram.com/...'
                      : 'Например: https://vk.com/company или https://www.linkedin.com/company/...'
                  }
                  className="form-input competitor-url-input"
                />
                {competitorUrls.length > 1 && (
                  <button
                    type="button"
                    className="action-btn danger competitor-remove-btn"
                    onClick={() => onRemoveUrl(index)}
                    disabled={isActionsDisabled}
                  >
                    Удалить
                  </button>
                )}
              </div>
            ))}

            <div className="competitors-controls">
              <div className="competitors-select-block">
                <span className="competitors-select-label">Сколько постов забрать с каждой ссылки</span>
                <select
                  className="form-select competitors-select"
                  value={postsLimit}
                  onChange={(e) => onPostsLimitChange(e.target.value)}
                  disabled={isActionsDisabled}
                >
                  <option value="1">1 пост (быстрая проверка)</option>
                  <option value="10">10 постов (рекомендуется)</option>
                  <option value="50">50 постов</option>
                  <option value="100">100 постов</option>
                  <option value="all">Все доступные посты</option>
                </select>
              </div>

              <button
                type="button"
                className="action-btn competitors-add-btn"
                onClick={onAddUrl}
                disabled={isActionsDisabled}
              >
                + Ещё ссылка
              </button>

              <button
                type="button"
                className="action-btn competitors-parse-btn"
                onClick={onParseFromUrls}
                disabled={isActionsDisabled || isEnrichmentServerAvailable === false}
                style={{
                  backgroundColor: isEnrichmentServerAvailable === false ? '#666' : undefined,
                  cursor: isParsingFromUrls ? 'wait' : undefined
                }}
                title={
                  isEnrichmentServerAvailable === false
                    ? 'Сервер парсинга/обогащения недоступен'
                    : 'Спарсить конкурентов по указанным ссылкам'
                }
              >
                {isParsingFromUrls ? 'Парсинг...' : 'Спарсить по ссылкам'}
              </button>
            </div>
          </div>

          {competitorsData && (
            <div className="competitors-status">
              {isEnriching && <ProcessIndicator active processId="enriching" contextual />}
              <span className="competitors-status-text">
                Загружены данные конкурентов
                {competitorsFileName && ` (${competitorsFileName})`}
                {` — ${competitorsCount} конкурентов, ${parsedPostsCount} постов`}
              </span>

              {showEnrichButton && (
                <button
                  type="button"
                  className="action-btn competitors-enrich-btn"
                  onClick={onEnrichUploaded}
                  disabled={isEnriching || isProcessing || !canEnrich || isEnrichmentServerAvailable === false}
                  style={{
                    backgroundColor: isEnrichmentServerAvailable === false ? '#666' : undefined,
                    cursor: isEnriching || !canEnrich ? 'not-allowed' : undefined
                  }}
                  title={
                    isEnrichmentServerAvailable === false
                      ? 'Сервер обогащения недоступен'
                      : !canEnrich
                      ? 'Сначала получите данные конкурентов'
                      : 'Обогатить данные конкурентов и сохранить в базу прецедентов'
                  }
                >
                  {isEnriching ? 'Обогащение...' : 'Обогатить и сохранить в базу'}
                </button>
              )}

              <button
                type="button"
                className="action-btn danger competitors-clear-btn"
                onClick={onRemoveData}
                disabled={isEnriching || isProcessing}
              >
                Очистить конкурентов
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CompetitorsStep

