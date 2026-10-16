# program-stages.md — все стадии программы TKRP (runtime pipeline)

Checkpoint: see [a.md](a.md) for session state. This file documents the actual runtime flow,
verified from code (paths + line anchors as of 09.10.2026).

## Стади 0. Ingestion (баедит вход) — parsing competitor publications

1. `apps/api/src/modules/enrichment/services/parserPipeline.js`
   - `parseAndEnrichByUrl(url, limit)` (:157) — parse + enrich;
   - `parseOnlyByUrl(url, limit)` (:227) — parse only.
   - Calls Python parser via `apps/api/src/shared/runtime/pythonJsonWorker.js`
      (path/timeouts configurable via env; cookies `VK_COOKIE`, `LINKEDIN_COOKIE` from env;
      missing cookie for detected platform -> clear error; cookie values redacted in parser
      stdout/stderr via `redactSecrets`).
2. `apps/api/src/modules/enrichment/services/postDeterministicFeatures.js`
   - `applyDeterministicPostProcessing(competitorsData)` (:173) — deterministic features.
3. `apps/api/src/modules/enrichment/services/semanticEnrichmentPipeline.js`
   - `buildSemanticEnrichmentBatches` (:215) -> LLM (prompt
     `shared/prompts/articleStage1SemanticEnrichmentPrompt.txt`) ->
     `validateAndNormalizeSemanticBatchResult` (:270) -> `mergeSemanticBatchResults` (:339)
     -> `validateNormalizedEnrichmentResult` (:386).
   - Ontology LLM enrichment flag: `ONTOLOGY_LLM_ENRICHMENT_MODE=off|shadow|active` (default off).

Handoff: enriched publications + observed plans persisted to precedents storage.

## Стади 1. Precedents storage, embeddings, reliability (RAG substrate)

1. Storage: `apps/api/src/modules/precedents/repositories/precedentRepositoryJson.js`
   (JSON storage in `data/precedents`; `precedentRepositoryDb.js` = pg target, not default).
2. Embeddings: `apps/api/src/modules/precedents/services/embeddingService.js`
   - `embedTexts(texts, options)` (:103), `cosineSimilarity` (:23).
3. Reliability: `apps/api/src/modules/precedents/services/precedentReliabilityService.js`
   - `computePublicationReliability` (:95), `computeContentPlanReliability` (:119),
     `enrichSearchResultsWithReliability` (:145).
4. Ontology aggregation: `ontologyAggregationService.js`
   - `buildOntologyFromSnapshot` (:297), Turtle export `serializeOntologyToTurtle` (:470).

Handoff: search results (precedents + reliability) feed draft generation.

## Стади 2. Draft generation (RAG -> LLM)

Route: `apps/api/src/modules/planning/routes/planRoutes.js` (mounted in `app/apiRoutes.js`
as `router.use('/plan', planRoutes)`; all endpoints gated by
`requireSessionOrAdminApiKey` from `auth/services/sessionGate.js`):

- `POST /api/plan/generate` (:98), `POST /api/plan/generate-batched` (:106).

Pipeline: `apps/api/src/modules/planning/services/draftPlanGenerationPipeline.js`
- `generateDraftPlanBatched(...)` (:1444) — main batched generator;
- RAG query built by `buildRagQueryFromForm` (`planning/routes/shared/planUtils.js:249`);
- prompts: `shared/prompts/articleDraftPlanSkeletonPrompt.txt` (skeleton),
  `articleDraftPlanBatchPrompt.txt` (batch posts), `articleDraftPlanPrompt.txt`;
- LLM JSON parsed via `shared/utils/llmJsonParsing.js` + `extractJsonFromLlmContent`;
- normalization/repair: `normalizeDraftPlanResponse` (planUtils.js:129),
  `sanitizeUserFacingSummary` (:347), plus `contentOutputUtils.js` helpers
  (`ensureDistinctTopicTitles`, `dedupeKeyMessagesAcrossPublications`, ...).

Persistence: `draftStore.js` — `saveDraft`/`loadDraft` (:35/:22) in `data/runtime` (per-user);
atomic writes (tmp+rename) + per-key lock chain.

Handoff: normalized draft -> optimization endpoint.

## Стади 3. Plan-level GA (optimization stage 1)

Route: `POST /api/plan/optimize` (planRoutes.js:114) ->
`runHierarchicalOptimization` (`services/evolutionary/hierarchicalGa.js:109`).
Async variants (job queue in `shared/runtime/jobQueue.js`): `POST /api/plan/optimize:async`
(202 + `job_id`), `GET /api/plan/jobs/:jobId`, `GET /api/plan/jobs` (list + stats).

1. `validateOptimizationInputs(draft, stage1Config)` (:123).
2. `optimizeContentPlanEvolution(draft, {...stage1Config, lockedFields})` (:126)
   in `planEvolution.js` — genes = slot-level features
   (`topic`, `format`, `objective`, `tone`, `cta`, `creativity`).
3. GA engine: `gaCore.js` (`runGeneticAlgorithm` :91; tournament select, seeded mulberry32 RNG)
   or `asyncGaCore.js` (`runAsyncGeneticAlgorithm` :92; roulette/rank select, fitness cache);
   mutations/crossover in `operators.js`.
4. Fitness: `planEvolution.js:1154 calculateFitness(predictedMetrics, metadata, publications, options)`
   — ML-predicted likes + ontology/reliability bonuses + structural penalties;
   ontology bonus rollout gated by `ONTOLOGY_SCORING_ROLLOUT_PERCENT` (default 0).

Handoff: bridge at hierarchicalGa.js:133–141 — `stage2LockedFields` from
`contentPlanResult.planFeatureMap` (`targetCtaShare`, `targetAvgCreativity`,
`targetUniqueTones`).

## Стади 4. Post-level GA (optimization stage 2)

1. `optimizePublicationsEvolution(optimizedPlan.publications, planFeatureMap, {...stage2Config, lockedFields})`
   (hierarchicalGa.js:144) in `postEvolution.js` — genes = per-post feature vectors.
2. Fitness: `postEvolution.js:81 calculateFitness(predictedMetrics, metadata)`;
   plus peer-diversity bonus: `fitness = kpi + peerWeight * diversity` (:328).
3. Fill: `fillPlanWithBestPublication(..., { targetCtaShare: planFeatureMap.cta_share })` (:154).

ML predictions used by fitness: `apps/api/src/modules/ml/services/relevancePredictionService.js`
(feature vectors from `ml/ontologyFeatureEngineering.js`: `buildPostFeatureVector` :231,
`buildPlanFeatureVector` :307; models `data/ml/*.joblib`).

Handoff: optimized plan -> optional diversity rewrite.

## Стади 5. Optional plan-diversity LLM rewrite (optimization stage 3)

`planDiversityLlmPass.js`:
- gate `shouldRunPlanDiversityLlmRewrite` (:51) — env `PLAN_DIVERSITY_LLM_REWRITE=1`;
- `applyPlanDiversityLlmRewrite` (:69), prompt `shared/prompts/planDiversityTextRewritePrompt.txt`;
- errors caught, recorded in `stage3LlmMeta` (`reason: 'error'`), pipeline continues unrewritten
  (hierarchicalGa.js:171–196).

## Стади 6. Final normalization + scoring + constraints

hierarchicalGa.js:198–291:
1. `normalizePlanPublicationsFields` (planUtils.js:99) ->
   `sanitizePlanPublicationsBodies` -> `buildPlanFeatureMap` (ontologyFeatureEngineering.js:240).
2. `predictContentPlanMetrics` (relevancePredictionService) + `validatePlanConstraints` (:291).
3. Result returned with per-item `fitness` (hierarchicalGa.js:282).

Persistence of results: `planSnapshotStore.js` — `saveSnapshot` (:62), `loadSnapshot` (:107),
`deleteSnapshot` (:135); endpoints `POST /api/plan/snapshots` (:157),
`GET /api/plan/snapshots/:token` (:193), `DELETE /api/plan/snapshots/:token` (:222);
payload cap `PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES`, TTL sweep `PLAN_SNAPSHOT_TTL_MS`,
atomic writes + per-token lock.

## Стади 7 (side flow). ML training

- `apps/api/src/modules/ml/routes/mlRoutes.js` — train/retrain endpoints;
- datasets: `buildMlTrainingDatasets` (ontologyFeatureEngineering.js:401);
- Python: `tools/ml/engagement_model.py` (log1p target, StandardScaler, MLPRegressor)
  -> artifacts `data/ml/post_likes_model.joblib`, `data/ml/content_plan_likes_model.joblib`;
- CLI: `npm run ml:retrain` / `ml:retrain:full`.

## Стади 8 (frontend). UI flow

`apps/web/src`: project form (`features/project-form`, GA config shaping) ->
calls `/api/plan/*` -> `features/content-plan` presentation/history/export (jsPDF/xlsx).

## Env flags gating stages

| Flag | Stage | Default |
| --- | --- | --- |
| `ONTOLOGY_LLM_ENRICHMENT_MODE` | 0 (semantic enrichment) | off |
| `PLAN_DIVERSITY_LLM_REWRITE` | 5 (rewrite) | off (must be `1`) |
| `ONTOLOGY_SCORING_ROLLOUT_PERCENT` | 3/4 fitness ontology bonus | 0 |
| `ONTOLOGY_SCORING_MAX_ENRICH_ERRORS` | auto-disable threshold | 0 |
| `PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES` | 6 (snapshots) | — |
| `PLAN_SNAPSHOT_TTL_MS` | 6 (snapshot TTL) | 30 days |
| `JOB_QUEUE_MAX_CONCURRENCY` | async optimize | 1 |
| `JOB_RESULT_TTL_MS` | async jobs result sweep | 1h |
| `JOB_QUEUE_MAX_RETAINED` | async jobs retention | 200 |
| `PYWORKER_REQUEST_TIMEOUT_MS` | 0/4 (python worker) | 30s |
| `PYWORKER_MAX_RETRIES` | 0/4 (python worker) | 2 |
| `PYWORKER_BREAKER_MAX_FAILURES` | 0/4 (circuit breaker) | 3 |

## Known dead/debug code (not part of runtime flow)

- `planRouterCore.js` — moved to `apps/api/tests/helpers/` (test-only import; no longer in `src/`).
- `// #region agent log` fetch blocks (localhost:7428) — REMOVED from `planRoutes.js`,
  `hierarchicalGa.js`, `postEvolution.js` (×2), `planRouterCore.js` (10.10.2026).
