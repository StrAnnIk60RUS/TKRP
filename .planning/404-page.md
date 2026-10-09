# 404 Page Plan: styled catch-all page with a joke

Status: **IN PROGRESS** — agents: update the Task checklist below as you work; do not re-derive the context.

Related plans: `.planning/nav-auth-switch.md` (auth-gated nav), `.planning/auth-pages-russian.md` (Russian auth pages).

## Goal

- Unknown URLs (`/anything-not-routed`) render a beautiful, site-styled 404 page instead of blank/404.
- Page is wrapped in `Layout` (header + particle background + theme) like every other page.
- NO joke anymore (the database/RAG/genetic-algorithm gag is removed): just a cool, beautiful styled page.
- Auth-gated navigation offers (via `isUserAuthenticated()` from `shared/ui/AuthGate`):
  - Logged in: ONLY a home (`/`) link — no login/register offer.
  - Not logged in: ONLY login (`/login`) + register (`/register`) links — no home offer.

## Mechanism (planned)

- New page dir: `apps/web/src/pages/not-found/ui/NotFoundPage.jsx` + `NotFoundPage.css` (same structure as other pages: `not-found-page` > `page-header` + `page-content`).
- `App.jsx`: import `NotFoundPage`, add catch-all `<Route path="*" element={<NotFoundPage />} />` as the LAST route in `<Routes>`.
- CSS: reuse site palette (`#1a1a2e`, `#2d2d44`, accent `#ff6b9d`, `#f8b500`); giant gradient "404" numeral; theme-aware where App.css patterns allow.

## Task checklist

- [x] 0. Plan file created.
- [x] 1. `NotFoundPage.jsx` + `NotFoundPage.css` created (joke version, then revised).
- [x] 2. `App.jsx`: catch-all `path="*"` route added last.
- [x] 3. `NotFoundPage.jsx` revised: joke removed, auth-gated links (`isUserAuthenticated()`).
- [x] 4. `NotFoundPage.css` revised: cool orbit/satellite + gradient glow "404", link cards.
- [x] 5. `npm run lint` clean.

## Gotchas

- `path="*"` must be the LAST `<Route>` or it shadows specific routes (react-router v4 matching order).
- `.page-header`/`.page-subtitle` styles are per-page CSS (HomePage.css pattern), not global — `NotFoundPage.css` must define its own.
- Components use `export default X` + non-standard `import X from '...'`; CSS imported as `import './NotFoundPage.css'`.
- No frontend tests cover these pages; `npm run lint` is the verification gate.
