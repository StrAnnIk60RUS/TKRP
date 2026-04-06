# TKRP — Project Context for AI

## 1) Purpose and Product Scope

`TKRP` is a local R&D system for generating and optimizing IT project content plans using:

- competitor data ingestion (publications + observed content plans),
- LLM enrichment and draft generation,
- retrieval (RAG) over local precedents,
- ML surrogate models for engagement prediction,
- two-stage genetic optimization (plan-level + post-level).

Main business goal: produce a better content plan than a raw LLM draft by combining precedent-based context, predictive scoring, and constrained evolutionary search.

---

## 2) High-Level Architecture

Top-level structure:

- `apps/web` — React + Vite frontend.
- `apps/api` — Express backend + orchestration layer.
- `tools/parser` — Python parser utilities.
- `tools/ml` — Python ML scripts (training + prediction).
- `tools/scripts` — repository-level checks/automation.
- `data/input/examples` — fixture input JSONs.
- `data/precedents` — local precedent storage.
- `data/ml` — trained model artifacts.
- `data/runtime` — runtime temp/state files.
- `docs` — architecture and domain docs.
- `dist/web` — production frontend build output.

Key architecture rules (from project docs):

- Frontend follows `app / pages / features / shared`.
- Backend follows `app / modules / shared`.
- Shared layers must not depend on feature/domain layers in reverse.
- Runtime JSON must stay in `data/runtime`, not near source code.

---

## 3) Technology Stack

### Frontend
- React 18
- Vite 5
- React Router
- jsPDF / xlsx for export flows

### Backend
- Node.js (ESM)
- Express
- Axios, CORS, dotenv
- Optional PostgreSQL client dependency present (`pg`)

### Python tools
- Parser scripts (`tools/parser`)
- ML model script (`tools/ml/engagement_model.py`) producing `joblib` artifacts

---

## 4) Main Runtime Flows

## 4.1 Competitor Ingestion and Precedent Persistence
1. Competitor source data is parsed/enriched.
2. Backend persists precedents into local storage (`publications`, `content_plans`).
3. Embeddings are generated for retrieval (when needed).
4. Data is available for RAG retrieval and ML dataset construction.

## 4.2 Draft Generation (RAG -> LLM)
1. User fills project form in frontend.
2. Backend builds retrieval query from form context.
3. Relevant precedents are fetched and reliability-scored.
4. LLM generates a draft skeleton and publications for planning horizon.
5. Draft is normalized/repaired and sent to optimization pipeline.

## 4.3 Two-Stage Evolutionary Optimization
- **Stage 1 (plan evolution):** optimize slot-level structure (`topic`, `format`, `objective`, `tone`, `cta`, `creativity`) for whole-plan fitness.
- **Stage 2 (post evolution):** optimize per-post feature vectors for better predicted likes while preserving realism and slot intent.

## 4.4 Prediction and Scoring
- Post-level and plan-level predictions are produced by local surrogate ML models.
- Fitness combines predicted likes with ontology/reliability consistency bonuses and structural penalties.

---

## 5) ML System (Surrogate Models)

Two local models are used:

1. `post_likes_model.joblib` — predicts likes for a single post from engineered features.
2. `content_plan_likes_model.joblib` — predicts total likes for a content plan from plan-level features.

Artifacts location: `data/ml/`

Typical metadata files include feature dimension/name consistency information.

Training behavior:

- lazy/ensure train when model artifact is absent,
- optional auto-train after ingestion (if enabled),
- manual train/retrain endpoints exist in ML routes.

Python model pipeline (high level):

- build feature matrix `X` and target `y`,
- non-negative target handling with log-transform (`log1p`/`expm1`),
- feature scaling (`StandardScaler`),
- MLP regressor training,
- save model + metadata.

---

## 6) Data and Storage

Current primary storage is local JSON-based precedent/runtime storage under `data/*`.

Logical datasets:

- `publications` (competitor posts + metrics + embedding-related fields),
- `content_plans` (observed competitor plans),
- ingestion run logs,
- runtime draft/state files.

Important note:
- Project docs include a recommended migration path to PostgreSQL + pgvector, but this is described as target architecture guidance rather than guaranteed default runtime everywhere.

---

## 7) Core Backend Domains (`apps/api/src/modules`)

- `enrichment` — parser + enrichment pipeline orchestration.
- `planning` — draft generation, persistence, hierarchical GA optimization.
- `precedents` — storage, search, ontology aggregation/export, reliability scoring.
- `ml` — train/predict orchestration and Python bridge.

Cross-cutting concerns are in `apps/api/src/shared` (security, runtime helpers, utils).

---

## 8) Core Frontend Domains (`apps/web/src`)

- `app` — bootstrap/router/providers/global setup.
- `pages` — route-level screens.
- `features/project-form` — user input + GA config shaping.
- `features/content-plan` — plan presentation/history/export flows.
- `shared` — reusable UI/components/api/helpers.

Frontend persists some user history in browser storage (project state/history behavior depends on current feature implementation).

---

## 9) Security and Operations

Key operational constraints from repository docs:

- CORS defaults are localhost-oriented unless configured.
- Sensitive endpoints can require server/admin API keys.
- Python execution path/timeouts are configurable through environment variables.
- VK/LinkedIn cookies must come from environment variables, never hardcoded.

---

## 10) Commands

From root:

- `npm run dev` — run frontend + backend concurrently.
- `npm run ml:retrain` — retrain ML models on current local precedent dataset.
- `npm run ml:retrain:full` — re-embed precedents with wrong dimensions, then retrain models.
- `npm run build` — frontend production build into `dist/web`.
- `npm run preview` — preview frontend build.
- `npm run lint` — repository lint/check scripts.
- `npm run test` — frontend/backend tests.
- `npm run check` — lint + test + build.

Backend-only (in `apps/api`):
- `npm run dev` — watch mode backend.
- `npm run start` — run backend server.
- `npm run test` — backend tests.

---

## 10.1) ML Retraining Quickstart

Use this when the feature engineering / scoring logic changes and existing model artifacts become stale.

1. Start API server (`npm run dev` from repo root, or `npm run dev --prefix apps/api`).
2. Ensure your admin/server API key is available in env if endpoint protection is enabled (`ADMIN_API_KEY` or `SERVER_API_KEY`).
3. Run:
   - `npm run ml:retrain` for regular retraining on current dataset.
   - `npm run ml:retrain:full` if you also need `reembed-and-train`.

The command prints JSON with endpoint response and elapsed time.

---

## 11) Environment and Dependencies

Minimum local requirements (documented):

- Node.js 20+
- Python 3.11+

Typical required env values include:

- `OPENROUTER_API_KEY`
- `VITE_ENRICHMENT_API_URL`
- optional parser cookies (`VK_COOKIE`, `LINKEDIN_COOKIE`)
- optional security config (`SERVER_API_KEY`, `ADMIN_API_KEY`)
- optional CORS and python timeout/path settings

---

## 12) Fitness Logic (Important for AI Reasoning)

Plan-level score is conceptually:

`score = predicted_plan_likes + composite_bonus - penalties`

Where bonuses may include:
- audience alignment,
- objective coverage,
- format mix fit,
- ontology consistency,
- novelty/calendar consistency,
- reliability prior from retrieval context.

Typical penalties:
- posts-per-week deviation from target,
- topic repetition / low diversity,
- CTA overuse or drift from expected share,
- extrapolation penalties from bounded prediction logic.

Post-level score similarly balances:
- predicted post likes,
- alignment with slot context (tone/cta intent),
- realism/quality penalties against base feature profile.

---

## 13) Known Constraints and Risks

- Local precedent store is not a full DBMS (transaction/scaling limits).
- Parser quality depends on source accessibility and valid cookies.
- Surrogate models require periodic retraining/validation as data drifts.
- Retrieval and scoring quality strongly depends on precedent coverage and reliability.

---

## 14) File/Entry-Point Map for AI Navigation

Frontend:
- `apps/web/src/app`
- `apps/web/src/pages`
- `apps/web/src/features`
- `apps/web/src/shared`

Backend:
- `apps/api/src/app/apiRoutes.js`
- `apps/api/src/modules`
- `apps/api/src/shared`

ML and tools:
- `tools/ml/engagement_model.py`
- `tools/parser/*`

Documentation:
- `docs/architecture.md`
- `docs/evolution-and-ml-how-it-works.md`
- `docs/evolution-and-ml-how-it-works-customer.md`
- `docs/database-architecture.md`

---

## 15) AI Usage Guidance

When using this repository as model context, prioritize these assumptions:

1. This is a hybrid system: generation + retrieval + predictive optimization.
2. Final plan quality is not pure LLM output; it is constrained by ML + GA scoring.
3. Precedent quality and schema consistency directly affect downstream behavior.
4. Always distinguish:
   - draft generation stage,
   - plan evolution stage,
   - post evolution stage.
5. If behavior seems unstable, inspect:
   - model artifact presence/version,
   - feature dimension/name alignment,
   - precedent freshness/reliability,
   - GA configuration from project form.