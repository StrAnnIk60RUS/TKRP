# Nav Auth-Switch Plan: hide Login/Registration in main-nav until logged in

Status: **IN PROGRESS** — agents: update the Task checklist below as you work; do not re-derive the context.

Related plan: `.planning/auth-gating.md` (auth-gating of routes + frontend gate; `isUserAuthenticated()` from `shared/ui/AuthGate.jsx`).

## Goal

- Unauthenticated users: `main-nav` in `Layout.jsx` must NOT show the «Registration» and «Login» links.
- Login page shows a switch link «No account? Registration →» leading to `/register`.
- Registration page shows a switch link «Already have an account? Login →» leading to `/login`.
- Authorized users: `main-nav` behavior unchanged (all four links: `/`, `/content-plan`, `/register`, `/login`).

## Mechanism (planned)

- `apps/web/src/shared/ui/Layout.jsx`: move the `/register` and `/login` `Link`s INSIDE the existing `isUserAuthenticated() ? (...) : null` branch of `<nav className="main-nav">` (single ternary, not two).
- `apps/web/src/pages/auth/ui/LoginPage.jsx`: add `<Link to="/register">No account? Registration →</Link>` (class `auth-switch-link`) after the form/message block; import `Link` from `react-router-dom`.
- `apps/web/src/pages/auth/ui/RegisterPage.jsx`: add `<Link to="/login">Already have an account? Login →</Link>` (same class).
- `apps/web/src/pages/auth/ui/AuthPage.css`: style `.auth-switch-link` (theme-aware, hover accent pink like other auth controls).

## Task checklist

- [x] 0. Plan file created.
- [x] 1. `Layout.jsx`: register/login links gated by `isUserAuthenticated()`.
- [x] 2. `LoginPage.jsx`: switch link to `/register`.
- [x] 3. `RegisterPage.jsx`: switch link to `/login`.
- [x] 4. `AuthPage.css`: `.auth-switch-link` styles.
- [x] 5. `npm run lint` clean for touched files.

## Gotchas

- Components use `export default X` + non-standard `import X from '...'`; `Link` must be imported as a separate named import line (`import { Link } from 'react-router-dom'`).
- `isUserAuthenticated()` must be called per render (component body), not cached in `App()` — see auth-gating.md.
- No frontend tests cover Layout/auth pages (verified: no matches in `apps/web/tests`); lint is the verification gate here.
- Unauthenticated `main-nav` renders empty — intentional; entry point is the `AuthGate`/`LoginPage` via `AuthenticatedOnly` in `App.jsx`.
