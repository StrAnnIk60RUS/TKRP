---
description: Mandatory light and dark theme support for UI elements
globs: "apps/web/**/*"
alwaysApply: true
---

# Rule: Mandatory Dual Theme Support (Light & Dark)

## 1. Universal Theme Requirement
- Whenever adding, restyling, or modifying UI elements, components, or screens in `apps/web`, **always implement styles for BOTH light and dark themes**.
- Never style an element solely for light theme and leave dark theme unstyled or broken (e.g. dark text on dark backgrounds, or blinding white container backgrounds in dark mode).

## 2. Implementation Conventions
- **Light Theme**: Defined in component/feature CSS or scoped under `body.theme-light`.
- **Dark Theme**: Scoped to `body.theme-dark` (either via CSS variables like `--bg-shell`, `--bg-raised`, `--bg-inset`, `--line`, `--ink`, `--ink-muted`, or by adding corresponding rules in `apps/web/src/app/styles/theme-dark.css`).
- **Contrast & Readability**: Ensure proper contrast ratio for text, borders, tags, badges, buttons, cards, inputs, and hover/active states in both modes.
- **No Hardcoded Blind Colors**: Avoid hardcoded pure colors (`#ffffff`, `#000000`, `#1a1a2e`) in component styles without dark-mode overrides or theme-aware variables.
