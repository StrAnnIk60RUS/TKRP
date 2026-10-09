# LLM cache, schema validation, pipeline error handling

## Shared LLM cache (`apps/api/src/shared/utils/llmCache.js`)

One cache for every LLM call site: `apps/api/openrouter.js` `callOpenRouterChat` routes
through `llmCacheOrCompute`. Key = sha256 of `{model, systemPrompt, userPrompt, options}`.

Env:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_CACHE_ENABLED` | `true` | `false` disables caching entirely |
| `LLM_CACHE_TTL_MS` | `0` | entry lifetime; `0` = no expiry |
| `LLM_CACHE_MAX_ENTRIES` | `200` | LRU capacity |
| `LLM_CACHE_FILE` | — | optional JSON file for disk persistence |

Backward compatibility: when `LLM_CACHE_MAX_ENTRIES`/`LLM_CACHE_FILE` are unset,
`SEMANTIC_ENRICHMENT_CACHE_MAX_ENTRIES`/`SEMANTIC_ENRICHMENT_CACHE_FILE` are used.
Config is resolved lazily on first cache use because dotenv loads `.env` after ESM imports.

## Pipeline error handling (`apps/api/src/shared/utils/pipelineErrorHandler.js`)

`runPipelineStage(stageName, stepFn, options)` standardizes every fallible pipeline step:

- retries only retryable failures (5xx / `ETIMEDOUT`/`ECONNRESET`/`ENOTFOUND` / timeout-ish
  messages) with exponential backoff; validation/parse errors rethrow immediately;
- `options.fallback` returns a value instead of rethrowing after retries are exhausted;
- logs with `[stage:<name>]` prefix via `logPipelineError` (stage, message, response status,
  raw LLM content slice);
- rethrown errors are decorated with `error.stage`.

Env: `PIPELINE_ERROR_RETRY_ATTEMPTS` (default 1), `PIPELINE_ERROR_RETRY_BASE_DELAY_MS` (default 2000).

Used in `draftPlanGenerationPipeline.js` at both LLM sites (`draft_skeleton`,
`draft_month_batch:<monthKey>`).

## Fitness rollback guard (`planDiversityLlmPass.js`)

`applyPlanDiversityLlmRewrite(planSlice, { fitnessGuard: { fitnessFn, epsilon } })` scores
publications before/after the LLM rewrite; on drop beyond epsilon it returns the ORIGINAL
publications with `meta = { skipped: true, reason: 'rollback', fitness_before, fitness_after }`.
The original plan is never lost (merge never mutates input). `hierarchicalGa.js` passes
`fitnessFn = (pubs) => scorePlanFitness(optimizedPlan, pubs)`; the old external guard
(`reverted_fitness_decreased`) was removed — reason is now `'rollback'`.

## Strict LLM output validation (`jsonSchemaValidator.js`)

Dependency-free validator subset: `type` (incl. type arrays), `required`, `properties`,
`items`, `enum`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern`,
`minItems`/`maxItems`. Extra properties are allowed (permissive to model drift).

- `assertValidAgainstJsonSchema(value, schema, label)` throws with `validation_errors`
  (JSON-pointer paths) and `raw_value` (JSON sliced to 4000 chars) — used in
  `planUtils.js` `normalizeDraftPlanResponse` (draft plan envelope contract).
- `validateAgainstJsonSchema(value, schema)` returns `{ valid, errors }` — used in
  `semanticEnrichmentPipeline.js` `validateNormalizedEnrichmentResult` (structural errors
  prepended to the existing semantic checks).
