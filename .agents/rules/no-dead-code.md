---
description: Zero Dead Code, Orphan Sweep, and Complete Clean-Up
globs: "**/*"
alwaysApply: true
---

# Rule: Zero Dead Code & Complete Clean-Up

## 1. Delete, Never Abandon
- When refactoring, replacing, or modifying an existing function, method, endpoint, or UI component, **always delete the replaced code in the same diff**.
- Never leave legacy code behind "just in case" or with comments like `// legacy`, `// old implementation`.
- Never leave commented-out blocks of replaced code. If code is obsolete, delete it.

## 2. Sweep for Orphans
- Before finishing any task, search the codebase for all symbols you modified or replaced.
- If a helper function, variable, type definition, DTO, or validator is no longer called anywhere, delete it immediately.
- Clean up unused imports, destructured properties, and function parameters.

## 3. Backward Compatibility Shims
- Do NOT add compatibility shims, adapters, or fallback wrappers unless explicitly instructed in the user prompt.
- If a contract changes and breaking change is permitted, update all call-sites and remove the obsolete interface completely.
