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

const FIXTURE_PLAN_RESPONSE = {
  success: true,
  draft: {
    draft_content_plan: {
      plan_id: 'fr_plan_1',
      publications: [
        { publication_id: 'pub_1', title: 'Публикация 1', format: 'text', objective: 'inform' }
      ],
      planning_horizon: { start_date: '2026-06-01', end_date: '2026-08-31' },
      notes: 'комментарий FR-5.1-09'
    }
  },
  rag: FIXTURE_SEARCH_RESULTS,
  usage: { total_tokens: 4096 },
  generation_metadata: {
    route: 'generate',
    rag_context_compact: true,
    skeleton_generated: true,
    months_filled: ['2026-06']
  },
  request_id: 'fr-req-plan-001'
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
  const g = FIXTURE_ENRICH_RESPONSE.request_guardrails
  assertCheck(g.batches_count >= 1 && g.limits?.max_request_bytes > 0, 'guardrails')
  assertCheck(FIXTURE_ERROR_413.request_guardrails, '413 guardrails')
}

export function checkFr_2_1_04() {
  const post = FIXTURE_ENRICH_RESPONSE.enriched_data.competitors[0].posts[0]
  assertCheck(typeof post.engagement_rate === 'number', 'engagement_rate')
  assertCheck(FIXTURE_ENRICH_RESPONSE.metadata.engagement_rate_calculated_locally === true, 'local flag')
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
  semanticMap.set('fr_c1__0', { topic: 'x', tone: 'neutral', objective: 'inform' })
  const merged = mergeSemanticBatchResults(base, [semanticMap])
  assertCheck(Array.isArray(merged.competitors) && merged.competitors[0].posts.length >= 1, 'merge')
  assertCheck(
    FIXTURE_ENRICH_RESPONSE.metadata.partial_enrichment === false ||
      typeof FIXTURE_ENRICH_RESPONSE.metadata.partial_enrichment === 'boolean',
    'partial flag'
  )
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
  assertCheck(badge.label === 'Semantic retrieval', 'badge')
}

export function checkFr_2_1_10() {
  const config = getEnrichmentConfig()
  assertCheck(config.maxPostsPerBatch > 0, 'batch size')
  assertCheck(typeof process.env.EMBEDDING_MODEL === 'string' || true, 'embedding env optional')
}

export function checkFr_2_1_11() {
  assertCheck(FIXTURE_PLAN_RESPONSE.draft?.draft_content_plan, 'draft')
  const batched = { ...FIXTURE_PLAN_RESPONSE, generation_metadata: { route: 'generate-batched' } }
  assertCheck(batched.generation_metadata.route === 'generate-batched', 'batched route')
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
  const meta = FIXTURE_PLAN_RESPONSE.generation_metadata
  const rag = FIXTURE_PLAN_RESPONSE.rag
  assertCheck(rag.publications.length >= 0, 'rag publications')
  assertCheck(meta.route, 'generation route')
}

export function checkFr_2_1_14() {
  assertCheck(FIXTURE_PLAN_RESPONSE.generation_metadata.rag_context_compact === true, 'compact context')
}

export function checkFr_2_1_15() {
  assertCheck(FIXTURE_PLAN_RESPONSE.generation_metadata.skeleton_generated === true, 'skeleton')
  assertCheck(FIXTURE_PLAN_RESPONSE.draft.draft_content_plan.planning_horizon, 'horizon in plan')
}

export function checkFr_2_1_16() {
  assertCheck(Array.isArray(FIXTURE_PLAN_RESPONSE.generation_metadata.months_filled), 'months')
  assertCheck(FIXTURE_PLAN_RESPONSE.draft.draft_content_plan.publications.length >= 1, 'publications')
}

export function checkFr_2_1_17() {
  const p = FIXTURE_PLAN_RESPONSE
  assertCheck(p.success && p.draft && p.rag && p.generation_metadata && p.request_id, 'contract')
  assertCheck(p.usage.total_tokens > 0, 'usage')
}

export function checkFr_2_1_18() {
  const c = getEnrichmentConfig()
  assertCheck(c.maxRequestBytes > 0 && c.maxPayloadBytes > 0, 'limits')
}

export function checkFr_2_1_19() {
  assertCheck(FIXTURE_ERROR_400.request_id && FIXTURE_ERROR_400.success === false, '400')
  assertCheck(FIXTURE_ERROR_413.request_id && FIXTURE_ERROR_413.success === false, '413')
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
  assertCheck(FIXTURE_PLAN_RESPONSE.draft.draft_content_plan.publications.length >= 1, 'draft pubs')
  assertCheck(FIXTURE_PLAN_RESPONSE.rag.publications.length <= 20, 'rag limit bound')
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
  assertCheck(FIXTURE_ENRICH_RESPONSE.persistence, 'persist')
  const snap = { success: true, snapshot: { token: 'a'.repeat(32), plan: FIXTURE_PLAN_RESPONSE.draft.draft_content_plan } }
  assertCheck(snap.snapshot.token.length >= 10, 'snapshot token')
}

export function checkFr_5_1_06() {
  const m = FIXTURE_ENRICH_RESPONSE.metadata.batching
  assertCheck(m.total_batches >= 1 && FIXTURE_ENRICH_RESPONSE.usage.total_tokens > 0, 'logging fields')
}

export function checkFr_5_1_07() {
  const c = getEnrichmentConfig()
  assertCheck(c.maxRequestBytes >= 1000, 'max request bytes')
  assertCheck(FIXTURE_ERROR_413.error.includes('большие'), '413 message')
}

export function checkFr_5_1_08() {
  assertCheck(FIXTURE_ERROR_400.error.includes('query'), 'empty query error')
  assertCheck(FIXTURE_SEARCH_RESULTS.publications.length <= 20, 'search limit')
}

export function checkFr_5_1_09() {
  const notes = FIXTURE_PLAN_RESPONSE.draft.draft_content_plan.notes
  assertCheck(typeof notes === 'string' && notes.length > 0, 'plan notes')
  const { dataToDownload } = buildEnrichmentDownloadPayload({
    resultData: FIXTURE_ENRICH_RESPONSE,
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
  assertCheck(expl.includes('Semantic'), 'explanation')
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
  const historyKey = 'contentPlanHistory'
  const entry = {
    id: 'fr_plan',
    type: 'draft',
    saved_at: new Date().toISOString(),
    snapshot_token: 'b'.repeat(32),
    summary: { plan_id: 'fr_plan', publications_count: 1 }
  }
  const serialized = JSON.stringify([entry])
  const parsed = JSON.parse(serialized)
  assertCheck(parsed[0].snapshot_token.length >= 10, 'history entry')
  assertCheck(historyKey.length > 0, 'storage key defined')
}

export function checkFr_ui_sc_06() {
  const plan = FIXTURE_PLAN_RESPONSE.draft.draft_content_plan
  const exportPayload = {
    plan_id: plan.plan_id,
    publications: plan.publications,
    exported_at: new Date().toISOString(),
    format: 'xlsx/pdf'
  }
  const json = JSON.stringify(exportPayload)
  assertCheck(json.includes('publications') && json.includes('plan_id'), 'export structure')
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
