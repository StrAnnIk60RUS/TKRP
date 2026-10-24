<rules>
# Universal AI Agent Rules

## 1. Agent Goal
Engineer mindset: minimal iterations, respect project style, maintainable code, context efficiency. Understand task and constraints before modifying code.

## 2. Stop Rule
Stop after 3 failed attempts. Log: 1. Tried steps; 2. Specific blocker; 3. 1-3 hypotheses. Wait for human.

## 3. Planning & Context
- Plan before non-trivial tasks: list files, risks, confirm significant changes.
- Read files only when necessary; always read before editing.
- Start with minimal file set. Propose new chat if context swells.
- Prioritize local docs (`AGENTS.md`, `.planning/`) over these rules.
- **Smart Impact Analysis**: Before modifying symbols/contracts, check all call-sites and consumers (grep/search).

## 4. Zero Dead Code & Clean-Up (Strict Housekeeper)
- **Delete, Never Abandon**: When modifying or replacing functions, routes, components, or modules, always delete the replaced code in the same diff. No `// legacy`, `// old implementation`, or zombie fallback code.
- **No Commented-Out Code**: Never commit or leave commented-out blocks of replaced code.
- **Orphan Sweep**: After any refactoring, find all references to modified entities. If an import, variable, helper, DTO, type, or fixture is no longer used, delete it immediately.
- **Trace Backwards**: If deleting an endpoint or public method, delete its associated validation schemas, internal helpers, and obsolete tests.
- **No Unused Symbols**: Zero tolerance for unused imports, unused parameters, and unread variables.

## 5. Anti-Overengineering & YAGNI
- **Minimal Viable Diff**: Touch strictly the code required to fulfill the user prompt. Do not rewrite whole files, do not touch neighboring untouched functions, do not reformat unrelated code.
- **No Speculative Architecture**: Write code only for immediate requirements. Never create factories, wrappers, abstract adapters, or configuration flags for hypothetical "future flexibility".
- **Rule of Three**: Create abstractions only when the identical logic repeats across at least 3 distinct places. Otherwise, direct procedural/functional code is preferred.
- **Native over Custom**: Prefer standard Node.js ESM / JavaScript / React capabilities instead of writing custom utility wrappers.
- **No New Dependencies**: Never introduce external packages if the task can be done with the existing stack.

## 6. Meaningful Tests Only (No Coverage Theater)
- **No Useless Tests**:
  - DO NOT test trivial logic (simple getters/setters, pass-through re-exports, 1-to-1 property assignments).
  - DO NOT test internal implementation details or private variables; verify observable public contracts.
  - DO NOT write tests where 80%+ is mocking internal logic of the module under test.
- **High-Value Test Scope**:
  - Test business calculations, ranking, state transitions, and genetic optimization invariants.
  - Test critical edge cases: null/undefined, empty payloads, timeouts, malformed input.
  - Test bug regressions: reproduce bug with failing test before fixing.
- **Never Relax Assertions**: If an existing test fails after your changes, investigate if contract was broken. Never blindly adjust assertions just to get green tests.
- **Sync Tests with Code**: When removing or changing a feature, update or delete its obsolete tests in the same change.

## 7. Quality & Security
- No stubs (`TODO`, `stub`). Complete, verifiable code only.
- Follow project conventions and precise typing.
- Comments only for non-obvious logic / why, not what.
- No secrets/PII in code, logs, or docs.
- Use secure constructs for SQL, Shell, HTML.

## 8. Resilience & Verification
- Handle critical errors; no silent exceptions. Safe logs only.
- Verify changes locally: run canonical lint (`npm run lint`) and targeted tests (`node --test ...`).
- Report: what was verified, what wasn't, if tests are missing/expensive.

## 9. Documentation & Dependencies
- Update docs for API, contracts, setup, and architecture.
- Use existing stack first. No CI/infra changes unless requested.

## 10. Response Format
- Technical precision. Result first, details later.
- Tables only for clarity. No long theoretical explanations.
- If failed, state clearly.

## 11. Conflict Resolution
Hierarchy: 1. User request -> 2. Project rules (`AGENTS.md`) -> 3. Universal rules (`rules.md`) -> 4. Heuristics. Clarify risks/ambiguity before acting.

## 12. Operational Checklist
- **Pre-work:** Task goal, local rules, find call sites / affected files, minimal scope check.
- **Post-work:** Orphan sweep, remove dead code/comments, lint verification (`npm run lint`), relevant tests, doc sync.
</rules>
