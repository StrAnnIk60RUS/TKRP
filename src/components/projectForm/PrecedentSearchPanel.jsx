import React from 'react'

const formatPrecedentScore = (score) => `${Math.round((Number(score) || 0) * 100)}%`

const renderMatchExplanation = (matchedTokens = [], retrieval = null) => {
  const type = retrieval?.type
  if (type === 'embedding_cosine') {
    return 'Semantic retrieval: совпадение считается по смыслу, а не по словам'
  }
  if (!matchedTokens.length) return 'Без совпавших токенов'
  return matchedTokens.join(', ')
}

const PrecedentSearchPanel = ({
  precedentsSummary,
  precedentSearchQuery,
  precedentSearchResults,
  demoHorizonExample,
  onLoadHorizonExample,
  onSeedDemoPrecedents,
  onSearchPrecedents,
  isProcessing,
  isGeneratingDraftPlan,
  isSeedingPrecedents,
  isSearchingPrecedents,
  isEnrichmentServerAvailable,
  retrievalBadge,
  precedentRetrieval,
  onSelectPrecedent
}) => {
  const hasResults = Boolean(precedentSearchResults)
  const hasPublicationResults = (precedentSearchResults?.publications?.length || 0) > 0
  const hasPlanResults = (precedentSearchResults?.content_plans?.length || 0) > 0

  return (
    <section className="form-section precedent-workflow-section">
      <div className="workflow-section-heading">
        <div>
          <h2 className="section-title">Шаг 1. Подбор прецедентов</h2>
          <p className="workflow-section-subtitle">
            Найдите релевантные публикации и планы по данным формы, чтобы черновик опирался на накопленную
            базу, а не на «пустой» запрос.
          </p>
        </div>
      </div>

      <div className="precedent-summary-panel">
        <div className="precedent-summary-line">
          В базе сейчас: {precedentsSummary?.publications_count || 0} публикаций и{' '}
          {precedentsSummary?.content_plans_count || 0} контент-планов.
        </div>
        <div className="precedent-summary-line">
          Источник запроса: описание проекта, аудитория, платформы и преимущества из текущей формы.
        </div>
        {precedentSearchQuery && (
          <div className="precedent-query-box">
            <strong>Последний автоматически собранный запрос:</strong> {precedentSearchQuery}
          </div>
        )}
      </div>

      <div className="workflow-action-row">
        <select
          id="demoHorizonExample"
          name="demoHorizonExample"
          value={demoHorizonExample}
          onChange={(e) => onLoadHorizonExample(e.target.value)}
          disabled={isProcessing || isGeneratingDraftPlan || isEnrichmentServerAvailable === false}
          className="form-select demo-horizon-select"
          title="Загрузить демо-пример для выбранного горизонта"
        >
          <option value="example_month_plan">1 месяц</option>
          <option value="example_three_month_plan">3 месяца</option>
          <option value="example_six_month_plan">6 месяцев</option>
          <option value="example_year_plan">12 месяцев</option>
        </select>
        <button
          type="button"
          className="submit-button secondary"
          onClick={onSeedDemoPrecedents}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isSeedingPrecedents ||
            isEnrichmentServerAvailable === false
          }
          title="Загрузить демо-базу прецедентов"
        >
          <span>{isSeedingPrecedents ? 'ЗАГРУЗКА ДЕМО...' : 'ЗАГРУЗИТЬ ДЕМО-ПРЕЦЕДЕНТЫ'}</span>
        </button>
        <button
          type="button"
          className="submit-button primary"
          onClick={onSearchPrecedents}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isSearchingPrecedents ||
            isEnrichmentServerAvailable === false
          }
          title="Подобрать релевантные публикации и контент-планы"
        >
          <span>{isSearchingPrecedents ? 'ПОИСК ПРЕЦЕДЕНТОВ...' : 'ПОДОБРАТЬ ПРЕЦЕДЕНТЫ'}</span>
        </button>
      </div>

      {!hasResults && (
        <div className="precedent-empty-state precedent-empty-state-light">
          Сначала нажмите `Подобрать прецеденты`.
          {precedentsSummary?.publications_count
            ? ' Поиск выполнится по уже накопленной базе.'
            : ' Если база пустая, загрузите демо-прецеденты или сначала обогатите конкурентов.'}
        </div>
      )}

      {hasResults && (
        <>
          <div className="workflow-next-action">
            {(hasPublicationResults || hasPlanResults) && (
              <strong>Следующий шаг: сформируйте черновой план на основе найденных прецедентов.</strong>
            )}
            {!hasPublicationResults && !hasPlanResults && (
              <strong>Результатов нет: уточните описание проекта или загрузите демо-данные.</strong>
            )}
          </div>

          <div className="precedent-results precedent-results-light">
            <div className="precedent-results-header precedent-results-header-light">
              <span className="precedent-results-title precedent-results-title-light">
                Найдено: {precedentSearchResults.publications?.length || 0} публикаций и{' '}
                {precedentSearchResults.content_plans?.length || 0} планов
              </span>
              <span className="precedent-results-subtitle precedent-results-subtitle-light">
                Поиск выполнен по {precedentSearchResults.total_publications_searched || 0} публикациям и{' '}
                {precedentSearchResults.total_content_plans_searched || 0} планам
              </span>
              {!!retrievalBadge && (
                <div className="precedent-retrieval-banner" title="Как выполнялся поиск прецедентов">
                  <span className={`precedent-retrieval-pill precedent-retrieval-${retrievalBadge.tone}`}>
                    {retrievalBadge.label}
                  </span>
                  <span className="precedent-retrieval-hint">
                    {retrievalBadge.hint}
                    {precedentRetrieval?.type === 'token_overlap_fallback' && precedentRetrieval?.error
                      ? ` · причина: ${precedentRetrieval.error}`
                      : ''}
                  </span>
                </div>
              )}
            </div>

            {hasPublicationResults && (
              <div className="precedent-section">
                <h3 className="precedent-section-title precedent-section-title-light">Публикации</h3>
                <div className="precedent-cards">
                  {precedentSearchResults.publications.map((item) => (
                    <button
                      key={item.data.publication_id}
                      type="button"
                      className="precedent-card precedent-card-clickable precedent-card-button"
                      onClick={() => onSelectPrecedent(item)}
                      title="Открыть детали прецедента"
                    >
                      <div className="precedent-card-header">
                        <span className="precedent-card-title">
                          {item.data.publication_model?.topic || 'Без темы'}
                        </span>
                        <span className="precedent-card-score">{formatPrecedentScore(item.score)}</span>
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
                        <div>Почему найдено: {renderMatchExplanation(item.matched_tokens, precedentRetrieval)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {hasPlanResults && (
              <div className="precedent-section">
                <h3 className="precedent-section-title precedent-section-title-light">Контент-планы</h3>
                <div className="precedent-cards">
                  {precedentSearchResults.content_plans.map((item) => (
                    <button
                      key={item.data.plan_id}
                      type="button"
                      className="precedent-card precedent-card-clickable precedent-card-button"
                      onClick={() => onSelectPrecedent(item)}
                      title="Открыть детали прецедента"
                    >
                      <div className="precedent-card-header">
                        <span className="precedent-card-title">
                          {item.data.competitor_name || item.data.plan_id}
                        </span>
                        <span className="precedent-card-score">{formatPrecedentScore(item.score)}</span>
                      </div>
                      <div className="precedent-card-meta">
                        <span>{item.data.platform || 'unknown'}</span>
                        <span>{item.data.content_plan_model?.posting_frequency_per_week || 0} постов/неделю</span>
                        <span>{item.data.content_plan_model?.total_publications || 0} публикаций</span>
                      </div>
                      <div className="precedent-card-body">
                        <div>
                          Аудитория:{' '}
                          {(item.data.content_plan_model?.audience_segments || []).join(', ') || 'не указана'}
                        </div>
                        <div>
                          Avg engagement:{' '}
                          {formatPrecedentScore(item.data.content_plan_model?.kpi_estimate?.avg_engagement_rate)}
                        </div>
                        <div>Почему найдено: {renderMatchExplanation(item.matched_tokens, precedentRetrieval)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!hasPublicationResults && !hasPlanResults && (
              <div className="precedent-empty-state precedent-empty-state-light">
                По текущим данным формы ничего не найдено. Попробуйте точнее заполнить описание проекта,
                платформы и преимущества или загрузите демо-прецеденты.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default PrecedentSearchPanel
