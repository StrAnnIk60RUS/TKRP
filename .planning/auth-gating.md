# Auth-Gating Plan: anonymous users must not perform actions

Status: **DONE** (backend gate + frontend gate + tests verified) — agents: update the Task checklist below as you work; do not re-derive the context.

## Goal

Unregistered/anonymous users must not be able to perform any actions: every user-facing API route requires a valid session (logged-in user); the frontend shows a login/register gate instead of content when there is no session token. Admin-only routes keep the existing admin-key protection.

## Mechanism

### Backend (real security boundary)

- New middleware: `apps/api/src/modules/auth/services/sessionGate.js` → `requireSessionOrAdminApiKey`.
  - Accepts: admin key (ADMIN_API_KEY/SERVER_API_KEY env, via `readApiKey` semantics) OR Bearer session token resolved by `resolveSession(token)` → userId.
  - Otherwise 401: `'Authentication required. Please log in or register.'` (Russian message, project convention).
  - Lives in `modules/auth/services/` (NOT `shared/http/security.js`) — feature→feature import is the established pattern; shared layer must not depend on auth module.
- Applied to (all via `middleware: [requireSessionOrAdminApiKey]`):
  - `planRoutes.js` — all 8 routes (generate, generate-batched, optimize, draft GET/PUT, snapshots POST/GET/DELETE).
  - `precedentRoutes.js` — `/summary`, `/`, `/search`, `/ontology`, `/ontology/export`, `/ontology/export/turtle`. `/seed` stays `requireLocalOrAdminApiKey`.
  - `enrichmentRoutes.js` — `/parse`, `/parse-and-enrich`, `/enrich`.
  - `mlRoutes.js` — `/relevance/predict`, `/post/predict`, `/content-plan/predict`, `GET /models/metadata`. Train routes stay `requireLocalOrAdminApiKey`.
- `security.js` (`requireLocalOrApiKey`, `requireLocalOrAdminApiKey`) left intact.

### Frontend (UI convenience)

- `apps/web/src/shared/ui/AuthGate.jsx` (+ `AuthGate.css`): exports `isUserAuthenticated()` (`Boolean(getSessionToken())` from `shared/api/authService.js`) and `AuthGate` panel (links to `/login`, `/register`, theme-styled).
- `App.jsx` (strict gate): `AuthenticatedOnly` wrapper — unauthenticated users see ONLY `LoginPage` on `/` and `/content-plan` (login/register pages stay open). The wrapper is a component so `isUserAuthenticated()` is re-evaluated on every navigation/render (a const evaluated in `App()` body would be stale after login).
- `Layout.jsx`: when unauthenticated — role selector hidden, nav shows only `/register` + `/login` links (no `/`, no `/content-plan`).
- `HomePage.jsx` / `ContentPlanPage.jsx`: keep internal `AuthGate` fallback (defense-in-depth; unreachable while App-level gate is active).
- Auth pages (`/login`, `/register`) stay open — they are the entry point. No footer links to `/` and no "Show current user" button (removed; unauthenticated footer link would just re-render the login page).
- `AuthPage.css` polished: input hover/focus-visible (accent pink), button active/focus-visible states, success/error message borders, footer note color.

## Task checklist

- [x] 1. `sessionGate.js` middleware created.
- [x] 2. Gate applied to plan/precedent/enrichment/ml routes (admin routes untouched).
- [x] 3. Integration tests updated: `precedentRoutes.integration.test.js` (authenticated flow + new 401 unauthenticated assertion), `enrichmentRoutes.integration.test.js` (all 6 tests authenticated). `createUser` returns `{ user_id, username, token }` — use `.token`.
- [x] 4. Frontend `AuthGate` component + HomePage/ContentPlanPage gating.
- [x] 5. `AuthPage.css` polish (focus/active states, message borders).
- [x] 6. Tests: `node --test --test-concurrency=1` on precedent/enrichment/auth/security → 16/16 pass.

## Gotchas

- Run API integration tests with `--test-concurrency=1` — parallel processes race on `data/runtime/api/sessions.json` JSON fallback.
- `createUser(...)` returns an object, not a token string.
- Frontend gate is UI-only; the backend middleware is the actual enforcement (a stale localStorage token still hits 401 server-side).
- Components use `export default X` + non-standard `import X from '...'` (ProjectForm convention); named helpers need a separate `import { ... } from` line — mixing default and named in one braces import breaks at runtime.
- Render gates do NOT stop `useEffect`s: `ContentPlanPage.jsx` mount effect (loadCurrentPlan → snapshot GET) is explicitly guarded with `if (!isUserAuthenticated()) return` — otherwise unauthenticated visits fire 401s in console.
- `AuthenticatedOnly` in `App.jsx` must be a component (evaluated per render), not a const in `App()` body — otherwise the gate decision is stale after login without a full reload.
- Session tokens persist across server restarts in both DB (`sessions`) and JSON fallback paths.
