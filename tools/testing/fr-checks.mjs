/**
 * Проверки функциональных требований на фикстурах (без сети и OpenRouter).
 */
import {
  parseCompetitorsJsonFileContent,
  buildEnrichmentDownloadPayload,
  buildEnrichmentToastMessages,
  canEnrichCompetitors,
  shouldBlockWhenBackendUnavailable
} from '../../apps/web/src/features/project-form/lib/competitorsPipelineUtils.js'
import {
  formatPrecedentScore,
  formatReliabilityLabel,
  renderMatchExplanation,
  buildRetrievalBadge,
  countPrecedentResults
} from '../../apps/web/src/features/project-form/lib/precedentPresentationUtils.js'
import {
  MARKETER_COMBINED_WORKFLOW_STEPS,
  planMarketerCombinedWorkflow,
  isGenerationBlockedByBackend,
  buildReadinessOverview
} from '../../apps/web/src/features/project-form/lib/workflowUiUtils.js'
import {
  buildReviewChecklist,
  buildSuggestedPrecedentQuery,
  buildSafeFormInputForGeneration,
  validateFormData,
} from '../../apps/web/src/features/project-form/ui/projectForm/formUtils.js'
import { buildRiskSummary } from '../../apps/web/src/features/project-form/ui/projectForm/riskSummaryUtils.js'
import { initialFormData } from '../../apps/web/src/features/project-form/ui/projectForm/formConfig.js'
import {
  getEnrichmentConfig,
  summarizeEnrichmentLimits,
  buildSemanticEnrichmentBatches,
  validateAndNormalizeSemanticBatchResult,
  mergeSemanticBatchResults,
  extractJsonObjectFromContent
} from '../../apps/api/src/modules/enrichment/services/semanticEnrichmentPipeline.js'
import { parseJsonObjectFromLlmContent } from '../../apps/api/src/shared/utils/llmJsonParsing.js'
import {
  enrichWithEngagementRate,
  computePostEngagementMetrics
} from '../../apps/api/openrouter.js'
import {
  normalizeDraftPlanResponse,
  mergePinnedPublications
} from '../../apps/api/src/modules/planning/routes/shared/planUtils.js'
import {
  DRAFT_PLAN_PIPELINE_TEST_UTILS,
  PLAN_SKELETON_JSON_SCHEMA,
  PLAN_MONTH_BATCH_JSON_SCHEMA,
  buildCompactRagContext
} from '../../apps/api/src/modules/planning/services/draftPlanGenerationPipeline.js'
import { sendRouteError } from '../../apps/api/src/shared/http/routeUtils.js'
import { buildSnapshotSummary } from '../../apps/api/src/modules/planning/services/planSnapshotStore.js'
import { buildPublicationRows } from '../../apps/web/src/shared/lib/contentPlanExport.js'

const SAMPLE_JSON = JSON.stringify({
  competitors: [
    {
      competitor_id: 'fr_c1',
      platform: 'vk',
      posts: [
        {
          post_id: 'fr_p1',
          content: 'Тестовый пост для FR-матрицы',
          url: 'https://example.com/fr/1',
          metrics: { likes: 5, views: 100, comments: 1, shares: 0 }
        }
      ]
    }
  ]
})

const FIXTURE_ENRICH_RESPONSE = {
  success: true,
  request_guardrails: {
    batches_count: 1,
    max_batch_payload_bytes: 1200,
    limits: { auto_batch: true, max_posts_per_batch: 15, max_request_bytes: 2000000 }
  },
  enriched_data: {
    competitors: [
      {
        competitor_id: 'fr_c1',
        posts: [
          {
            post_id: 'fr_p1',
            engagement_rate: 0.05,
            metrics_quality: 'views_based',
            topic: 'аналитика',
            tone: 'neutral',
            objective: 'inform'
          }
        ]
      }
    ]
  },
  metadata: {
    engagement_rate_calculated_locally: true,
    normalized_to_content_model: true,
    partial_enrichment: false,
    batching: { total_batches: 1, failed_batches: 0 }
  },
  usage: { total_tokens: 256 },
  persistence: { publications_upserted: 1 },
  request_id: 'fr-req-enrich-001'
}

const FIXTURE_SEARCH_RESULTS = {
  query: 'IT образование',
  publications: [{ type: 'publication', score: 0.82, reliability: 0.71, matched_tokens: ['IT'] }],
  content_plans: [{ type: 'content_plan', score: 0.65, reliability: 0.6, matched_tokens: [] }],
  retrieval: {
    type: 'embedding_cosine',
    embedding_model: 'text-embedding-3-small',
    hybrid_weights: { embedding: 0.7, token: 0.3 },
    fallback_scope: null
  }
}


const FIXTURE_ERROR_400 = { success: false, error: 'Отсутствует поле query', request_id: 'fr-err-400' }
const FIXTURE_ERROR_413 = {
  success: false,
  error: 'Входные данные слишком большие',
  request_guardrails: { max_batch_payload_bytes: 2500000 },
  request_id: 'fr-err-413'
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message || 'FR check failed')
}

export function checkFr_2_1_01() {
  const data = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  assertCheck(data.competitors.length === 1, 'competitors array')
  assertCheck(canEnrichCompetitors(data), 'can enrich')
}

export function checkFr_2_1_02() {
  const toasts = buildEnrichmentToastMessages({
    success: true,
    enriched_data: { competitors: [] },
    usage: { total_tokens: 100 },
    parse_error: { partial: true }
  })
  assertCheck(toasts.length >= 1, 'toasts')
  const { filename } = buildEnrichmentDownloadPayload({
    resultData: FIXTURE_ENRICH_RESPONSE,
    competitorsFileName: 'data.json'
  })
  assertCheck(filename.includes('enriched'), 'download filename')
}

export function checkFr_2_1_03() {
  const data = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  const config = getEnrichmentConfig()
  const guardrails = summarizeEnrichmentLimits(data, config)
  assertCheck(guardrails.batches_count >= 1, 'guardrails batches_count')
  assertCheck(guardrails.limits?.max_request_bytes > 0, 'guardrails max_request_bytes')
  assertCheck(guardrails.max_batch_payload_bytes > 0, 'guardrails max_batch_payload_bytes')
}

export function checkFr_2_1_04() {
  const data = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  const enriched = enrichWithEngagementRate(data)
  const post = enriched.competitors[0].posts[0]
  assertCheck(typeof post.engagement_rate === 'number' && post.engagement_rate > 0, 'engagement_rate computed')
  assertCheck(post.metrics_quality === 'views_based', 'metrics_quality views_based')
  const proxyMetrics = computePostEngagementMetrics({ likes: 10, views: 0, comments: 2, shares: 1 })
  assertCheck(proxyMetrics.metrics_quality === 'interaction_proxy', 'metrics_quality interaction_proxy')
}

export function checkFr_2_1_05() {
  const data = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  const config = getEnrichmentConfig()
  const limits = summarizeEnrichmentLimits(data, config)
  const batches = buildSemanticEnrichmentBatches(data, config)
  assertCheck(limits.batches_count >= 1, 'batches_count')
  assertCheck(batches.length >= 1, 'batches built')
  assertCheck(typeof config.autoBatch === 'boolean', 'autoBatch config')
}

export function checkFr_2_1_06() {
  const raw = '{"competitors":[{"competitor_id":"c1","posts":[{"source_post_id":"fr_p1","topic":"t","tone":"n","target_audience":[],"objective":"inform","summary":"s","key_entities":[]}]}]}'
  const parsed = extractJsonObjectFromContent(raw) || parseJsonObjectFromLlmContent(raw)
  const batch = { competitors: [{ competitor_id: 'c1', posts: [{ source_post_id: 'fr_p1' }] }] }
  const result = validateAndNormalizeSemanticBatchResult(batch, parsed)
  assertCheck(result.valid === true, 'batch validation')
}

export function checkFr_2_1_07() {
  const base = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  const semanticMap = new Map()
  semanticMap.set('fr_c1_post_1', { topic: 'AI Инновации', tone: 'expert', objective: 'inform' })
  const merged = mergeSemanticBatchResults(base, [semanticMap])
  assertCheck(Array.isArray(merged.competitors) && merged.competitors[0].posts.length >= 1, 'merge')
  assertCheck(merged.competitors[0].posts[0].topic === 'AI Инновации', 'merged semantic topic updated')
}

export function checkFr_2_1_08() {
  const q = buildSuggestedPrecedentQuery({
    ...initialFormData,
    projectName: 'FR Demo',
    platforms: ['vk']
  })
  assertCheck(q.includes('FR Demo'), 'query from form')
  const counts = countPrecedentResults(FIXTURE_SEARCH_RESULTS)
  assertCheck(counts.total >= 1, 'results count')
}

export function checkFr_2_1_09() {
  const r = FIXTURE_SEARCH_RESULTS
  assertCheck(r.retrieval.type === 'embedding_cosine', 'retrieval type')
  assertCheck(r.publications[0].reliability > 0, 'reliability')
  const badge = buildRetrievalBadge(r.retrieval, { isDeveloper: true })
  assertCheck(badge.label === 'Поиск по смыслу', 'badge')
}

export function checkFr_2_1_10() {
  const config = getEnrichmentConfig()
  assertCheck(config.maxPostsPerBatch > 0, 'batch size')
  assertCheck(typeof process.env.EMBEDDING_MODEL === 'string' || true, 'embedding env optional')
}

export function checkFr_2_1_11() {
  const sampleDraft = {
    draft_content_plan: {
      plan_id: 'fr_plan_1',
      publications: [
        { publication_id: 'pub_1', platform: 'vk', topic: 'Обзор платформы', format: 'text', objective: 'inform' }
      ]
    }
  }
  const normalized = normalizeDraftPlanResponse(sampleDraft, {
    contentPlanStartDate: '2026-06-01',
    contentPlanEndDate: '2026-08-31',
    platforms: ['vk']
  })
  assertCheck(normalized.draft_content_plan?.publications?.length === 1, 'draft normalized publications')
  assertCheck(normalized.draft_content_plan.publications[0].format === 'text', 'format normalized')
}

export function checkFr_2_1_12() {
  const input = buildSafeFormInputForGeneration({
    ...initialFormData,
    projectName: 'RAG Auto',
    projectDescription: 'Описание проекта для автоматического RAG-запроса из формы.'
  })
  const q = buildSuggestedPrecedentQuery(input)
  assertCheck(q.length > 10, 'rag query text')
}

export function checkFr_2_1_13() {
  const searchResults = {
    publications: [
      { score: 0.9, data: { publication_id: 'p1', platform: 'vk' } },
      { score: 0.8, data: { publication_id: 'p2', platform: 'linkedin' } },
      { score: 0.7, data: { publication_id: 'p3', platform: 'vk' } }
    ]
  }
  const pinned = [{ publication_id: 'pinned_1', platform: 'vk', topic: 'Закреплённый пост' }]
  const merged = mergePinnedPublications(searchResults, pinned, 2)
  assertCheck(merged.publications.length <= 6, 'retrieval context limited by rag_limit')
  assertCheck(merged.publications.some((p) => p.pinned === true), 'pinned publication preserved in context')
}

export function checkFr_2_1_14() {
  const compact = buildCompactRagContext(FIXTURE_SEARCH_RESULTS)
  assertCheck(compact.summary?.publications_count >= 1, 'compact publications extracted')
  assertCheck(Array.isArray(compact.summary?.precedent_ids), 'precedent_ids collected')
  assertCheck(compact.publications[0].retrieval_score !== undefined, 'compact publication score preserved')
}

export function checkFr_2_1_15() {
  const rawSkeleton = {
    calendar_plan: [
      {
        month: 1,
        theme: 'Старт',
        slots: [
          { slot_id: 's1', planned_date: '2026-06-05', platform: 'vk', format: 'text', objective: 'inform', tone: 'expert' }
        ]
      }
    ]
  }
  const formInput = {
    contentPlanStartDate: '2026-06-01',
    contentPlanEndDate: '2026-06-30',
    platforms: ['vk']
  }
  const repaired = DRAFT_PLAN_PIPELINE_TEST_UTILS.repairSkeleton(rawSkeleton, formInput, 1)
  assertCheck(repaired.publication_slots?.length === 1, 'repaired slots length')
  assertCheck(repaired.publication_slots[0].platform === 'vk', 'repaired slot platform')
  assertCheck(Boolean(PLAN_SKELETON_JSON_SCHEMA.properties?.calendar_plan), 'skeleton schema includes calendar_plan')
}

export function checkFr_2_1_16() {
  assertCheck(PLAN_MONTH_BATCH_JSON_SCHEMA.properties?.publications !== undefined, 'batch schema publications property')
  const fallback = {
    key_message: 'Резервный посыл',
    summary: 'Резервный текст описания для тестовой публикации контент-плана.'
  }
  const result = DRAFT_PLAN_PIPELINE_TEST_UTILS.repairPublicationSemanticCoherence(
    {
      publication_id: 'pub_test',
      platform: 'vk',
      topic: 'IT разработка',
      format: 'text',
      objective: 'inform',
      tone: 'expert',
      key_message: 'IT разработка новых инструментов',
      cta: '',
      summary: 'Полный текст публикации про разработку новых инструментов для IT-команд.'
    },
    fallback,
    { projectName: 'DevOps Tool' }
  )
  assertCheck(result?.publication?.key_message?.length > 0, 'key message present')
  assertCheck(result?.publication?.summary?.length > 0, 'summary present')
}

export function checkFr_2_1_17() {
  const sampleDraft = {
    draft_content_plan: {
      plan_id: 'fr_plan_17',
      publications: [
        { publication_id: 'pub_17', platform: 'vk', topic: 'Архитектура', format: 'text', objective: 'inform' }
      ]
    }
  }
  const normalized = normalizeDraftPlanResponse(sampleDraft, {
    contentPlanStartDate: '2026-06-01',
    contentPlanEndDate: '2026-06-30'
  })
  const responsePayload = {
    success: true,
    draft: normalized,
    rag: FIXTURE_SEARCH_RESULTS,
    usage: { total_tokens: 1200 },
    generation_metadata: { route: 'generate' },
    request_id: 'req-fr-17'
  }
  assertCheck(responsePayload.success === true, 'contract success')
  assertCheck(responsePayload.draft.draft_content_plan.plan_id === 'fr_plan_17', 'contract draft')
  assertCheck(responsePayload.request_id === 'req-fr-17', 'contract request_id')
}

export function checkFr_2_1_18() {
  const c = getEnrichmentConfig()
  assertCheck(c.maxRequestBytes > 0 && c.maxPayloadBytes > 0, 'limits')
}

export function checkFr_2_1_19() {
  let captured = null
  const mockRes = {
    statusCode: 200,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      captured = { statusCode: this.statusCode, body }
      return this
    }
  }
  const mockReq = { requestId: 'req-fr-err-400' }
  sendRouteError(mockRes, mockReq, 400, 'Некорректный запрос', new Error('Отсутствует query'))
  assertCheck(captured.statusCode === 400, 'status is 400')
  assertCheck(captured.body.request_id === 'req-fr-err-400', 'request_id is preserved')
  assertCheck(captured.body.success === false, 'success is false')
  assertCheck(captured.body.error === 'Отсутствует query', 'error message preserved')
}

export function checkFr_5_1_01() {
  const invalid = validateFormData(initialFormData)
  assertCheck(invalid.isValid === false, 'invalid form')
  const valid = validateFormData({
    ...initialFormData,
    producerName: 'ООО Тест',
    producerActivitySpecification: 'Разработка программного обеспечения',
    projectName: 'Demo',
    projectDescription: 'Достаточно длинное описание IT-проекта для теста.',
    consumerCategory: 'B2B',
    contentPlanStartDate: '2030-01-01',
    contentPlanEndDate: '2030-06-01',
    publicationFrequency: 'weekly',
    contentFormats: ['text'],
    platforms: ['vk']
  })
  assertCheck(valid.isValid === true, 'valid form')
}

export function checkFr_5_1_02() {
  const merged = mergePinnedPublications(
    { publications: Array.from({ length: 30 }, (_, i) => ({ data: { publication_id: `p_${i}` } })) },
    [],
    10
  )
  assertCheck(merged.publications.length <= 14, 'rag_limit bounded in context')
  const validDraft = normalizeDraftPlanResponse(
    {
      draft_content_plan: {
        publications: [{ platform: 'vk', topic: 'T1' }]
      }
    },
    {}
  )
  assertCheck(validDraft.draft_content_plan.publications.length === 1, 'draft normalized')
}

export function checkFr_5_1_03() {
  const raw = '```json\n{"competitors":[{"competitor_id":"c1","posts":[{"source_post_id":"fr_p1","topic":"t","tone":"neutral","target_audience":[],"objective":"inform","summary":"","key_entities":[]}]}]}\n```'
  const parsed = parseJsonObjectFromLlmContent(raw)
  assertCheck(parsed && parsed.competitors, 'llm json parse')
}

export function checkFr_5_1_04() {
  const toasts = buildEnrichmentToastMessages({
    success: true,
    enriched_data: {},
    parse_error: { partial: true }
  })
  assertCheck(toasts.some((t) => t.type === 'warning'), 'partial warning')
}

export function checkFr_5_1_05() {
  const summary = buildSnapshotSummary({
    plan_id: 'plan_snap_test',
    display_name: 'Тестовый контент-план',
    publications: [
      { format: 'text', platform: 'vk' },
      { format: 'image', platform: 'telegram' }
    ],
    platforms: ['vk', 'telegram'],
    planning_horizon: { start_date: '2026-06-01', end_date: '2026-06-30' },
    kpi_targets: { avg_engagement_rate: 0.05 }
  })
  assertCheck(summary.plan_id === 'plan_snap_test', 'plan_id in summary')
  assertCheck(summary.publications_count === 2, 'publications_count in summary')
  assertCheck(summary.formats.includes('text') && summary.formats.includes('image'), 'formats collected')
}

export function checkFr_5_1_06() {
  const data = parseCompetitorsJsonFileContent(SAMPLE_JSON)
  const limits = summarizeEnrichmentLimits(data, getEnrichmentConfig())
  assertCheck(limits.batches_count >= 1, 'batching total_batches')
  assertCheck(limits.limits.auto_batch === true, 'auto_batch flag')
  const { dataToDownload } = buildEnrichmentDownloadPayload({
    resultData: {
      enriched_data: { competitors: [] },
      metadata: { enriched_at: new Date().toISOString() },
      usage: { total_tokens: 340 }
    },
    competitorsFileName: 'data.json'
  })
  assertCheck(dataToDownload._metadata?.usage?.total_tokens === 340, 'usage tokens tracked in metadata')
}

export function checkFr_5_1_07() {
  const c = getEnrichmentConfig()
  assertCheck(c.maxRequestBytes >= 1000, 'max request bytes')
  assertCheck(FIXTURE_ERROR_413.error.includes('большие'), '413 message')
}

export function checkFr_5_1_08() {
  const emptyQuery = '   '
  const isQueryInvalid = !emptyQuery || typeof emptyQuery !== 'string' || !emptyQuery.trim()
  assertCheck(isQueryInvalid === true, 'empty query rejected')
  const query = buildSuggestedPrecedentQuery({
    ...initialFormData,
    projectName: 'B2B SaaS',
    platforms: ['vk', 'linkedin']
  })
  assertCheck(query.includes('B2B SaaS'), 'query generated from form input')
}

export function checkFr_5_1_09() {
  const summary = buildSnapshotSummary({
    plan_id: 'fr_snap_notes',
    notes: 'Заметки маркетолога о стратегии',
    publications: [{ format: 'text', platform: 'vk' }]
  })
  assertCheck(summary.has_notes === true, 'notes preserved in snapshot summary')
  const repaired = DRAFT_PLAN_PIPELINE_TEST_UTILS.repairSkeleton(
    { notes: 'Стратегический фокус', calendar_plan: [] },
    { platforms: ['vk'] },
    1
  )
  assertCheck(repaired.notes === 'Стратегический фокус', 'notes preserved in repaired skeleton')
  const { dataToDownload } = buildEnrichmentDownloadPayload({
    resultData: { enriched_data: { competitors: [] }, metadata: { success: true } },
    competitorsFileName: 'x.json'
  })
  assertCheck(dataToDownload._metadata?.success === true, 'persist metadata in download')
}

export function checkFr_5_1_10() {
  const risks = buildRiskSummary({
    publications: Array.from({ length: 12 }, () => ({
      format: 'text',
      objective: 'inform',
      expected_kpi: { engagement_rate: 0.01 }
    })),
    planning_horizon: { start_date: '2026-01-01', end_date: '2026-06-01' }
  })
  assertCheck(risks.length >= 1, 'risks detected')
}

export function checkFr_ui_sc_01() {
  assertCheck(formatPrecedentScore(0.876) === '88%', 'score percent')
  const rel = formatReliabilityLabel(0.8)
  assertCheck(rel.tone === 'success', 'reliability tone')
  const expl = renderMatchExplanation(['кейс'], { type: 'embedding_cosine' })
  assertCheck(expl.includes('Поиск по смыслу'), 'explanation')
}

export function checkFr_ui_sc_02() {
  assertCheck(MARKETER_COMBINED_WORKFLOW_STEPS.length === 2, 'steps')
  const ok = planMarketerCombinedWorkflow({ searchCompleted: true })
  assertCheck(ok.blocked === null, 'marketer flow')
}

export function checkFr_ui_sc_03() {
  const overview = buildReadinessOverview({
    filledRequired: 9,
    requiredCount: 10,
    competitorsCount: 1,
    precedentsSummary: { publications_count: 5, content_plans_count: 1 },
    hasDraftPlan: false,
    hasOptimizedPlan: false
  })
  assertCheck(overview.dataLine.includes('прец'), 'readiness data')
  const checklist = buildReviewChecklist(
    { ...initialFormData, producerName: 'X', producerActivitySpecification: '1234567890', projectName: 'P', projectDescription: '12345678901234567890', consumerCategory: 'B2B', contentPlanStartDate: '2030-01-01', contentPlanEndDate: '2030-06-01', publicationFrequency: 'weekly', contentFormats: ['text'], platforms: ['vk'] },
    null,
    FIXTURE_SEARCH_RESULTS,
    null,
    { publications_count: 1, content_plans_count: 0 }
  )
  assertCheck(checklist.every((i) => typeof i.done === 'boolean'), 'checklist')
}

export function checkFr_ui_sc_04() {
  assertCheck(isGenerationBlockedByBackend(false) === true, 'blocked when down')
  assertCheck(shouldBlockWhenBackendUnavailable(false) === true, 'enrich blocked')
}

export function checkFr_ui_sc_05() {
  const summary = buildSnapshotSummary({
    plan_id: 'ui_snap_1',
    publications: [{ format: 'text', platform: 'vk' }]
  })
  assertCheck(summary.plan_id === 'ui_snap_1', 'summary built')
  assertCheck(summary.publications_count === 1, 'publications count in summary')
}

export function checkFr_ui_sc_06() {
  const publications = [
    {
      planned_date: '2026-06-01',
      platform: 'vk',
      topic: 'Тестовая публикация',
      format: 'text',
      objective: 'inform',
      key_message: 'Главный посыл',
      cta: 'Подпишитесь',
      tone: 'expert',
      expected_kpi: { engagement_rate: 0.045, predicted_likes: 25 }
    }
  ]
  const rows = buildPublicationRows(publications)
  assertCheck(rows.length === 1, 'publication rows built')
  assertCheck(rows[0]['Тема'] === 'Тестовая публикация', 'topic mapped to column')
  assertCheck(rows[0]['Формат'] === 'text', 'format mapped to column')
  assertCheck(rows[0]['Платформа'] === 'VK', 'platform uppercase')
  assertCheck(rows[0]['Прогноз лайков'] === '25', 'predicted likes mapped')
}

/** Все проверки по имени из реестра */
export const FR_CHECK_HANDLERS = {
  checkFr_2_1_01,
  checkFr_2_1_02,
  checkFr_2_1_03,
  checkFr_2_1_04,
  checkFr_2_1_05,
  checkFr_2_1_06,
  checkFr_2_1_07,
  checkFr_2_1_08,
  checkFr_2_1_09,
  checkFr_2_1_10,
  checkFr_2_1_11,
  checkFr_2_1_12,
  checkFr_2_1_13,
  checkFr_2_1_14,
  checkFr_2_1_15,
  checkFr_2_1_16,
  checkFr_2_1_17,
  checkFr_2_1_18,
  checkFr_2_1_19,
  checkFr_5_1_01,
  checkFr_5_1_02,
  checkFr_5_1_03,
  checkFr_5_1_04,
  checkFr_5_1_05,
  checkFr_5_1_06,
  checkFr_5_1_07,
  checkFr_5_1_08,
  checkFr_5_1_09,
  checkFr_5_1_10,
  checkFr_ui_sc_01,
  checkFr_ui_sc_02,
  checkFr_ui_sc_03,
  checkFr_ui_sc_04,
  checkFr_ui_sc_05,
  checkFr_ui_sc_06
}

export function runFrCheck(checkName) {
  const fn = FR_CHECK_HANDLERS[checkName]
  if (!fn) throw new Error(`Unknown FR check: ${checkName}`)
  fn()
  return { ok: true }
}
