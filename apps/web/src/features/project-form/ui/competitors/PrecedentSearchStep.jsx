import React from 'react';

const formatScore = (score) => `${Math.round((Number(score) || 0) * 100)}%`;

const formatReliabilityLabel = (reliability) => {
  const r = Number(reliability);
  if (!Number.isFinite(r)) return null;
  const pct = Math.round(r * 100);
  if (pct >= 75) return { label: `${pct}%`, tone: 'success', title: 'Высокая надёжность' };
  if (pct >= 50) return { label: `${pct}%`, tone: 'neutral', title: 'Средняя надёжность' };
  return { label: `${pct}%`, tone: 'warn', title: 'Низкая надёжность' };
};

const renderCardScore = (item) => {
  if (Number.isFinite(Number(item.reliability))) {
    const r = formatReliabilityLabel(item.reliability);
    return (
      <span className={`precedent-card-reliability precedent-reliability-${r?.tone || 'neutral'}`} title={r?.title}>
        {r?.label}
      </span>
    );
  }
  return <span className="precedent-card-score" title="Релевантность">{formatScore(item.score)}</span>;
};

const renderMatchExplanation = (matchedTokens = [], retrieval = null) => {
  const type = retrieval?.type;
  if (type === 'embedding_cosine') {
    return 'Semantic retrieval (эмбеддинги): совпавшие токены не считаются';
  }
  if (!matchedTokens.length) return 'Без совпавших токенов';
  return matchedTokens.join(', ');
};

const PrecedentSearchStep = ({
  searchQuery,
  onSearchQueryChange,
  onUseSuggestedQuery,
  onSearch,
  onSeedDemo,
  isSearching,
  isSeeding,
  isServerAvailable,
  precedentsSummary,
  precedentResults
}) => {
  const publications = precedentResults?.publications || [];
  const contentPlans = precedentResults?.content_plans || [];
  const retrieval = precedentResults?.retrieval || null;

  return (
    <div className="quick-actions precedent-search-step">
      <div className="actions-group competitors-actions-group">
        <div className="competitors-step-header">
          <span className="actions-label">Поиск прецедентов</span>
          <span className="actions-description">
            Шаг 2. Сформулируйте запрос лица, принимающего решение, и найдите релевантные публикации
            и наблюдаемые контент-планы в накопленной базе прецедентов.
          </span>
        </div>

        <div className="precedent-summary">
          <span className="precedent-summary-text">
            В базе: {precedentsSummary?.publications_count || 0} публикаций и{' '}
            {precedentsSummary?.content_plans_count || 0} контент-планов
          </span>
          {onSeedDemo && (
            <button
              type="button"
              className="action-btn precedent-seed-btn"
              onClick={onSeedDemo}
              disabled={isSeeding || isServerAvailable === false}
              title="Загрузить готовые демо-данные (2 конкурента, 3 публикации, 2 контент-плана), чтобы сразу попробовать поиск"
            >
              {isSeeding ? 'Загрузка...' : 'Загрузить демо-базу прецедентов'}
            </button>
          )}
        </div>

        <div className="precedent-search-controls">
          <textarea
            className="form-textarea precedent-search-textarea"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Например: LinkedIn B2B посты про интеллектуальные датчики, экспертный тон, кейсы внедрения"
            rows="3"
            disabled={isSearching || isServerAvailable === false}
          />

          <div className="precedent-search-actions">
            <button
              type="button"
              className="action-btn"
              onClick={onUseSuggestedQuery}
              disabled={isSearching}
            >
              Автозаполнить из формы
            </button>

            <button
              type="button"
              className="action-btn competitors-parse-btn"
              onClick={onSearch}
              disabled={isSearching || isServerAvailable === false}
              title={
                isServerAvailable === false
                  ? 'Сервер поиска прецедентов недоступен'
                  : 'Найти релевантные прецеденты'
              }
            >
              {isSearching ? 'Поиск...' : 'Найти прецеденты'}
            </button>
          </div>
        </div>

        {!!precedentResults && (
          <div className="precedent-results">
            <div className="precedent-results-header">
              <span className="precedent-results-title">
                Найдено по запросу: {publications.length} публикаций и {contentPlans.length} планов
              </span>
              <span className="precedent-results-subtitle">
                Поиск выполнен по {precedentResults.total_publications_searched || 0} публикациям и{' '}
                {precedentResults.total_content_plans_searched || 0} планам
              </span>
              {!!retrieval?.type && (
                <span className="precedent-results-subtitle">
                  Retrieval: {retrieval.type}
                  {retrieval.embedding_model ? ` · ${retrieval.embedding_model}` : ''}
                </span>
              )}
            </div>

            {publications.length > 0 && (
              <div className="precedent-section">
                <h3 className="precedent-section-title">Публикации</h3>
                <div className="precedent-cards">
                  {publications.map((item) => (
                    <div key={item.data.publication_id} className="precedent-card">
                      <div className="precedent-card-header">
                        <span className="precedent-card-title">
                          {item.data.publication_model?.topic || 'Без темы'}
                        </span>
                        {renderCardScore(item)}
                      </div>
                      <div className="precedent-card-meta">
                        <span>{item.data.competitor_name || 'Неизвестный конкурент'}</span>
                        <span>{item.data.platform || 'unknown'}</span>
                        <span>{item.data.publication_model?.format || 'unknown'}</span>
                      </div>
                      <div className="precedent-card-body">
                        <div>Тип: {item.data.publication_model?.type || 'other'}</div>
                        <div>Категория: {item.data.publication_model?.content_category || 'other'}</div>
                        <div>
                          Аудитория:{' '}
                          {(item.data.publication_model?.audience_segments || []).join(', ') || 'не указана'}
                        </div>
                        <div>
                          Почему найдено: {renderMatchExplanation(item.matched_tokens, retrieval)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contentPlans.length > 0 && (
              <div className="precedent-section">
                <h3 className="precedent-section-title">Контент-планы</h3>
                <div className="precedent-cards">
                  {contentPlans.map((item) => (
                    <div key={item.data.plan_id} className="precedent-card">
                      <div className="precedent-card-header">
                        <span className="precedent-card-title">
                          {item.data.competitor_name || item.data.plan_id}
                        </span>
                        {renderCardScore(item)}
                      </div>
                      <div className="precedent-card-meta">
                        <span>{item.data.platform || 'unknown'}</span>
                        <span>
                          {item.data.content_plan_model?.posting_frequency_per_week || 0} постов/неделю
                        </span>
                        <span>
                          {item.data.content_plan_model?.total_publications || 0} публикаций
                        </span>
                      </div>
                      <div className="precedent-card-body">
                        <div>
                          Аудитория:{' '}
                          {(item.data.content_plan_model?.audience_segments || []).join(', ') || 'не указана'}
                        </div>
                        <div>
                          Avg engagement:{' '}
                          {formatScore(item.data.content_plan_model?.kpi_estimate?.avg_engagement_rate)}
                        </div>
                        <div>
                          Почему найдено: {renderMatchExplanation(item.matched_tokens, retrieval)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {publications.length === 0 && contentPlans.length === 0 && (
              <div className="precedent-empty-state">
                По текущему запросу ничего не найдено. Попробуйте упростить формулировку или сначала
                обогатить больше данных конкурентов.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PrecedentSearchStep;
