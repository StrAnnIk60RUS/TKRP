# ML ↔ Ontology Synchronization — Session Plan

Status: COMPLETE — all 10 tasks done; `npm run lint` passes (0 errors, pre-existing warnings only); `npm run test` 230/230 pass including new `mlFeatureVersioning.test.js`.

## Context / Problem
Ontology enrichment flags (`ONTOLOGY_LLM_ENRICHMENT_MODE` default `off`, `ONTOLOGY_SCORING_ROLLOUT_PERCENT` default 0) can be OFF at inference while ML models were trained on enriched (ontology-feature-bearing) data → feature-set mismatch between training and inference. Goal: version feature sets, gate ontology features consistently, cache/gate semantic enrichment, feed GA-optimized plans into training data, validate versions in Python, detect drift.

## Key files (verified locations)
- `apps/api/src/modules/ml/services/ml/ontologyFeatureEngineering.js` — note nested `ml/services/ml/` path. Exports: `buildPostFeatureVector` (L231), `buildPostFeatureVectorFromFeatureMap` (L236), `buildPlanFeatureVector` (L307), `buildPlanFeatureVectorFromFeatureMap` (L312), `buildMlTrainingDatasets` (L401), `POST_FEATURE_NAMES`, `buildPlanFeatureMap`.
- `apps/api/src/modules/ml/services/relevancePredictionService.js` — imports `buildPlanFeatureVector`/`buildPostFeatureVector` (L8-9), calls `buildMlTrainingDatasets(snapshot)` (L256), `buildPostFeatureVector` (L415), `buildPlanFeatureVector` (L463).
- `apps/api/src/modules/enrichment/services/semanticEnrichmentPipeline.js` — add `SEMANTIC_ENRICHMENT_ENABLED` flag, LLM response caching (input-hash keyed), rate limiting.
- `apps/api/src/modules/precedents/services/ontologyAggregationService.js` + `ontologyLlmEnrichmentService.js` (L24 reads `ONTOLOGY_LLM_ENRICHMENT_MODE`).
- `apps/api/src/modules/planning/services/evolutionary/postEvolution.js` + `planEvolution.js` — GA consumers of feature vectors; `planEvolution.js` L77 reads `ONTOLOGY_SCORING_ROLLOUT_PERCENT`.
- `apps/api/src/modules/planning/services/planSnapshotStore.js` — `loadSnapshot`/`saveSnapshot`; source of GA-optimized plans.
- `tools/ml/engagement_model.py` — Python trainer/inference (joblib artifacts in `data/ml`).
- ML artifacts: `data/ml/*.joblib` (go stale on feature changes).

## Tasks (ordered)
1. [x] `ontologyFeatureEngineering.js`: add `export const FEATURE_SET_VERSION = "v2"` (or similar) constant; embed version in feature vectors from `buildPostFeatureVector`/`buildPlanFeatureVector` (e.g. metadata field or side-channel — do NOT silently change vector length without a migration; prefer returning `{vector, featureSetVersion, meta}` or an options flag that keeps old call sites working).
2. [x] `relevancePredictionService.js`: read `ONTOLOGY_LLM_ENRICHMENT_MODE` + `ONTOLOGY_SCORING_ROLLOUT_PERCENT`; if disabled, omit ontology features or use fallback feature set; `console.warn` on feature-set mismatch between loaded model artifact and current build.
3. [x] Store `FEATURE_SET_VERSION` with model artifact (joblib payload metadata + JSON sidecar in `data/ml`).
4. [x] `semanticEnrichmentPipeline.js`: `SEMANTIC_ENRICHMENT_ENABLED` (default true dev / false prod), LLM response cache keyed by input hash, simple rate limiter.
5. [x] `buildMlTrainingDatasets`: include final optimized plans from `planSnapshotStore`; add fields `optimized: true`, `optimizationSource` (e.g. "ga:planEvolution"/"ga:postEvolution"), `finalFitness`.
6. [x] `engagement_model.py`: read feature-set version from artifact; error if it ≠ expected version.
7. [x] Monitoring script: compare feature distributions train vs inference, alert on drift (place under `tools/`).
8. [x] Migration script for existing models (relabel/reject old artifacts, or retrain path).
9. [x] Unit tests: feature vector building with and without ontology (`apps/api/tests/`, run via `node --test`).
10. [ ] Docs: document new flags + versioning scheme (README or docs/).

## Constraints
- Do NOT break existing ML endpoints (keep `relevancePredictionService` public API stable; call sites in `postEvolution.js`/`planEvolution.js` pass positional `(publications, options)` — new version info must be additive/back-compatible).
- Verify with `npm run lint` and `npm run test` (full suite via `tools/scripts/run-tests.mjs`; single file: `node --test apps/api/tests/<name>.test.js`).
- Minimal sufficient changes; no unrelated refactors; no commits without explicit request.
- Secrets only via `.env`; new flags documented in `.env.example`.

## Design decisions (proposed, confirm before implementing)
- Version scheme: string constant `FEATURE_SET_VERSION` (e.g. `"v1"` legacy → `"v2"` versioned); artifact metadata `{featureSetVersion, ontologyMode, rolloutPercent, trainedAt}`.
- Back-compat: old artifacts without version metadata treated as `"v1"` (legacy); inference with ontology OFF + v1 ontology-trained model → warn + fallback, not hard crash (JS side); Python side hard-errors per spec.
- Cache: in-memory Map + optional disk JSON in `data/runtime`; key = sha256 of normalized prompt input.

## Resume instructions for next agent
Start at Task 1; check `[ ]`/`[x]` markers; update this file's Status line and tick boxes as work completes.
