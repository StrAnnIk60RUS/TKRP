# Precedent Storage Upgrade: JSON → PostgreSQL/pgvector + versioning + ANN index + RAG cache

Status: **DONE** (2026-10-09) — pg e2e (apply-migrations + migrate-json-to-db on live pg) remains manual, see `docs/precedent-storage.md`.
Session handoff doc. Started 2026-10-09. Related plan: `.planning/database-migration.md` (steps 1–5 already done there).

## Goal (from user objectives)

1. Replace default JSON precedent storage with pg; JSON becomes dev-only fallback.
2. Embedding model versioning (`embedding_model_version`) so stale vectors never mix with new-model vectors.
3. Real vector index (pgvector HNSW ANN) instead of O(N) cosine scans in the DB backend.
4. LRU cache for frequent RAG queries (query + filters + model version key).
5. Reliability scores: calibrated weights + distribution logging + periodic calibration script.
6. Ontology aggregation must keep working with the new backend.

## Existing infrastructure (verified — do NOT recreate)

| Artifact | Path | Status |
| --- | --- | --- |
| Facade (USE_DATABASE switch) | `apps/api/src/modules/precedents/repositories/precedentRepository.js` | exists, 8 exports |
| JSON backend | `.../repositories/precedentRepositoryJson.js` | exists |
| DB backend | `.../repositories/precedentRepositoryDb.js` | exists (linear cosine scan — to be replaced) |
| Shared helpers | `.../repositories/precedentRepositoryShared.js` | exists |
| DB client | `apps/api/src/shared/db/client.js` | pg.Pool, query(), withTransaction() |
| Migrations | `apps/api/migrations/001_initial.sql`, `002_users.sql` | embeddings `vector(1536)` |
| Migration runner | `apps/api/scripts/apply-migrations.js` | schema_migrations tracker |
| JSON→DB script | `apps/api/scripts/migrate-json-to-db.js` | exists, needs version column |
| pg docker | `docker-compose.yml` pgvector/pgvector:pg16 | HNSW-capable (pgvector ≥0.4) |
| Test runner | `tools/scripts/run-tests.mjs` | fixed explicit file list — new tests MUST be appended |

## Design decisions

- **Backend switch**: `PRECEDENT_STORAGE=json|pg` (explicit wins). Back-compat: `USE_DATABASE=true` → pg. Production default: `APP_ENV=production` → pg unless `PRECEDENT_STORAGE=json`. Dev default: json. pg without `DATABASE_URL` → hard error (fail fast, no silent JSON in prod).
- **Versioning**: `EMBEDDING_MODEL_VERSION` env (default = model name). Every record carries `embedding_model_version`. Search compares query version vs stored version; mismatch → warning + background re-embed job (guarded, fire-and-forget). `reembedPrecedentsWithWrongDimension` generalized to version+dim check, name kept (API contract).
- **ANN search (DB backend)**: pgvector `embedding <-> query` ORDER BY LIMIT K (K = max(200, limit*20)) candidate retrieval, then JS hybrid rescoring (embedding+token weights, quality gate, audience fallback) on candidates. Fallback to linear scan if pgvector function/index unavailable (catch). JSON backend keeps linear scan (dev-only, small N) but uses top-k heap helper.
- **Cache**: new `services/ragQueryCacheService.js` — in-memory LRU, key = backend+modelVersion+normalizedQuery+limit+platforms+audience, TTL + max entries, stats. Env: `RAG_CACHE_ENABLED` (default true), `RAG_CACHE_MAX_ENTRIES` (128), `RAG_CACHE_TTL_MS` (300000).
- **Reliability**: weights env-overridable (`RELIABILITY_WEIGHT_*`); histogram logging every `RELIABILITY_LOG_EVERY` enriched samples; `apps/api/scripts/calibrate-reliability.js` computes distributions and recommended weights.
- **Ontology**: `ontologyAggregationService.js` is snapshot-based (backend-agnostic already); only versioning-awareness comment + no JSON-specific assumptions.

## New env vars (document in .env.example + docs/precedent-storage.md)

`PRECEDENT_STORAGE`, `APP_ENV`, `EMBEDDING_MODEL_VERSION`, `RAG_CACHE_ENABLED`, `RAG_CACHE_MAX_ENTRIES`, `RAG_CACHE_TTL_MS`, `RAG_ANN_CANDIDATES`, `RELIABILITY_WEIGHT_RETRIEVAL/COMPLETENESS/SOURCE_TRUST`, `RELIABILITY_LOG_EVERY`, `RELIABILITY_TARGET_MEAN`.

## Task checklist

- [x] 0. Plan file (this file)
- [x] 1. `precedentRepository.js` factory: PRECEDENT_STORAGE + prod default + `getActiveStorageBackend()` export
- [x] 2. `embeddingService.js`: `modelVersion` in `embedTexts` result; `buildVectorLiteral`; `topKByCosine` (heap); `needsReembed` helper
- [x] 3. `precedentRepositoryShared.js`: `embedding_model_version` on embed paths; `embedItemsWithDimensionMismatch` generalized to version+dim (name kept)
- [x] 4. `precedentRepositoryDb.js`: ANN candidate query (`<->`), version-mismatch detector + background re-embed, cache integration, linear fallback on ANN error
- [x] 5. `precedentRepositoryJson.js`: cache integration + version stamping (linear scan kept, dev-only)
- [x] 6. `ragQueryCacheService.js` (LRU + TTL + stats)
- [x] 7. `precedentReliabilityService.js`: env weights, distribution histogram logging, `getReliabilityDistribution()`, `calibrateWeights()`
- [x] 8. `apps/api/scripts/calibrate-reliability.js` calibration script
- [x] 9. `apps/api/migrations/003_embedding_versioning.sql`: `embedding_model_version` columns + HNSW indexes
- [x] 10. `migrate-json-to-db.js`: write `embedding_model_version` column
- [x] 11. Tests: `precedentStorage.test.js`, `embeddingVersioning.test.js`, `ragQueryCache.test.js`, `precedentReliability.test.js` + appended to `run-tests.mjs`
- [x] 12. Docs: `docs/precedent-storage.md` (migration guide + env vars + failure modes), `.env.example` update
- [x] 13. Verify: `npm run lint` (0 errors), full suite 208/208 pass incl. `precedentRoutes.integration.test.js`

## Gotchas

- Do NOT change the 8 facade export names/signatures (routes + ML depend on them).
- `node --test` runs each file in a fresh process — env-dependent factory logic must be exported as a pure function for testability.
- pgvector HNSW index build on existing table: safe with `CREATE INDEX` (blocking but fine at this scale); guard migration with `ALTER ... IF NOT EXISTS` semantics (SQL has no IF NOT EXISTS for ALTER — use DO blocks or rely on fresh schema from 001).
- `embedding <-> vec` errors if column dim ≠ query dim — keep `EMBEDDING_VECTOR_DIM=1536` aligned with 001_initial.sql.
- Cache must NOT serve results across embedding model versions (key includes version).
- run-tests.mjs has a FIXED explicit list — forgetting to append new tests = tests never run in CI.

## Verification commands

```
npm run lint
node --test apps/api/tests/precedentStorage.test.js
node --test apps/api/tests/embeddingVersioning.test.js
node --test apps/api/tests/ragQueryCache.test.js
node --test apps/api/tests/precedentReliability.test.js
node --test apps/api/tests/precedentRoutes.integration.test.js
node apps/api/scripts/apply-migrations.js   # needs live pg
node apps/api/scripts/calibrate-reliability.js
```
