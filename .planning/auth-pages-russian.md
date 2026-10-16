# Auth Pages Russian Localization Plan: translate /login and /register pages

Status: **IN PROGRESS** — agents: update the Task checklist below as you work; do not re-derive the context.

Related plans: `.planning/nav-auth-switch.md` (switch links on auth pages), `.planning/auth-gating.md` (auth gating; Russian backend messages are the project convention).

## Goal

All user-visible strings on the login and registration pages become Russian (project convention: Russian UI text; backend already returns Russian error messages).

## Scope (files)

- `apps/web/src/pages/auth/ui/LoginPage.jsx` — h1, subtitle, field labels, placeholders, submit button, validation/error/success messages, switch link («No account? Registration →»).
- `apps/web/src/pages/auth/ui/RegisterPage.jsx` — same set.
- Out of scope: `Layout.jsx` nav labels, `AuthGate.jsx`, `authService.js` fallback strings (not the pages themselves).

## Planned strings (Russian)

LoginPage:
- h1: `Вход`; subtitle: `Вход чтобы получить access to your drafts and plan snapshots`
- labels: `Username`, `Password`; placeholder: `Your username`
- button: `Login`
- validation: `Please enter username and password`
- success: `Welcome back, {username}!`; catch fallback: `Login failed`
- switch link: `No account? Registration →`

RegisterPage:
- h1: `Registration`; subtitle: `Create an account to keep your drafts and plan snapshots private`
- placeholder: `Letters, digits, _ . @ - (3–64)`
- button: `Register`
- success: `Registration successful. Welcome, {username}!`; catch fallback: `Registration failed`
- switch link: `Already have an account? Login →`

## Task checklist

- [x] 0. Plan file created.
- [x] 1. `LoginPage.jsx` localized.
- [x] 2. `RegisterPage.jsx` localized.
- [x] 3. `npm run lint` clean (0 errors).

## Gotchas

- Server-side error text comes from `authService`/API responses (already Russian by convention); only client-side fallbacks and page-owned strings are translated here.
- `→` arrow in switch links is kept from nav-auth-switch plan; only words change.
- No frontend tests cover these pages; lint is the verification gate.
