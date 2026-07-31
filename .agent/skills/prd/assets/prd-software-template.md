# PRD: <Feature / Task Name>

> **Project:** `<project-name>`  ·  **Project folder:** `<repo-relative path>`
> **Related spec:** `../SPEC.md` (project-harness second-memory spec)
> **Requested by (engineer):** `<name>`  ·  **Date:** `<YYYY-MM-DD>`
> **Audience:** the developer implementing this. Read the spec first for project context.

## 1. Summary & Context

_What is being requested and why. One paragraph. What triggered this task (new analysis need, bug, customer ask)? What in the current project does it build on? (Link the spec's relevant sections.)_

## 2. Goals & Success Criteria

_What "done" looks like, stated measurably._

- Goal: `<...>`
- Success: `<observable, checkable outcome>`

## 3. Functional Requirements

_Numbered and individually testable._

- **REQ-01** — `<behavior the system must exhibit>`
- **REQ-02** — `<input → expected output>`
- **REQ-03** — `<edge case / error handling>`

## 4. Interfaces & Data

_The concrete touchpoints the developer will implement against. Reference the spec's API and data-model sections._

- **New / changed functions or modules:** `<name(signature) at path:line — add | modify>`
- **Input data:** `<shape / source>`
- **Output data:** `<shape / destination — file, return value, table>`
- **Schema / table changes:** `<BigQuery table, CSV columns, payload fields>`
- **Config / arguments:** `<new flags, settings>`

## 5. Non-Goals (Out of Scope)

_What this task explicitly does not cover._

- `<...>`

## 6. Constraints & Compatibility

- **Performance:** `<limits, expected data volume>`
- **Backward compatibility:** `<what must not break — existing runs, outputs>`
- **Cloud / side effects:** `<BigQuery, pub/sub, storage, notifications>`
- **Codebase rules:** no banned APIs (`pickle`, `os.system`, …); never touch `scrbe/`; follow ruff conventions.

## 7. Acceptance & Verification

_How the developer proves it works._

- **Test case(s):** `<input → expected value/output>`
- **Comparison run:** `<baseline to match, if applicable>`
- **Tests location:** `tests/src/<mirrored path>`

## 8. Open Questions & Risks

- `<unresolved decision, dependency, or long-lead risk>`

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| `<YYYY-MM-DD>` | Initial PRD | — |
