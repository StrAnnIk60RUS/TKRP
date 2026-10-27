---
description: Pragmatic Testing, Real Scenarios, and Anti-Coverage-Theater
globs: "apps/**/tests/**/*, **/*.test.*, **/*.spec.*"
alwaysApply: true
---

# Rule: Pragmatic Testing (No Coverage Theater)

## 1. What NOT to Test (Useless Tests)
- DO NOT test trivial logic: simple getters/setters, pass-through re-exports, 1-to-1 data mappings without transformations.
- DO NOT test internal implementation details or private variables; test only observable public contracts and side-effects.
- DO NOT write tests where 80%+ of the test code is mocking internal functions of the module under test (if everything is mocked, the test asserts nothing).

## 2. What TO Test
- Business logic calculations, ranking algorithms, state mutations, and genetic optimization flows.
- Edge cases and failure modes: null/undefined, empty payloads, malformed inputs, timeouts.
- Bug reproductions: when fixing a bug, write a test that fails before the fix and passes after.

## 3. Test Maintenance & Integrity
- DO NOT rewrite or relax existing assertions just to make a broken test pass. If an existing test fails, investigate why the contract broke.
- When deleting or replacing a feature, delete its obsolete tests in the same change.
- Respect project test runner constraints: run targeted test files individually (`node --test <path>`) rather than spawning concurrent unconstrained suites.
