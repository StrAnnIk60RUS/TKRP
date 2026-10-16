# Precedent storage: JSON → PostgreSQL + pgvector

## Резюме

- Разрапа-кандидат retrieval: JSON (dev-only) или PostgreSQL + pgvector (прода).
- Switch: `PRECEDENT_STORAGE=json|pg` (explicit wins); back-compat `USE_DATABASE=true` → pg; `APP_ENV=production` → pg; dev default json.
- Embedding model versioning: `EMBEDDING_MODEL_VERSION` (default = `EMBEDDING_MODEL`); every record carries `embedding_model_version`; stale records get background re-embed.
- ANN search: pgvector `embedding <-> query` ORDER BY LIMIT K (K = max(200, limit*20), override `RAG_ANN_CANDIDATES`), then JS hybrid rescoring.
- RAG query cache: in-memory LRU keyed by backend+modelVersion+query+filters; TTL + max entries.
- Reliability scoring: env-tunable weights + histogram logging + calibration script.

## Migration guide (JSON → pg)

1. **Apply migrations** — `node apps/api/scripts/apply-migrations.js` (reads `DATABASE_URL` from env or root `.env`). Migration `003_embedding_versioning.sql` adds `embedding_model_version` columns + HNSW cosine indexes.
2. **Switch backend** — set `PRECEDENT_STORAGE=pg` (or `USE_DATABASE=true`) + `DATABASE_URL` in `.env`.
3. **Copy data** — `node apps/api/scripts/migrate-json-to-db.js` (bulk-inserts `data/precedents` JSON into `publications` + `content_plans`, preserving `embedding_model_version`).
4. **Re-embed if needed** — if `EMBEDDING_MODEL`/`EMBEDDING_MODEL_VERSION` changed since ingestion, call `POST /api/precedents/reembed` or `reembedPrecedentsWithWrongDimension()` (detects dim **and** version mismatch).
5. **Verify** — compare `GET /api/precedents/summary` counts vs JSON files; check `[precedentRepository]` console warnings for stale embeddings.

## Env vars

| Var | Default | Description |
| --- | --- | --- |
| `PRECEDENT_STORAGE` | (empty) | `json` or `pg`; explicit switch, wins over everything. `json` in production = hard error. |
| `APP_ENV` | `development` | `production` forces pg backend by default. |
| `DATABASE_URL` | — | pg connection; required when backend is pg. |
| `USE_DATABASE` | `false` | Back-compat pg switch (pre-upgrade flag). |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model. |
| `EMBEDDING_MODEL_VERSION` | = model | Version stamp on all embeddings; bump on model change. |
| `EMBEDDING_VECTOR_DIM` | `1536` | pgvector column dim; must match model output dim. |
| `RAG_CACHE_ENABLED` | `true` | Enable RAG query LRU cache. |
| `RAG_CACHE_MAX_ENTRIES` | `128` | Cache size cap (LRU eviction). |
| `RAG_CACHE_TTL_MS` | `300000` | Entry lifetime. |
| `RAG_ANN_CANDIDATES` | `max(200, limit*20)` | pgvector ANN candidate pool K. |
| `RELIABILITY_WEIGHT_RETRIEVAL` | `0.5` | Reliability weight (relevance). |
| `RELIABILITY_WEIGHT_COMPLETENESS` | `0.35` | Reliability weight (data completeness). |
| `RELIABILITY_WEIGHT_SOURCE_TRUST` | `0.15` | Reliability weight (source trust). |
| `RELIABILITY_LOG_EVERY` | `200` | Log reliability score histogram every N samples (0 = off). |
| `RELIABILITY_TARGET_MEAN` | `0.6` | Target mean reliability for calibration. |

## Failure modes

- **pg without `DATABASE_URL`** — hard error at startup (fail fast; no silent JSON fallback in prod).
- **ANN unavailable** (pgvector function/index missing) — caught, warning, linear scan fallback for that query.
- **Stale embeddings** (stored `embedding_model_version` ≠ current) — that query uses linear scan with on-the-fly re-embed + one guarded background re-embed job for the whole corpus.
- **Cache disabled** (`RAG_CACHE_ENABLED=false`) — no caching, everything computed.
- **Production + explicit json** — throws (`PRECEDENT_STORAGE=json is dev-only`).
- **Dimension mismatch** — `embedding <-> vec` SQL error avoided: stale-dim records are re-embedded before ANN; `reembedPrecedentsWithWrongDimension` handles 1536↔1024 migrations.

## Calibration

`node apps/api/scripts/calibrate-reliability.js` — scores all precedents (retrieval factor = 0), builds reliability histograms, prints recommended `RELIABILITY_WEIGHT_*` values hitting `RELIABILITY_TARGET_MEAN`.

## Tests

`apps/api/tests/precedentStorage.test.js`, `embeddingVersioning.test.js`, `ragQueryCache.test.js`, `precedentReliability.test.js` (all in `run-tests.mjs` list). DB ANN e2e requires live pg — manual: docker pg + apply-migrations + migrate-json-to-db + `PRECEDENT_STORAGE=pg` server run.
