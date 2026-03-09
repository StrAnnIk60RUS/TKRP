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
  return (
    <div className="quick-actions" style={{ marginBottom: '24px' }}>
      <div className="actions-group" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '16px' }}>
        <span className="actions-label">Конкуренты: ссылки и файлы</span>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>
            Шаг 1. Введите ссылки на страницы/аккаунты конкурентов (VK, LinkedIn и т.п.), затем запустите парсинг.
          </span>
          {competitorUrls.map((url, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                marginBottom: '4px',
                width: '100%',
                flexWrap: 'wrap'
              }}
            >
              <input
                type="text"
                value={url}
                onChange={(e) => onUrlChange(index, e.target.value)}
                placeholder="https://vk.com/..., https://www.linkedin.com/..."
                className="form-input"
                style={{ flex: 1, minWidth: '220px' }}
              />
              {competitorUrls.length > 1 && (
                <button
                  type="button"
                  className="action-btn danger"
                  onClick={() => onRemoveUrl(index)}
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  Удалить
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                minWidth: '220px'
              }}
            >
              <span style={{ color: '#e2e8f0', fontSize: '0.8rem' }}>Сколько постов парсить</span>
              <select
                className="form-select"
                value={postsLimit}
                onChange={(e) => onPostsLimitChange(e.target.value)}
                disabled={isParsingFromUrls || isEnriching || isProcessing}
                style={{ fontSize: '0.85rem' }}
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
              className="action-btn"
              onClick={onAddUrl}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              disabled={isParsingFromUrls || isEnriching || isProcessing}
            >
              + Добавить ссылку
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={onParseFromUrls}
              disabled={isParsingFromUrls || isEnriching || isProcessing}
              style={{
                padding: '6px 12px',
                fontSize: '0.85rem',
                backgroundColor: isEnrichmentServerAvailable === false ? '#666' : '#3b82f6',
                opacity: isParsingFromUrls ? 0.6 : 1,
                cursor: isParsingFromUrls ? 'wait' : 'pointer'
              }}
              title={
                isEnrichmentServerAvailable === false
                  ? 'Сервер парсинга/обогащения недоступен'
                  : 'Спарсить конкурентов по ссылкам'
              }
            >
              {isParsingFromUrls ? 'ПАРСИНГ...' : 'Спарсить'}
            </button>
          </div>
        </div>

        {competitorsData && (
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'row',
              gap: '12px',
              marginTop: '16px',
              borderTop: '1px solid rgba(148, 163, 184, 0.4)',
              paddingTop: '12px',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}
          >
            <span style={{ color: '#ffffff', fontSize: '0.9rem' }}>
              ✓ Данные конкурентов получены из парсера
              {competitorsFileName && ` (${competitorsFileName})`}
              {` — ${competitorsData.competitors?.length || 0} конкурентов`}
            </span>
            <button
              type="button"
              className="action-btn"
              onClick={onEnrichUploaded}
              disabled={isEnriching || isProcessing || !canEnrich}
              style={{
                padding: '6px 12px',
                fontSize: '0.85rem',
                backgroundColor: isEnrichmentServerAvailable === false ? '#666' : '#3b82f6',
                opacity: isEnriching || !canEnrich ? 0.6 : 1,
                cursor: isEnriching || !canEnrich ? 'not-allowed' : 'pointer'
              }}
              title={
                isEnrichmentServerAvailable === false
                  ? 'Сервер обогащения недоступен'
                  : !canEnrich
                  ? 'Сначала выполните успешный парсинг конкурентов'
                  : 'Обогатить данные через DeepSeek'
              }
            >
              {isEnriching ? 'ОБОГАЩЕНИЕ...' : '🤖 Обогатить'}
            </button>
            <button
              type="button"
              className="action-btn danger"
              onClick={onRemoveData}
              disabled={isEnriching || isProcessing}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
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
