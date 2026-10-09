# LLM caching, rollback guard, pipeline error handling

Session plan for "General Improvements" task. Keep this file updated (check boxes + STATUS line) so a next agent can resume after context loss.

## Scope (agreed)

Relevant files (verified paths):

- `apps/api/openrouter.js` — single LLM choke point `callOpenRouterChat` (already has an inline unconditional cache; refactor to shared module).
- `apps/api/src/shared/utils/llmCache.js` — NEW shared TTL LRU cache.
- `apps/api/src/shared/utils/pipelineErrorHandler.js` — NEW shared error/retry/fallback helper.
- `apps/api/src/shared/utils/jsonSchemaValidator.js` — NEW minimal JSON-schema validator (no Ajv: repo rule "no new dependencies unless essential"; ajv not installed).
- `apps/api/src/modules/planning/services/planDiversityLlmPass.js` — add fitness-guard rollback (reason `'rollback'`).
- `apps/api/src/modules/planning/services/evolutionary/hierarchicalGa.js` — already has an external guard (`reverted_fitness_decreased`); move guard INTO planDiversityLlmPass via `options.fitnessGuard`, keep meta shape, reason becomes `'rollback'`.
- `apps/api/src/modules/planning/services/draftPlanGenerationPipeline.js` — retry/validation via pipelineErrorHandler at `generateSkeleton` / `generateMonthlyPublications`.
- `apps/api/src/modules/enrichment/services/semanticEnrichmentPipeline.js` — enhance `validateNormalizedEnrichmentResult` with schema validation.
- `apps/api/src/modules/planning/routes/shared/planUtils.js` — strict schema validation in `normalizeDraftPlanResponse` (throw descriptive error, log raw output).
- Tests: `apps/api/tests/llmCache.test.js`, `apps/api/tests/pipelineErrorHandler.test.js`, `apps/api/tests/planDiversityLlmPass.test.js`, `apps/api/tests/jsonSchemaValidator.test.js`; extend `planUtils.test.js`. Register new files in `tools/scripts/run-tests.mjs`.
- Env: add `LLM_CACHE_ENABLED`, `LLM_CACHE_TTL_MS`, `LLM_CACHE_MAX_ENTRIES`, `LLM_CACHE_FILE` to `.env.example` (keep old `SEMANTIC_ENRICHMENT_CACHE_*` as fallback aliases in llmCache.js).
- Docs: `docs/llm-cache-error-handling.md`.

## Design decisions

1. Cache lives in `llmCache.js`; `openrouter.js` delegates. Key = sha256(JSON of {model, systemPrompt, userPrompt, normalized options}). TTL via `LLM_CACHE_TTL_MS` (0 = no expiry, LRU bound only). `LLM_CACHE_ENABLED=false` disables. Disk persistence via `LLM_CACHE_FILE` (optional).
2. Rollback: `applyPlanDiversityLlmRewrite(planSlice, options)` accepts `options.fitnessGuard: async (publications) => number`. If guard provided and post-rewrite fitness < pre-rewrite fitness → return ORIGINAL publications, `meta = { skipped: true, reason: 'rollback', fitness_before, fitness_after }`. Original plan never lost (we never mutate input; merge creates new objects).
3. `pipelineErrorHandler.js` exports: `runPipelineStage(name, fn, { retries, retryOn, fallback, log })`, `isRetryablePipelineError(err)`, `logPipelineError(...)`. Standard log prefix `[stage:<name>]`.
4. Schema validator: minimal subset (type incl. arrays of types, required, properties, additionalProperties:false NOT used — keep permissive on extra keys, items, enum, minimum/maximum, pattern, minItems/maxItems). Throws `AggregatedError` with JSON-pointer paths.

## Task checklist

- [x] Plan file created (this file)
- [x] Create `llmCache.js`
- [x] Create `pipelineErrorHandler.js`
- [x] Create `jsonSchemaValidator.js`
- [x] Refactor `openrouter.js` cache to use `llmCache.js`
- [x] `planDiversityLlmPass.js`: fitnessGuard rollback + error-handler integration
- [x] `hierarchicalGa.js`: pass fitnessGuard, drop duplicate guard, reason `'rollback'`
- [x] `draftPlanGenerationPipeline.js`: retry via pipelineErrorHandler at both LLM sites
- [x] `planUtils.js`: strict schema validation in `normalizeDraftPlanResponse`
- [x] `semanticEnrichmentPipeline.js`: schema-enhanced `validateNormalizedEnrichmentResult`
- [x] Tests: 4 new test files + extend planUtils.test.js; register in run-tests.mjs
- [x] `.env.example` additions
- [x] `docs/llm-cache-error-handling.md`
- [x] `npm run lint` + targeted tests green

## STATUS

- Progress: DONE. All code edits, tests, env, docs complete; lint 0 errors (pre-existing warnings only), targeted tests green (llmCache, pipelineErrorHandler, jsonSchemaValidator, planDiversityLlmPass, planUtils, draftPlanGenerationPipeline, hierarchicalGa, semanticEnrichmentPipeline).
- Verification: `node --test apps/api/tests/<file>.test.js` per file; full `npm run test` re-run 10.10.2026 = 271/271 pass; `npm run lint` = 0 errors (pre-existing warnings only).
- Note: guard extracted into exported `applyFitnessRollbackGuard` in planDiversityLlmPass.js (testable); `mergePublicationsRewrite` now exported.
- Note: `a.md:102` left as-is (historical task log); `docs/evolution-and-ml-how-it-works.md:610` updated to `reason: 'rollback'`.
