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
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  onPostsLimitChange,
  onParseFromUrls,
  onEnrichUploaded,
  onRemoveData
}) => {
  const isActionsDisabled = isParsingFromUrls || isEnriching || isProcessing;

  return (
    <div className="quick-actions competitors-step">
      <div className="actions-group competitors-actions-group">
        <div className="competitors-step-header">
          <span className="actions-label">Конкуренты: ссылки и данные</span>
          <span className="actions-description">
            Шаг 1. Введите ссылки на страницы/аккаунты конкурентов (VK, LinkedIn и т.п.), затем запустите парсинг.
          </span>
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
  );
};

export default CompetitorsStep;
