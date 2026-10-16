# Multi-User Plan: Registration, Login, Per-User Data Scoping

Status: **DONE (JSON-fallback path)** — checklist items 1-8 complete and verified (lint clean, 173/173 tests, build ok). Item 9 (DB e2e) pending until a pg instance is available.

## Goal

Make TKRP multi-user: registration + login pages (styled like the existing site), session-based auth replacing the raw API-key gate for user flows, and per-user isolation of wizard drafts and plan snapshots.

## Auth design (decided)

- Session-based auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Passwords hashed with `crypto.scrypt` + random salt (no new deps); stored as `scrypt:<salt-hex>:<hash-hex>`; compared with `crypto.timingSafeEqual`.
- Session token = `crypto.randomBytes(32).hex`; returned on register/login; sent as `Authorization: Bearer <token>` by the frontend.
- User store dual-path like the precedents facade:
  - DB path when `isDatabaseEnabled()` (`USE_DATABASE=true` + `DATABASE_URL`): tables `users` + `sessions` (migration `002_users.sql`).
  - JSON fallback: `data/runtime/api/users.json` + `data/runtime/api/sessions.json`.
- Username rule: `/^[a-zA-Z0-9_.@-]{3,64}$/`. Password: 6..128 chars, no policy theater.
- Existing API-key middleware (`security.js`) stays for admin/ingest routes; auth routes are public (rate-limited only). CORS already allows `Authorization` header.

## Per-user data scoping (decided)

- Wizard draft: was one global file `data/runtime/api/wizard-draft.json`. New: per-user file `data/runtime/api/drafts/<user_id>.json`; anonymous requests keep the legacy global file (backward compatible).
- Plan snapshots: token-keyed files stay; `saveSnapshot` records `owner` (user_id or null). Authenticated GET/DELETE only allowed when `owner` matches the session user or `owner` is null (legacy).
- `planRoutes.js` resolves `user_id` from the Bearer token via `authStore.resolveSession(token)`; anonymous => null.

## Existing infrastructure (verified, do NOT recreate)

| Artifact | Path | Status |
| --- | --- | --- |
| DB client | `apps/api/src/shared/db/client.js` | exists — `isDatabaseEnabled()`, `query()`, `withTransaction()`, `closePool()` |
| Migration runner | `apps/api/scripts/apply-migrations.js` | exists — sorted `*.sql` in `apps/api/migrations/`, tracks `schema_migrations` |
| Initial schema | `apps/api/migrations/001_initial.sql` | exists — has `user_plans`, `plan_history` (no users/sessions yet) |
| Security middleware | `apps/api/src/shared/http/security.js` | exists — `attachRequestContext`, CORS (Authorization allowed), rate limit (local IP exempt), `requireLocalOrApiKey` |
| Route utils | `apps/api/src/shared/http/routeUtils.js` | exists — `sendRouteError(res, req, status, fallback, error)` |
| API router | `apps/api/src/app/apiRoutes.js` | mounts `/precedents`, `/plan`, `/ml`, enrichment at root |
| Frontend API client | `apps/web/src/shared/api/enrichmentService.js` | `fetchJsonOrThrow` central helper — add auth header there |
| Frontend routes | `apps/web/src/app/App.jsx` | `/`, `/content-plan`; add `/login`, `/register` |
| Shared layout | `apps/web/src/shared/ui/Layout.jsx` + `Layout.css` | nav links + theme; auth pages must reuse |

## Task checklist

- [x] 0. Plan (this file)
- [x] 1. Migration `apps/api/migrations/002_users.sql` — `users` (username UNIQUE, password_hash, created_at) + `sessions` (user_id FK, token UNIQUE, created_at).
- [x] 2. `apps/api/src/modules/auth/services/authStore.js` — scrypt hash/verify, create/login/resolve/logout; DB path + JSON fallback. NOTE: scrypt params are N=2^15, blockSize=4, maxMemory=32MB (see gotcha below).
- [x] 3. `apps/api/src/modules/auth/routes/authRoutes.js` — register/login/logout/me; JSON responses with `request_id` like other routes.
- [x] 4. Wire `router.use('/auth', authRoutes)` in `apiRoutes.js`.
- [x] 5. Per-user drafts: `draftStore.js` gains `userId` param (`drafts/<user_id>.json`); `planRoutes.js` GET/PUT `/draft/current` resolves session user (Map keyed by userId, `'__anonymous__'` for null).
- [x] 6. Snapshot ownership: `planSnapshotStore.saveSnapshot` stores `owner`; `planRoutes` GET/DELETE enforce owner match (null = legacy, accessible to all).
- [x] 7. Frontend: `apps/web/src/shared/api/authService.js` (register/login/logout/me + token in localStorage key `tkrp_session`); `pages/auth/ui/LoginPage.jsx` + `RegisterPage.jsx` + `AuthPage.css` (site styling); nav links in `Layout.jsx`; routes in `App.jsx`; `enrichmentService.js` sends `Authorization` header when token present.
- [x] 8. Tests: `apps/api/tests/authRoutes.integration.test.js` (register/login/logout/me + draft scoping + snapshot ownership); registered in `tools/scripts/run-tests.mjs` `testFiles` array; lint clean, full `npm run test` 173/173 pass, `npm run build` ok.
- [ ] 9. DB e2e (when pg available): apply migrations incl. 002, run with `USE_DATABASE=true`, verify users/sessions in DB.

## Gotchas

- `security.js` rate limiter exempts local IPs — auth routes rely on it, no extra throttle needed for dev.
- Do NOT apply `requireLocalOrApiKey` to auth routes (anonymous users must be able to register/login).
- `planRoutes.js` keeps an in-memory `currentWizardDraft` cache — per-user cache must be keyed by userId (Map), not a single variable.
- Frontend stores session token in `localStorage` (`tkrp_session`); logout clears it.
- CORS `allowedHeaders` already includes `Authorization`; no change needed.
- Keep JSON fallback working without DB — CI has no pg instance.
- scrypt gotcha: N=2^15 with default blockSize=8 needs exactly 32MB, which OpenSSL REJECTS (maxMemory must be strictly greater). Use blockSize=4 (16MB) with maxMemory=32MB; raising maxMemory above 32MB does not help.
- Unrelated pre-existing fixes made along the way: typo in `contentOutputUtils.js` PRODUCT_BOILERPLATE_PATTERNS (`Компекная` -> `Комплексная`) fixed 2 dedupe tests; `PrecedentDetailsModal.jsx` useEffect moved above early-return guard to satisfy react-hooks lint.

## Verification commands

```
npm run lint
node --test apps/api/tests/authRoutes.integration.test.js
npm run test
npm run build
```
