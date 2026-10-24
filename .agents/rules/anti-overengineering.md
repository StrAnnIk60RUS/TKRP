---
description: Anti-Overengineering, Minimal Viable Diff, and YAGNI
globs: "**/*"
alwaysApply: true
---

# Rule: Anti-Overengineering & Minimal Viable Diff

## 1. Minimal Viable Diff
- Touch ONLY the code required to fulfill the exact user prompt.
- Do not rewrite entire files or refactor adjacent functions that work properly.
- Do not re-format lines or change styles in code you did not intentionally modify.

## 2. No Speculative Architecture (YAGNI)
- Solve only the active requirement.
- DO NOT create abstract classes, factory functions, strategy patterns, or dependency injection layers for a single implementation.
- DO NOT write code for hypothetical edge cases or "future scalability" that wasn't requested.
- Favor simple, readable, direct procedural/functional code over complex architectural hierarchies.
- **Rule of Three**: Only extract shared abstractions if the identical pattern repeats in at least 3 places.

## 3. Native over Custom Wrappers
- Prefer native modern JavaScript / Node.js ESM / React APIs instead of creating bespoke wrapper functions.
- Never install new npm packages or Python libraries if the task can be accomplished using the existing stack.
