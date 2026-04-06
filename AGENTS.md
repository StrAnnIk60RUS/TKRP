<project_guide>
# AGENTS.md: Project Operational Guide

## 1. Bootstrap Sequence
Read in order:
1. `rules.xml` (Universal rules)
2. `README.md` (Product overview)
3. `AGENTS.md` (This guide)
4. `docs/` (Architecture)
5. `.planning/` (Active tasks)
*Do not crawl the entire repo upfront.*

## 2. Project Context & Schema
[Template: Fill this for specific repo]
- **Core Goal:** [Product description]
- **Structure:** [Paths to backend, frontend, scripts, docs]
- **Commands:** [Start, Test, Lint, Build]
- **Critical Files:** [Protected or sensitive paths]
- **Conventions:** [Project-specific style over defaults]

## 3. Planning & Task Management
- **Non-trivial tasks:** Mandatory brief plan + file list before editing.
- **Large tasks:** Create `.planning/<task-slug>/`.
    - `PLAN.md`: Action steps.
    - `CONTEXT.md`: Key observations/file refs.
    - `WORKLOG.md`: Progress log.
- **Small tasks:** No separate planning folder required.
- **Workflow:** No unauthorized commits. No "silent" refactoring.

## 4. Knowledge Log (LEARNINGS.md)
Record only non-obvious items:
- Tricky bugs & environment gotchas.
- Docs vs. Reality mismatches.
- Temporary workarounds & engineering trade-offs.
*Skip trivial/obvious details.*

## 5. Maintenance Checklist
When adapting for a new project:
- Define project goal, core commands, and directory map.
- List specific security/deploy constraints.
- Remove redundant README info and obsolete paths.
</project_guide>