# Logout Plan: logout button -> session cleared -> redirect to login page

Status: **DONE** — logout button implemented; lint clean.

Related plans: `.planning/auth-gating.md`, `.planning/nav-auth-switch.md`.

## Goal

- Logged-in users see a «Log out» button in the header controls (`Layout.jsx` `header-controls`).
- Clicking it: invalidates the session server-side, clears `localStorage['tkrp_session']`, then navigates the user to `/login` (LoginPage).
- After logout, `isUserAuthenticated()` is false → main-nav/role selector hidden, protected pages render `LoginPage` (existing `AuthenticatedOnly` behavior in `App.jsx`).

## Already in place (verified, do NOT re-implement)

- `apps/web/src/shared/api/authService.js` line 83: `logoutUser()` — POSTs `/api/auth/logout` with `{ token }`, then `setSessionToken(null)`; swallows network errors but always clears localStorage.
- `apps/api/src/modules/auth/routes/authRoutes.js` lines 76–96: `POST /logout` → `logoutSession(token)`.
- `apps/api/src/modules/auth/services/authStore.js`: `logoutSession` (JSON + DB paths).
- No frontend UI entry point calls `logoutUser()` — that is the only missing piece.

## Mechanism (planned)

- `apps/web/src/shared/ui/Layout.jsx`:
  - Add `useNavigate` to the existing `react-router-dom` named import (line 2).
  - Add `import { logoutUser } from '../api/authService'` (Layout is in `shared/ui`; authService is in `shared/api` — same shared layer, no reverse dep).
  - In `Layout` body: `const navigate = useNavigate()`; async handler: `const handleLogout = async () => { await logoutUser(); navigate('/login') }`.
  - Inside the existing `isUserAuthenticated() ? ... : null` branch of `header-controls` (or as a sibling gated button), add `<button type="button" className="logout-btn" onClick={handleLogout}>Log out</button>`.
- `apps/web/src/shared/ui/Layout.css`: style `.logout-btn` like `.theme-toggle-btn` but with pink accent (`#ff6b9d`) + light-theme overrides; include in the `@media (max-width: 560px)` full-width rule with `.role-select, .theme-toggle-btn`.

## Task checklist

- [x] 0. Plan file created.
- [x] 1. `Layout.jsx`: logout button + navigate to `/login`.
- [x] 2. `Layout.css`: `.logout-btn` styles (dark + light theme, mobile).
- [x] 3. `npm run lint` clean (0 errors; pre-existing warnings elsewhere).

## Gotchas

- JSX components use non-standard `import X from '...'` style; keep named imports on separate lines (`import { logoutUser } from '../api/authService'`).
- `logoutUser()` never throws (catches fetch errors) — safe to `await` before navigating; localStorage is cleared even if the server call fails.
- `onClick` on an async handler returns a Promise — fine for React; no unhandled rejection since `logoutUser` catches internally.
- No frontend tests cover Layout (verified in `nav-auth-switch.md`); lint is the verification gate.
- Do NOT add a `/logout` route in `App.jsx` — button lives in Layout and navigates to existing `/login`.
