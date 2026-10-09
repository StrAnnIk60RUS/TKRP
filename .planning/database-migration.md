# Database Migration Plan: JSON → PostgreSQL/pgvector

Status: **DONE** (steps 1–6 complete; verified 10.10.2026 against live PostgreSQL 18 + pgvector, DB `tkrp`) — agents: update the Task checklist below as you work; do not re-derive the context.

Related plan: `.planning/auth-gating.md` (auth-gating of all user-facing routes + frontend gate; users/sessions already migrated to DB in `002_users.sql`).

## Goal

Move TKRP storage from JSON files (`data/precedents/`, `data/runtime/api/`) to PostgreSQL + pgvector, keeping JSON as a fallback until migration is verified.

## Switch mechanism

- `USE_DATABASE=true` + `DATABASE_URL` in `.env` selects the DB path (see `apps/api/src/shared/db/client.js`).
- Facade: `apps/api/src/modules/precedents/repositories/precedentRepository.js` — switches between `precedentRepositoryJson.js` and `precedentRepositoryDb.js` (8 exports: `persistPrecedents`, `getPrecedentsSummary`, `getPrecedentsSnapshot`, `searchPrecedents`, `reembedPrecedentsWithWrongDimension`, `getAggregatedOntology`, `getOntologyExportData`, `getOntologyTurtleData`).

## Existing infrastructure (verified, do NOT recreate)

| Artifact | Path | Status |
| --- | --- | --- |
| Initial schema | `apps/api/migrations/001_initial.sql` | exists — tables: `publications`, `content_plans`, `ingestion_runs`, `user_plans`, `plan_history`, `precedents_metadata`; embeddings `vector(1024)` (matches e5-large data; fixed from 1536) |
| Migration runner | `apps/api/scripts/apply-migrations.js` | exists — reads `DATABASE_URL` from env or root `.env`, tracks `schema_migrations` |
| DB client | `apps/api/src/shared/db/client.js` | exists — `pg.Pool`, `query()`, `withTransaction()`, `closePool()` |
| pg service | `docker-compose.yml` | exists — pgvector container |

## Current state / gaps

1. ~~`precedentRepositoryDb.js` is MISSING~~ — **RESOLVED**: implemented (async exports; callers patched).
2. ~~`relevancePredictionService.js` bypasses the facade~~ — **RESOLVED**: DB path added via facade.
3. ~~No JSON→DB migration script exists~~ — **RESOLVED**: `apps/api/scripts/migrate-json-to-db.js` created.
4. ~~Remaining: end-to-end run against a live pg instance (step 6)~~ — **RESOLVED** (see below).

## Storage backends (added 10.10.2026)

- Migration `004_storage_backends.sql`: `wizard_drafts` (draft_key PK, draft JSONB, updated_at) + `plan_snapshots` (token PK, owner, saved_at, snapshot/summary JSONB). Keys mirror the JSON layout 1:1.
- `draftStore.js` + `planSnapshotStore.js`: DB-first, JSON fallback on DB error (`console.warn`); JSON files never deleted.

## Schema mapping

| JSON source | DB target |
| --- | --- |
| `data/precedents/publications.json` | `publications` (full record in `publication_model` JSONB + promoted columns + `embedding vector(1024)`) |
| `data/precedents/content_plans.json` | `content_plans` (`content_plan_model` JSONB + `ontology_support` + embedding) |
| `data/precedents/ingestion_runs.json` | `ingestion_runs` |
| `data/precedents/metadata.json` | `precedents_metadata` (key/value JSONB) |
| `data/runtime/api/plan-snapshots/*.json` | `user_plans` + `plan_history` |
| `data/runtime/api/wizard-draft.json` | `user_plans` (draft type) |
| `data/ml/*.joblib` | out of scope (ML artifacts stay on disk) |

## Task checklist

- [x] 0. Inventory + plan (this file)
- [x] 1. **Implement `apps/api/src/modules/precedents/repositories/precedentRepositoryDb.js`** — DONE: all 8 exports (async), row↔record conversion, bulk upserts (`ON CONFLICT`, chunked ≤2000 params), sequential mutation queue mirroring JSON flow; `searchPrecedents` param renamed `searchQuery` (avoids shadowing db `query`); `bulkUpsert` accepts optional transaction `client`.
- [x] 2. **Create `apps/api/scripts/migrate-json-to-db.js`** — DONE: standalone pg script, bulk upserts publications/content_plans/ingestion_runs/metadata, prints JSON vs DB counts, idempotent.
- [x] 3. **Patch `relevancePredictionService.js`** — DONE: imports `getPrecedentsSnapshot` (facade) + `isDatabaseEnabled` (db client); `readPrecedentSnapshot`/`getTrainingPayload` now async with DB path; `await` at call site (trainMetricsModel).
- [x] 4. **Verify embedding dimension** — DONE (corrected 10.10.2026): `001_initial.sql` uses `vector(1024)` — real data (e5-large) is 1024-dim; `.env` has `EMBEDDING_VECTOR_DIM=1024`.
- [x] 5. **Lint + tests** — DONE.
- [x] 6. **End-to-end check** — DONE 10.10.2026: live PG 18.6 + pgvector in DB `tkrp`; migrations 001–004 applied (idempotent re-run verified); `migrate-json-to-db.js` counts match JSON (617 publications / 33 content_plans / 55 ingestion_runs, 617 embeddings non-null); ANN cosine query works; DB tests: dbClient 11, precedentRepositoryDb.live 7, dbMigrations 7, draftStore.db 6, planSnapshotStore.db 9 — all pass; `npm run lint` 0 errors.

## Gotchas

- Keep `publication_model`/`content_plan_model` JSONB and the `embedding` vector column in sync — JSONB holds the full record (incl. embedding array); the vector column is the searchable copy. Upserts must write both.
- Do NOT delete JSON files until step 6 passes; JSON remains fallback.
- `shared/db/client.js` returns null/disabled mode when `USE_DATABASE` is unset — DB code paths must not run then.
- Facade import of a missing module breaks startup — fix step 1 before running the app.
- ML feature dimension alignment (`data/ml/*.joblib`) is unrelated to embeddings; don't conflate.

## Verification commands

```
npm run lint
node apps/api/scripts/apply-migrations.js
node apps/api/scripts/migrate-json-to-db.js
node --test apps/api/tests/precedentRepository.test.js   # adjust to actual test names
```
