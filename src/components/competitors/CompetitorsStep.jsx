import React from 'react';

const CompetitorsStep = ({
  competitorUrls,
  competitorsData,
  competitorsFileName,
  isParsingFromUrls,
  isEnriching,
  isProcessing,
  isEnrichmentServerAvailable,
  canEnrich,
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  onParseFromUrls,
  onFileUpload,
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
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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

        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '16px',
            borderTop: '1px solid rgba(148, 163, 184, 0.4)',
            paddingTop: '12px'
          }}
        >
          <span style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>
            Шаг 1 (альтернатива). Загрузите уже спарсенные данные конкурентов в формате JSON.
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              flexWrap: 'wrap'
            }}
          >
            <label className="action-btn" style={{ cursor: 'pointer', margin: 0, display: 'inline-block' }}>
              <input type="file" accept=".json" onChange={onFileUpload} style={{ display: 'none' }} />
              <span style={{ position: 'relative', zIndex: 2 }}>Загрузить JSON с данными конкурентов</span>
            </label>
            {competitorsData && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flex: 1,
                  flexWrap: 'wrap'
                }}
              >
                <span style={{ color: '#ffffff', fontSize: '0.9rem' }}>
                  ✓ {competitorsFileName} ({competitorsData.competitors?.length || 0} конкурентов)
                  {competitorsData.competitors?.[0]?.posts?.[0]?.content_category && (
                    <span style={{ color: '#4ade80', marginLeft: '8px' }}>• Обогащено</span>
                  )}
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
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompetitorsStep;
