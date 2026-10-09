# AGENTS.md: TKRP Project Operational Guide

## 1. Bootstrap Sequence
Read in order: `rules.md` (universal agent rules) -> `README.md` (product/architecture) -> this file -> `docs/` (only as needed) -> `.planning/` (if active tasks exist). Do not crawl the repo upfront.

## 2. Project Essentials
- **Goal:** local R&D system generating/optimizing content plans: competitor ingestion + RAG over precedents + LLM drafts + surrogate ML models + two-stage genetic optimization (plan-level, then post-level).
- **Stack:** React 18 + Vite 5 frontend, Node ESM + Express backend, Python 3.11 tools (parser, ML via joblib artifacts in `data/ml`).
- **Two npm packages:** repo root (frontend + orchestration) and `apps/api` (own package.json/lockfile). `npm install` postinstall installs `apps/api` deps; set `SKIP_POSTINSTALL=1` to skip.

## 3. Commands (verified from package.json + ci.yml)
- `npm run setup` — bootstrap: npm install + `pip install -r requirements.txt` + copy `.env.example` -> `.env`.
- `npm run dev` — frontend (Vite) + backend concurrently.
- `npm run check` — canonical verification order: `lint` -> `test` -> `build`. CI does exactly: `npm ci` (root), `npm ci` (apps/api), pip install, lint, test, build.
- `npm run lint` = `tools/scripts/lint-project.mjs` + `eslint apps/web apps/api`.
- `npm run format` — prettier over `apps/web` + `apps/api` JS only.
- Single test file: `node --test apps/api/tests/<name>.test.js` (or `apps/web/tests/...`). Full suite runs via `npm run test` = `tools/scripts/run-tests.mjs` with a fixed explicit file list, `--test-concurrency=1` (default; raising it can OOM) and `--max-old-space-size=8192` — do not run heavy API test files in parallel naively.
- `npm run ml:retrain` / `ml:retrain:full` — requires the API server running and `ADMIN_API_KEY`/`SERVER_API_KEY` in env if endpoint protection is on.

## 4. Architecture Rules (easy to violate)
- Frontend `apps/web/src`: `app / pages / features / shared`. Backend `apps/api/src`: `app / modules / shared` (modules: `enrichment`, `planning`, `precedents`, `ml`).
- Shared layers must NOT depend on feature/domain layers (no reverse deps).
- Runtime/temp JSON belongs in `data/runtime`, never near source code. Precedents in `data/precedents`; fixtures in `data/input/examples`.
- Backend entry: `apps/api/src/app/apiRoutes.js`; frontend entry: `apps/web/src/app`.
- PostgreSQL/pgvector is a documented target architecture, not the default runtime — primary storage is local JSON.

## 5. Environment & Gotchas
- Secrets only via `.env` / env vars: `OPENROUTER_API_KEY`, `VK_COOKIE`, `LINKEDIN_COOKIE`, `SERVER_API_KEY`, `ADMIN_API_KEY`. Never hardcode.
- CORS defaults to localhost; Python path/timeouts configurable via env.
- ML artifacts (`*.joblib` in `data/ml`) go stale when feature engineering changes — retrain, and check feature dimension/name alignment when behavior looks unstable.
- Ontology LLM flags default OFF (`ONTOLOGY_LLM_ENRICHMENT_MODE=off`); scoring rollout default 0%.

## 6. Workflow Conventions (from rules.md)
- Plan before non-trivial edits; minimal sufficient changes; no unrelated refactoring; no commits without explicit request; atomic commits (`feat:`/`fix:`/`refactor:`/`docs:`/`test:`).
- No stubs/TODOs; verify with `lint`/`test` after changes; no new dependencies unless essential.
