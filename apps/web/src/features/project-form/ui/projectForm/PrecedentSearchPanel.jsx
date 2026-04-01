import React from 'react'

const formatPrecedentScore = (score) => `${Math.round((Number(score) || 0) * 100)}%`

const formatReliabilityLabel = (reliability) => {
  const r = Number(reliability)
  if (!Number.isFinite(r)) return null
  const pct = Math.round(r * 100)
  if (pct >= 75) return { label: `${pct}%`, tone: 'success', title: 'Высокая надёжность' }
  if (pct >= 50) return { label: `${pct}%`, tone: 'neutral', title: 'Средняя надёжность' }
  return { label: `${pct}%`, tone: 'warn', title: 'Низкая надёжность' }
}
const ONTOLOGY_PREVIEW_LIMIT = 12

const renderMatchExplanation = (matchedTokens = [], retrieval = null) => {
  const type = retrieval?.type
  if (type === 'embedding_cosine') {
    return 'Semantic retrieval: совпадение считается по смыслу, а не по словам'
  }
  if (!matchedTokens.length) return 'Без совпавших токенов'
  return matchedTokens.join(', ')
}

const formatOntologyClassLabel = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())

const buildOntologyPreview = (ontology) => {
  const global = ontology?.global || {}
  const entities = Array.isArray(global.entities) ? global.entities : []
  const entityLinks = Array.isArray(global.entity_class_links) ? global.entity_class_links : []
  const triples = Array.isArray(global.triples) ? global.triples : []
  const hierarchy = Array.isArray(global.hierarchy) ? global.hierarchy : []
  const templates = Array.isArray(global.relation_templates) ? global.relation_templates : []
  const metaEntities = Array.isArray(global.meta_entities) ? global.meta_entities : []

  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  const entityClassRows = entityLinks
    .map((link) => ({
      id: link.id,
      label: entitiesById.get(link.entity_id)?.label || link.entity_id,
      classId: link.class_id,
      confidence: Number(link.confidence) || 0
    }))
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label, 'ru'))

  return {
    summary: {
      contexts: Number(ontology?.source_summary?.contexts_count) || 0,
      classes: Array.isArray(global.classes) ? global.classes.length : 0,
      entities: entities.length,
      triples: triples.length
    },
    entityClassRows,
    triples,
    hierarchy,
    templates,
    metaEntities
  }
}

const PrecedentSearchPanel = ({
  precedentsSummary,
  precedentSearchQuery,
  precedentSearchResults,
  aggregatedOntology,
  demoHorizonExample,
  onLoadHorizonExample,
  onSeedDemoPrecedents,
  onExportOntologyToExcel,
  onLoadOntology,
  onSearchPrecedents,
  showDemoButtons = true,
  isProcessing,
  isLoadingOntology,
  isExportingOntology,
  isGeneratingDraftPlan,
  isSeedingPrecedents,
  isSearchingPrecedents,
  isEnrichmentServerAvailable,
  canSearchPrecedents = true,
  smmBlockedReasons = [],
  retrievalBadge,
  precedentRetrieval,
  onSelectPrecedent
}) => {
  const [isOntologyVisible, setIsOntologyVisible] = React.useState(false)
  const hasResults = Boolean(precedentSearchResults)
  const hasPublicationResults = (precedentSearchResults?.publications?.length || 0) > 0
  const hasPlanResults = (precedentSearchResults?.content_plans?.length || 0) > 0
  const hasOntology = Boolean(aggregatedOntology?.global)
  const ontologyPreview = React.useMemo(
    () => (hasOntology ? buildOntologyPreview(aggregatedOntology) : null),
    [aggregatedOntology, hasOntology]
  )

  const handleOpenOntology = async () => {
    if (!hasOntology) {
      await onLoadOntology?.()
      setIsOntologyVisible(true)
      return
    }
    setIsOntologyVisible((prev) => !prev)
  }

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
        {showDemoButtons && (
          <>
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
              <option value="example_dev_project_saas_unfamiliar_1m">DEV: SaaS (1 месяц)</option>
              <option value="example_dev_project_edtech_unfamiliar_3m">DEV: EdTech (3 месяца)</option>
              <option value="example_dev_project_fintech_b2g_unfamiliar_6m">DEV: FinTech/B2G (6 месяцев)</option>
              <option value="example_dev_project_outsourcing_unfamiliar_1m_daily">DEV: Аутсорс/delivery (1 месяц)</option>
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
          </>
        )}
        <button
          type="button"
          className="submit-button secondary"
          onClick={handleOpenOntology}
          disabled={isProcessing || isGeneratingDraftPlan || isLoadingOntology || isEnrichmentServerAvailable === false}
          title="Показать агрегированную JSON-онтологию: сущности, классы, триплеты и иерархию"
        >
          <span>
            {isLoadingOntology
              ? 'ЗАГРУЗКА ОНТОЛОГИИ...'
              : hasOntology
                ? isOntologyVisible
                  ? 'СКРЫТЬ JSON-ОНТОЛОГИЮ'
                  : 'ПОКАЗАТЬ JSON-ОНТОЛОГИЮ'
                : 'ЗАГРУЗИТЬ JSON-ОНТОЛОГИЮ'}
          </span>
        </button>
        <button
          type="button"
          className="submit-button secondary"
          onClick={onExportOntologyToExcel}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isExportingOntology ||
            isEnrichmentServerAvailable === false
          }
          title="Скачать онтологию (классы, сущности, отношения) в Excel"
        >
          <span>{isExportingOntology ? 'ЭКСПОРТ...' : 'ЭКСПОРТ ОНТОЛОГИИ В EXCEL'}</span>
        </button>
        <button
          type="button"
          className="submit-button primary"
          onClick={onSearchPrecedents}
          disabled={
            isProcessing ||
            isGeneratingDraftPlan ||
            isSearchingPrecedents ||
            isEnrichmentServerAvailable === false ||
            !canSearchPrecedents
          }
          title={
            smmBlockedReasons.length > 0
              ? `Сначала выполните: ${smmBlockedReasons.join(', ')}`
              : 'Подобрать релевантные публикации и контент-планы'
          }
        >
          <span>{isSearchingPrecedents ? 'ПОИСК ПРЕЦЕДЕНТОВ...' : 'ПОДОБРАТЬ ПРЕЦЕДЕНТЫ'}</span>
        </button>
      </div>
      {!canSearchPrecedents && smmBlockedReasons.length > 0 && (
        <div className="precedent-empty-state precedent-empty-state-light" role="status" aria-live="polite">
          <strong>Почему кнопка неактивна:</strong> {smmBlockedReasons.join(' · ')}
        </div>
      )}

      {isOntologyVisible && (
        <div className="ontology-preview-panel">
          {!hasOntology && !isLoadingOntology && (
            <div className="precedent-empty-state precedent-empty-state-light">
              Онтология пока не загружена. Нажмите «Загрузить JSON-онтологию».
            </div>
          )}

          {hasOntology && ontologyPreview && (
            <>
              <div className="ontology-preview-header">
                <div>
                  <h3 className="precedent-section-title precedent-section-title-light">Шаг 3-6. Онтологический слой</h3>
                  <p className="ontology-preview-subtitle">
                    Ниже показана агрегированная онтология по всем контекстам: явная типизация `entity -&gt; class`,
                    триплеты `subject - predicate - object`, relation templates и иерархия терминов.
                  </p>
                </div>
              </div>

              <div className="ontology-preview-metrics">
                <div className="ontology-preview-metric">
                  <span className="ontology-preview-metric-label">Контексты</span>
                  <strong className="ontology-preview-metric-value">{ontologyPreview.summary.contexts}</strong>
                </div>
                <div className="ontology-preview-metric">
                  <span className="ontology-preview-metric-label">Классы</span>
                  <strong className="ontology-preview-metric-value">{ontologyPreview.summary.classes}</strong>
                </div>
                <div className="ontology-preview-metric">
                  <span className="ontology-preview-metric-label">Сущности</span>
                  <strong className="ontology-preview-metric-value">{ontologyPreview.summary.entities}</strong>
                </div>
                <div className="ontology-preview-metric">
                  <span className="ontology-preview-metric-label">Триплеты</span>
                  <strong className="ontology-preview-metric-value">{ontologyPreview.summary.triples}</strong>
                </div>
              </div>

              <div className="ontology-preview-grid">
                <div className="ontology-preview-card">
                  <h4 className="ontology-preview-card-title">Entity -&gt; Class</h4>
                  <div className="ontology-preview-list">
                    {ontologyPreview.entityClassRows.slice(0, ONTOLOGY_PREVIEW_LIMIT).map((item) => (
                      <div key={item.id} className="ontology-preview-item">
                        <div className="ontology-preview-item-main">{item.label}</div>
                        <div className="ontology-preview-item-meta">
                          <span>{formatOntologyClassLabel(item.classId)}</span>
                          <span>{Math.round(item.confidence * 100)}%</span>
                        </div>
                      </div>
                    ))}
                    {ontologyPreview.entityClassRows.length === 0 && (
                      <div className="ontology-preview-empty">Типизированные сущности пока не найдены.</div>
                    )}
                  </div>
                </div>

                <div className="ontology-preview-card">
                  <h4 className="ontology-preview-card-title">Triples</h4>
                  <div className="ontology-preview-list">
                    {ontologyPreview.triples.slice(0, ONTOLOGY_PREVIEW_LIMIT).map((item) => (
                      <div key={item.id} className="ontology-preview-item ontology-preview-item-triple">
                        <div className="ontology-preview-triple">
                          <span className="ontology-preview-node">{item.subject_label}</span>
                          <span className="ontology-preview-edge">{item.predicate}</span>
                          <span className="ontology-preview-node">{item.object_label}</span>
                        </div>
                        {item.evidence && <div className="ontology-preview-item-meta">{item.evidence}</div>}
                      </div>
                    ))}
                    {ontologyPreview.triples.length === 0 && (
                      <div className="ontology-preview-empty">Явные триплеты пока не сформированы.</div>
                    )}
                  </div>
                </div>

                <div className="ontology-preview-card">
                  <h4 className="ontology-preview-card-title">Hierarchy</h4>
                  <div className="ontology-preview-list">
                    {ontologyPreview.hierarchy.slice(0, ONTOLOGY_PREVIEW_LIMIT).map((item) => (
                      <div key={item.id} className="ontology-preview-item ontology-preview-item-triple">
                        <div className="ontology-preview-triple">
                          <span className="ontology-preview-node">{item.child_label}</span>
                          <span className="ontology-preview-edge">{item.predicate}</span>
                          <span className="ontology-preview-node">{item.parent_label}</span>
                        </div>
                      </div>
                    ))}
                    {ontologyPreview.hierarchy.length === 0 && (
                      <div className="ontology-preview-empty">Иерархия терминов пока не найдена.</div>
                    )}
                  </div>
                </div>

                <div className="ontology-preview-card">
                  <h4 className="ontology-preview-card-title">Relation Templates</h4>
                  <div className="ontology-preview-list">
                    {ontologyPreview.templates.slice(0, ONTOLOGY_PREVIEW_LIMIT).map((item) => (
                      <div key={item.id} className="ontology-preview-item ontology-preview-item-triple">
                        <div className="ontology-preview-triple">
                          <span className="ontology-preview-node">{formatOntologyClassLabel(item.subject_class)}</span>
                          <span className="ontology-preview-edge">{item.predicate}</span>
                          <span className="ontology-preview-node">{formatOntologyClassLabel(item.object_class)}</span>
                        </div>
                        {item.source_label && <div className="ontology-preview-item-meta">{item.source_label}</div>}
                      </div>
                    ))}
                    {ontologyPreview.templates.length === 0 && (
                      <div className="ontology-preview-empty">Шаблоны связей пока не найдены.</div>
                    )}
                  </div>
                </div>
              </div>

              {ontologyPreview.metaEntities.length > 0 && (
                <div className="ontology-preview-card ontology-preview-card-wide">
                  <h4 className="ontology-preview-card-title">Meta-entities</h4>
                  <div className="ontology-preview-tags">
                    {ontologyPreview.metaEntities.slice(0, ONTOLOGY_PREVIEW_LIMIT).map((item) => (
                      <span key={item.id} className="ontology-preview-tag">
                        {item.label} · {formatOntologyClassLabel(item.class_id)} · {item.frequency}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!hasResults && (
        <div className="precedent-empty-state precedent-empty-state-light">
          Сначала нажмите «Подобрать прецеденты».
          {precedentsSummary?.publications_count
            ? ' Поиск выполнится по уже накопленной базе.'
            : showDemoButtons
            ? ' Если база пустая — демо-прецеденты или парсинг/обогащение на шаге 1.'
            : ' Если база пустая — шаг 1 (парсинг/обогащение) или дождитесь данных с прошлых запусков.'}
        </div>
      )}

      {hasResults && (
        <>
          <div className="workflow-next-action">
            {(hasPublicationResults || hasPlanResults) && (
              <strong>Следующий шаг: сформируйте черновой план на основе найденных прецедентов.</strong>
            )}
            {!hasPublicationResults && !hasPlanResults && (
              <strong>
                Результатов нет: уточните описание проекта
                {showDemoButtons ? ' или загрузите демо-данные' : ''}.
              </strong>
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
                        {Number.isFinite(Number(item.reliability)) ? (
                          <span
                            className={`precedent-card-reliability precedent-reliability-${formatReliabilityLabel(item.reliability)?.tone || 'neutral'}`}
                            title={formatReliabilityLabel(item.reliability)?.title || 'Надёжность'}
                          >
                            {formatReliabilityLabel(item.reliability)?.label}
                          </span>
                        ) : (
                          <span className="precedent-card-score" title="Релевантность">{formatPrecedentScore(item.score)}</span>
                        )}
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
                        {Number.isFinite(Number(item.reliability)) ? (
                          <span
                            className={`precedent-card-reliability precedent-reliability-${formatReliabilityLabel(item.reliability)?.tone || 'neutral'}`}
                            title={formatReliabilityLabel(item.reliability)?.title || 'Надёжность'}
                          >
                            {formatReliabilityLabel(item.reliability)?.label}
                          </span>
                        ) : (
                          <span className="precedent-card-score" title="Релевантность">{formatPrecedentScore(item.score)}</span>
                        )}
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
                платформы и преимущества{showDemoButtons ? ' или загрузите демо-прецеденты' : ''}.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default PrecedentSearchPanel
