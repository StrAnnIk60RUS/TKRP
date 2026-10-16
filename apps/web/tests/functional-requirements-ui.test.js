/**
 * Функциональные требования табл. 2.1, которые не покрываются HTTP/Postman:
 * загрузка JSON в UI, уведомления, чек-лист готовности, карточки прецедентов,
 * упрощённый поток маркетолога, локальное хранилище снимков.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCompetitorsJsonFileContent,
  isPostAlreadyEnriched,
  buildEnrichmentDownloadPayload,
  buildEnrichmentToastMessages,
  mergeParsedCompetitorsFromUrls,
  canEnrichCompetitors,
  shouldBlockWhenBackendUnavailable
} from '../src/features/project-form/lib/competitorsPipelineUtils.js'
import {
  formatPrecedentScore,
  formatReliabilityLabel,
  renderMatchExplanation,
  buildRetrievalBadge,
  countPrecedentResults
} from '../src/features/project-form/lib/precedentPresentationUtils.js'
import {
  MARKETER_COMBINED_WORKFLOW_STEPS,
  planMarketerCombinedWorkflow,
  isGenerationBlockedByBackend,
  buildReadinessOverview
} from '../src/features/project-form/lib/workflowUiUtils.js'
import {
  buildReviewChecklist,
  buildSuggestedPrecedentQuery,
  hasPrecedentsForWorkflow,
  competitorsStepRequirementMet
} from '../src/features/project-form/ui/projectForm/formUtils.js'
import { buildRiskSummary } from '../src/features/project-form/ui/projectForm/riskSummaryUtils.js'
import { initialFormData } from '../src/features/project-form/ui/projectForm/formConfig.js'

const SAMPLE_COMPETITORS_JSON = JSON.stringify({
  competitors: [
    {
      competitor_id: 'c1',
      name: 'Test Co',
      platform: 'vk',
      posts: [{ post_id: 'p1', content: 'Hello', url: 'https://example.com/1' }]
    }
  ]
})

test('[FR-UI-1.1] parseCompetitorsJsonFileContent принимает валидный JSON конкурентов', () => {
  const data = parseCompetitorsJsonFileContent(SAMPLE_COMPETITORS_JSON)
  assert.equal(data.competitors.length, 1)
  assert.equal(data.competitors[0].competitor_id, 'c1')
})

test('[FR-UI-1.1] parseCompetitorsJsonFileContent отклоняет невалидный JSON', () => {
  assert.throws(() => parseCompetitorsJsonFileContent('{not json'), /валидным JSON/i)
  assert.throws(() => parseCompetitorsJsonFileContent('{"competitors":"x"}'), /массив competitors/i)
})

test('[FR-UI-1.2] canEnrichCompetitors и блокировка без данных', () => {
  assert.equal(canEnrichCompetitors(parseCompetitorsJsonFileContent(SAMPLE_COMPETITORS_JSON)), true)
  assert.equal(canEnrichCompetitors(null), false)
})

test('[FR-UI-1.2] isPostAlreadyEnriched определяет повторное обогащение', () => {
  assert.equal(isPostAlreadyEnriched({ topic: 't', tone: 'neutral' }), true)
  assert.equal(isPostAlreadyEnriched({ content: 'raw' }), false)
})

test('[FR-UI-1.2] buildEnrichmentToastMessages — успех и частичный успех', () => {
  const ok = buildEnrichmentToastMessages({
    success: true,
    enriched_data: { competitors: [] },
    usage: { total_tokens: 120 },
    parse_error: { partial: true }
  })
  assert.equal(ok.length, 2)
  assert.equal(ok[0].type, 'success')
  assert.equal(ok[1].type, 'warning')

  const invalid = buildEnrichmentToastMessages({
    success: false,
    enriched_data: null,
    raw_response: '{}',
    usage: null
  })
  assert.equal(invalid[0].type, 'warning')
})

test('[FR-UI-1.2] buildEnrichmentDownloadPayload — автоскачивание JSON результата', () => {
  const { dataToDownload, filename } = buildEnrichmentDownloadPayload({
    resultData: {
      enriched_data: { competitors: [{ competitor_id: 'c1', posts: [] }] },
      metadata: { partial_enrichment: false },
      usage: { total_tokens: 10 }
    },
    competitorsFileName: 'input.json'
  })
  assert.match(filename, /_enriched\.json$/)
  assert.equal(dataToDownload._metadata.success, true)
})

test('[FR-UI-1.5] mergeParsedCompetitorsFromUrls объединяет результаты парсинга', () => {
  const merged = mergeParsedCompetitorsFromUrls(
    [{ competitors: [{ competitor_id: 'a', posts: [] }] }],
    ['https://vk.com/a']
  )
  assert.equal(merged.competitors.length, 1)
  assert.equal(merged.parsing_metadata.source_type, 'urls')
})

test('[FR-UI-2.5] buildSuggestedPrecedentQuery из полей формы (RAG-запрос UI)', () => {
  const q = buildSuggestedPrecedentQuery({
    ...initialFormData,
    projectName: 'CloudApp',
    projectDescription: 'Analytics SaaS',
    platforms: ['vk'],
    consumerCategory: 'B2B'
  })
  assert.match(q, /CloudApp/)
  assert.match(q, /vk/)
})

test('[FR-UI-2.6] renderMatchExplanation и buildRetrievalBadge для embedding', () => {
  const explanation = renderMatchExplanation([], { type: 'embedding_cosine' })
  assert.match(explanation, /Поиск по смыслу/i)

  const badgeDev = buildRetrievalBadge(
    { type: 'embedding_cosine', embedding_model: 'text-embedding-3-small' },
    { isDeveloper: true }
  )
  assert.equal(badgeDev.label, 'Поиск по смыслу')

  const badgeMkt = buildRetrievalBadge({ type: 'embedding_cosine' }, { isDeveloper: false })
  assert.equal(badgeMkt.label, 'Поиск по смыслу')
})

test('[FR-UI-2.6] lexical fallback в UI', () => {
  const badge = buildRetrievalBadge({ type: 'token_overlap_fallback' }, { isDeveloper: true })
  assert.equal(badge.label, 'Поиск по ключевым словам')
  const text = renderMatchExplanation(['аналитика', 'кейс'], { type: 'token_overlap_fallback' })
  assert.match(text, /Запасной поиск по словам/)
})

test('[FR-UI-2.7] formatPrecedentScore и formatReliabilityLabel для карточек', () => {
  assert.equal(formatPrecedentScore(0.876), '88%')
  const rel = formatReliabilityLabel(0.82)
  assert.equal(rel.tone, 'success')
  assert.match(rel.label, /82%/)
})

test('[FR-UI-2.7] countPrecedentResults', () => {
  const c = countPrecedentResults({
    publications: [{ score: 0.5 }],
    content_plans: [{}, {}]
  })
  assert.equal(c.total, 3)
})

test('[FR-UI-2.9] hasPrecedentsForWorkflow и buildReviewChecklist', () => {
  const summary = { publications_count: 5, content_plans_count: 2 }
  assert.equal(hasPrecedentsForWorkflow(null, summary), true)
  assert.equal(competitorsStepRequirementMet(null, summary), true)

  const checklist = buildReviewChecklist(
    { ...initialFormData, producerName: '', projectDescription: '' },
    null,
    null,
    null,
    summary
  )
  const byId = Object.fromEntries(checklist.map((item) => [item.id, item.done]))
  assert.equal(byId.competitors, true)
  assert.equal(byId.precedents, true)
  assert.equal(byId.required_fields, false)
})

test('[FR-UI-2.10] buildReadinessOverview — блок готовности (рис. 2.5)', () => {
  const overview = buildReadinessOverview({
    filledRequired: 8,
    requiredCount: 10,
    competitorsCount: 2,
    precedentsSummary: { publications_count: 10, content_plans_count: 3 },
    hasDraftPlan: false,
    hasOptimizedPlan: false
  })
  assert.match(overview.dataLine, /8\/10/)
  assert.match(overview.dataLine, /13 прец/)
  assert.equal(overview.statusLine, 'Ожидает')
})

test('[FR-UI-2.10] buildRiskSummary — сводка рисков', () => {
  const pubs = Array.from({ length: 12 }, (_, _i) => ({
    format: 'text',
    objective: 'inform',
    tone: 'neutral',
    expected_kpi: { engagement_rate: 0.01 }
  }))
  const risks = buildRiskSummary({
    publications: pubs,
    planning_horizon: { start_date: '2026-01-01', end_date: '2026-06-01' }
  })
  assert.ok(risks.some((r) => r.id === 'low_diversity' || r.id === 'funnel_gap'))
})

test('[FR-UI-3.9] упрощённый поток маркетолога: сначала поиск, затем генерация', () => {
  assert.deepEqual(MARKETER_COMBINED_WORKFLOW_STEPS, ['searchPrecedents', 'generateDraftPlan'])

  const blocked = planMarketerCombinedWorkflow({ searchCompleted: false })
  assert.deepEqual(blocked.steps, ['searchPrecedents'])
  assert.equal(blocked.blocked, 'generateDraftPlan')

  const ok = planMarketerCombinedWorkflow({ searchCompleted: true })
  assert.equal(ok.blocked, null)
  assert.deepEqual(ok.steps, MARKETER_COMBINED_WORKFLOW_STEPS)
})

test('[FR-UI-4] shouldBlockWhenBackendUnavailable / isGenerationBlockedByBackend', () => {
  assert.equal(shouldBlockWhenBackendUnavailable(false), true)
  assert.equal(shouldBlockWhenBackendUnavailable(true), false)
  assert.equal(isGenerationBlockedByBackend(false), true)
  assert.equal(isGenerationBlockedByBackend(null), false)
})

test('[FR-UI-5] buildEnrichmentDownloadPayload сохраняет notes в метаданных ошибки', () => {
  const { dataToDownload, filename } = buildEnrichmentDownloadPayload({
    errorData: { error: 'network', timestamp: '2026-01-01' },
    competitorsData: { competitors: [] },
    competitorsFileName: 'data.json'
  })
  assert.match(filename, /enrichment_ERROR/)
  assert.equal(dataToDownload.error, 'network')
})

test('[FR-UI-6] buildReviewChecklist: черновик отмечен выполненным', () => {
  const filledForm = {
    ...initialFormData,
    producerName: 'ООО Тест',
    producerActivitySpecification: 'Разработка ПО для аналитики',
    projectName: 'Demo',
    projectDescription: 'Описание проекта не короче двадцати символов.',
    consumerCategory: 'B2B',
    contentPlanStartDate: '2030-01-01',
    contentPlanEndDate: '2030-06-01',
    publicationFrequency: 'weekly',
    contentFormats: ['text'],
    platforms: ['vk']
  }
  const checklist = buildReviewChecklist(
    filledForm,
    parseCompetitorsJsonFileContent(SAMPLE_COMPETITORS_JSON),
    { publications: [{}], content_plans: [] },
    { draft: { draft_content_plan: { plan_id: 'p1', publications: [{ publication_id: '1' }] } } },
    { publications_count: 1, content_plans_count: 0 }
  )
  const done = Object.fromEntries(checklist.map((c) => [c.id, c.done]))
  assert.equal(done.required_fields, true)
  assert.equal(done.competitors, true)
  assert.equal(done.precedents, true)
  assert.equal(done.draft, true)
})
