import React from 'react';

const CompetitorsStep = ({
  competitorUrls,
  competitorsData,
  competitorsFileName,
  postsLimit,
  isParsingFromUrls,
  isEnriching,
  isProcessing,
  isEnrichmentServerAvailable,
  canEnrich,
  showEnrichButton = true,
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  onPostsLimitChange,
  onParseFromUrls,
  onEnrichUploaded,
  onRemoveData
}) => {
  const isActionsDisabled = isParsingFromUrls || isEnriching || isProcessing;
  const competitorsCount = competitorsData?.competitors?.length || 0;
  const parsedPostsCount = (competitorsData?.competitors || []).reduce((sum, c) => {
    const posts = Array.isArray(c?.posts) ? c.posts.length : 0;
    return sum + posts;
  }, 0);

  const normalizedLimit = postsLimit === 'all' ? null : Number(postsLimit);
  const estimatedMaxPosts =
    normalizedLimit && Number.isFinite(normalizedLimit)
      ? normalizedLimit * (competitorUrls?.length || 0)
      : null;

  const serverBadge =
    isEnrichmentServerAvailable === false
      ? { text: 'Backend недоступен', tone: 'danger' }
      : isEnrichmentServerAvailable === true
      ? { text: 'Backend доступен', tone: 'success' }
      : { text: 'Проверка backend…', tone: 'neutral' };

  return (
    <div className="quick-actions competitors-step">
      <div className="actions-group competitors-actions-group">
        <div className="competitors-step-header">
          <span className="actions-label">Конкуренты: ссылки и данные</span>
          <span className="actions-description">
            Шаг 1. Введите ссылки на страницы/аккаунты конкурентов в VK или LinkedIn, затем запустите парсинг.
          </span>
        </div>

        <div className="ui-panel competitors-dashboard">
          <div className="ui-panel-header">
            <div className="ui-panel-title">Статус шага</div>
            <div className={`ui-badge ui-badge-${serverBadge.tone}`}>{serverBadge.text}</div>
          </div>
          <div className="ui-panel-grid">
            <div className="ui-metric">
              <div className="ui-metric-label">Ссылок</div>
              <div className="ui-metric-value">{competitorUrls?.length || 0}</div>
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Лимит постов</div>
              <div className="ui-metric-value">{postsLimit === 'all' ? 'Все' : postsLimit}</div>
              {estimatedMaxPosts !== null && (
                <div className="ui-metric-hint">Оценка: до {estimatedMaxPosts} постов</div>
              )}
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Получено конкурентов</div>
              <div className="ui-metric-value">{competitorsCount}</div>
            </div>
            <div className="ui-metric">
              <div className="ui-metric-label">Получено постов</div>
              <div className="ui-metric-value">{parsedPostsCount}</div>
            </div>
          </div>

          <details className="ui-details">
            <summary className="ui-details-summary">Подсказки по ссылкам (открыть)</summary>
            <div className="ui-details-body">
              <div className="ui-callout">
                <div className="ui-callout-title">Что вставлять</div>
                <div className="ui-callout-text">
                  Ссылку на страницу/профиль/группу конкурента в VK или LinkedIn. Можно вставлять несколько ссылок —
                  каждая будет обработана отдельно.
                </div>
              </div>
              <div className="ui-callout ui-callout-light">
                <div className="ui-callout-title">Примеры</div>
                <div className="ui-callout-text">
                  <div className="ui-mono">https://vk.com/company</div>
                  <div className="ui-mono">https://www.linkedin.com/company/company-name/</div>
                </div>
              </div>
              <div className="ui-callout ui-callout-warning">
                <div className="ui-callout-title">Если парсинг «ничего не нашёл»</div>
                <div className="ui-callout-text">
                  Проверьте, что страница публичная и содержит публикации. Если LinkedIn ограничивает доступ,
                  попробуйте другой URL конкурента или уменьшите лимит постов.
                </div>
              </div>
            </div>
          </details>
        </div>

        <div className="competitors-inputs">
          {competitorUrls.map((url, index) => (
            <div key={index} className="competitor-url-row">
              <input
                type="text"
                value={url}
                onChange={(e) => onUrlChange(index, e.target.value)}
                placeholder="https://vk.com/..., https://www.linkedin.com/..."
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
              <span className="competitors-select-label">Сколько постов парсить</span>
              <select
                className="form-select competitors-select"
                value={postsLimit}
                onChange={(e) => onPostsLimitChange(e.target.value)}
                disabled={isActionsDisabled}
              >
                <option value="1">1 пост</option>
                <option value="10">10 постов</option>
                <option value="50">50 постов</option>
                <option value="100">100 постов</option>
                <option value="all">Все посты</option>
              </select>
            </div>

            <button
              type="button"
              className="action-btn competitors-add-btn"
              onClick={onAddUrl}
              disabled={isActionsDisabled}
            >
              + Добавить ссылку
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
                  : 'Спарсить конкурентов по ссылкам'
              }
            >
              {isParsingFromUrls ? 'Парсинг...' : 'Спарсить'}
            </button>
          </div>
        </div>

        {competitorsData && (
          <div className="competitors-status">
            <span className="competitors-status-text">
              ✓ Данные конкурентов получены из парсера
              {competitorsFileName && ` (${competitorsFileName})`}
              {` — ${competitorsData.competitors?.length || 0} конкурентов`}
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
                    ? 'Сначала выполните успешный парсинг конкурентов'
                    : 'Обогатить данные конкурентов'
                }
              >
                {isEnriching ? 'Обогащение...' : 'Обогатить'}
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

        {!competitorsData && (
          <div className="ui-empty">
            <div className="ui-empty-title">Данных конкурентов пока нет</div>
            <div className="ui-empty-text">
              Добавьте 1–3 ссылки, выберите лимит постов и нажмите <strong>Спарсить</strong>.
              {showEnrichButton
                ? ' После этого появится кнопка Обогатить и данные будут добавлены в базу прецедентов.'
                : ' Данные будут автоматически обогащены и добавлены в базу прецедентов.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CompetitorsStep;
