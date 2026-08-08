# SPEC: <Project Name>

> **Project folder:** `<repo-relative path, e.g. tools/applet_scripts/smr_outlet_pigtail>`
> **Spec generated:** `<YYYY-MM-DD>`  ·  **Source revision:** `<git rev / branch, or "unknown">`
> **Status:** Shareable second-memory spec. Read this before working on the project or drafting a PRD for it.

## 1. Purpose & Context

_What problem does this project solve, in domain terms? Who runs it and why? Where does it sit in the larger Akselos platform (HUI / dashboard / SCRBE / SDK / papp)?_

## 2. Entry Points

_The files meant to be run or imported by outsiders — the doors into the project._

| Entry point | Kind (script / export / CLI) | What it does | Defined at |
|-------------|------------------------------|--------------|------------|
| `run_creep_analysis.py` | applet script | ... | `<path:line>` |

## 3. Architecture

_Internal modules grouped by responsibility, and how they depend on each other. A short dependency sketch or bullet tree is enough — no need to list every file._

```
<module A>  ──uses──▶  <module B>
   │
   └──uses──▶  <util module>
```

- **<group, e.g. pre-processing>** — `<files>` — responsibility
- **<group, e.g. calculation>** — `<files>` — responsibility
- **<group, e.g. post-processing / upload>** — `<files>` — responsibility

## 4. Public API Surface

_The functions/classes/constants an outside caller uses. Public = meant to be called; keep internal helpers out (mention them under Architecture instead)._

| Name | Signature (abbreviated) | Purpose | Returns | Defined at |
|------|-------------------------|---------|---------|------------|
| `func_name` | `func_name(a: T, b: T = ...) -> R` | ... | `<shape>` | `<path:line>` |

## 5. Data Models & Schemas

_The shapes of data flowing through: dataclasses, dicts, DB/BigQuery schemas, file formats (CSV columns, JSON payloads, pub/sub messages, exodus, etc.). Give field names and types._

- **`<TypeName>`** (`<path:line>`) — fields: `field: type` · `field: type` · ...
- **`<CSV/BigQuery table>`** — columns: `col (type)`, ...
- **`<pub/sub / payload>`** — `{ key: type, ... }`

## 6. End-to-End Workflow

_The followable sequence of one run: inputs → step → outputs at each stage, including side effects (files written, cloud uploads, notifications). A reader should be able to trace a full run._

1. **<step>** — input: `<...>` → does `<...>` → output: `<...>`  (`<entry/func path:line>`)
2. **<step>** — ...
3. **<step>** — side effects: `<files written / BigQuery upload / pub/sub / notification>`

## 7. External Dependencies & Integrations

_SDK modules, cloud services, servers, and other projects this one couples to._

- **SDK:** `import akselos as ak` — `<which parts>`
- **Cloud:** `<BigQuery dataset/table, pub/sub topic, storage bucket>`
- **Servers / other projects:** `<...>`

## 8. Gotchas & Constraints

_Non-obvious things that will bite a newcomer._

- `<ordering requirement, env/secret need, deprecated *_old.py paths, banned APIs, restricted dirs, fragile spots>`

## 9. Where to Start (for a new task)

_Pointers a developer picking up a task would want: "to change X, edit Y"; the natural extension points; the relevant tests._

- To modify `<behavior>`, start at `<path:line>`.
- Tests: `<tests/src/... path>`
- Extension points: `<...>`

## 10. Open Questions

_Things not determinable with confidence from the code. Do NOT resolve these by guessing in the body above._

- `<question>`

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| `<YYYY-MM-DD>` | Initial spec | — |
