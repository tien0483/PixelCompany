---
name: implement-papp
description: Implement features in the Akselos papp platform (dashboard/papps — FastAPI backend papps + React/TS frontends + SQLModel DB layer), end-to-end (API endpoint → frontend service/hook → page/chart → DB table when needed), following the repo's established standards. Use whenever asked to build, add, or change papp functionality. Safe for non-developer users: it explains steps in plain language and gates every database write behind explicit user confirmation.
---

# Implement a papp feature

Build papp features by following the recipes below instead of re-deriving structure from
the codebase. Three goals shape every rule here:

1. **Fast** — each recipe names the exact files to touch and a canonical example to copy.
2. **Token-lean** — this skill *is* the map. Read only what the recipe lists for the
   domain(s) you touch; no broad repo exploration; no re-reading docs already in context.
   Smallest change wins: touch only the layers the feature needs, skip recipe steps whose
   subject doesn't apply, never create files/abstractions the feature doesn't require
   (structure rules are ceilings, not quotas).
3. **Safe for non-developers** — the user may not read code. Restate the plan in plain
   language before starting; report in plain language after. Ask ALL clarifying
   questions in **one batch** up front (AskUserQuestion), then build without
   interruptions — except the DB gate below.

**Read on demand, never all of it:**

- `.claude/skills/_shared/papp-standards/backend-standards.md` / `frontend-standards.md`
  — only for the domain(s) being touched (shared with `review-papp`: one source of truth).
- The `refactor-coker-page` skill — only when creating a full page (3-file split, SCSS BEM).
- [references/fanout.md](references/fanout.md) — only if the user picks fan-out mode.

## ⚠️ The database gate — read this first

Papp DBs are shared, tenant-scoped resources (cloud Postgres/BigQuery in production;
sqlite locally). The rule:

- **Read is free.** GET endpoints, `SELECT` queries, adding a read-only API — implement
  without asking. This is the default papp shape: almost every existing endpoint is a GET.
- **Write requires explicit user confirmation — every time, before writing the code AND
  again before running anything.** "Write" means any of:
  - a POST/PUT/PATCH/DELETE endpoint that INSERTs/UPDATEs/DELETEs rows;
  - a schema change: new table, new/renamed/dropped column, type change;
  - generating or applying an **alembic migration** (a migration is a write);
  - running any script or command that mutates a database — including local dev DBs.

  When confirming, tell the user in plain language: *what* data/table changes, *which*
  database (their local sqlite vs a shared/tenant DB — never assume local), whether it's
  reversible, and what the alternative is. Use AskUserQuestion; if they decline, deliver
  the read-only part and stop.
- **Local data seeding is personal.** Seeding scripts and mock-data folders in a
  developer's checkout are private local tooling, not repo standards — never treat one
  as canonical, never run it unprompted; when local test data is needed, ask the user
  how *they* load it.

## The map
| Piece | Where | Notes |
|---|---|---|
| Backend papp | `dashboard/papps/backends/{papp}/` | `papp_main.py` (FastAPI entry), `papp_type.json` (deps/env), `routers/`, `schemas/`, `tenants/` |
| Frontend app | `dashboard/papps/frontends/src/{papp}/` | pages/, components/, ServerCommunication/, zustand/, types/ |
| Framework | `tools/papp_components/` | `papp_base.py` (PappBase, get_fast_api, debug_service), `exceptions.py` |
| DB models | `tools/papp_components/db_schemas/{group}/tables.py` | SQLModel; migrations in sibling `versions/` |
| Reference papp | `coker_dashboard` (backend + frontend) | copy its idioms; Home page = frontend gold standard |

URL wiring: a router path like `/crack-status/cycles` is called from the frontend service
as the **relative** path `crack-status/cycles` (the papp is mounted per-instance; never
hardcode a host or papp prefix).

Python conventions (repo-wide, enforced by ruff/ty): copyright header
`# Copyright (C) 2026 Akselos`; import aliases `import fastapi as fapi`,
`import sqlmodel as sm`, `import typing as tp`, `import papp_components.papp_base as pab`,
`import papp_components.exceptions as pe`; lowercase generics (`list[int]`); Google-style
docstrings; line length 320 (don't wrap early); banned: `pickle`, `os.system`,
`sys.path.append`. Never touch `scrbe/`.

## Execution modes — the user picks

Single-domain or small task → work inline, don't ask, say so in one line. When the
feature spans backend AND frontend with real work on both sides, ask (AskUserQuestion,
folded into the same batch as the clarifying questions; put the scope-appropriate option
first with "(Recommended)"):

- **1 agent (inline)** — cheapest in tokens, one continuous narrative (best for a
  non-developer), contract consistent by construction, can pause to ask the user any
  time; risk: slower wall-clock on a large full-stack feature.
- **Subagents (fan-out)** — backend + frontend build in parallel, faster on big
  features; risks: more tokens, contract drift if the API shape wasn't pinned down
  before spawning, subagents can't ask the user anything, integration issues surface
  only at the merge step.

If the user already stated a preference, honor it without asking. Fan-out chosen → read
`references/fanout.md` and follow its strict order.

## Recipes

Pick the smallest recipe that covers the request; chain them for end-to-end features
(e.g. new page showing new data = R1 + R2). Before coding, tell the user which recipe(s)
you're following and which files will change.

### R1 — New read-only API endpoint (backend → frontend)

1. **Backend router** — add a function to the matching `routers/{resource}.py` (new file
   only for a genuinely new resource; then register it in `routers/__init__.py` and
   `papp_main.py` `include_router`). Copy the idiom from
   `backends/coker_dashboard/routers/crack_status.py`: module-level
   `router = fapi.APIRouter(tags=[...])` + `PAPP_BASE = pab.PappBase()`; handler opens
   `PAPP_BASE.get_sqla_sessionmaker()` in a `with` block, builds `sm.select(...)` against
   `db_schemas.{group}.tables` models, returns typed data. Apply the three **"Endpoint
   quality rules"** from the shared backend-standards.md (read that section): SQL-side
   filtering/joins/limits — no fetch-all or N+1; precise types + `description=`
   everywhere — Swagger `/docs` and the frontend read them; try/except with
   `pe.NotFoundException` / `pe.ServerException(f"...: {e}") from e` (mind the 404→500
   trap documented there).
2. **Response schema** — pydantic/SQLModel class in `schemas/{resource}.py`, exported via
   the star-import barrel `schemas/__init__.py`.
3. **Frontend service** — one `async` function in
   `frontends/src/{papp}/ServerCommunication/{resource}.service.ts`:
   `apiClient.get<T>("relative/path")` → return `response.data`; blobs/images via
   `fetchObjectUrl`. Path params via `encodeURIComponent`, query params via `{ params }`.
4. **Frontend hook** — `useQuery` in `zustand/store.tsx`: key includes every argument,
   `enabled:` gate for conditional args, staleTime by tier (Infinity config / 1h slow /
   5m images / 0 live), return renamed fields with a **module-level constant** default.
5. **Types** — response type in `frontends/src/{papp}/types/{feature}.ts`, barrel-exported.
   If it mirrors a backend enum/schema, add the comment pointing at the Python file.

### R2 — New frontend page

Follow the Home pattern (details in the `refactor-coker-page` skill — read it):
`pages/{Page}/{Page}.tsx` (pure view) + `use{Page}.ts` (view-model hook) +
`{page}Utils.ts` (pure logic, only if there is real logic); sub-components in
`components/{Page}/` with a barrel; SCSS at `assets/sass/pages/coker/{page}.scss` in
BEM/kebab with shared tokens/mixins, `@forward`ed in `styles.scss` (grep new class names
for collisions first). Register the route in the app's `App.tsx` switch + nav (respect
the `hasFeature(...)` tenant flags). No `React.lazy` — static import is the house pattern.

### R3 — New chart

Render through `@library/charting` `BaseChart` (never raw echarts / package-root
`echarts-for-react`). Check `src/library/charting/echartsCore.ts`: if the chart type or
component (DataZoom, MarkLine…) isn't registered in `echarts.use([...])`, add it —
missing registration renders a **blank chart with no error**. Build options from
`presets.ts` helpers; colors come from the theme, not hardcoded hex.

### R4 — New DB table or column ⚠️ gated

Confirm with the user first (see the gate). Then:

1. Model in `tools/papp_components/db_schemas/{group}/tables.py`: `class X(sm.SQLModel,
   table=True)` with snake_case `__tablename__`, a class docstring, `description=` on
   every field, `du.create_primary_uuid_field()` / `du.create_datetime_field()` helpers,
   and the `BIGQUERY_STR: tp.ClassVar[str]` column listing kept in sync. Note the repo
   type convention: percentages are stored pre-multiplied (`50.0` = 50%).
2. Generate the migration: `python tools/papp_components/db_schemas/generate_migration.py
   {group} "short title"` — then **read the generated file in `{group}/versions/`** and
   verify the autogenerated upgrade/downgrade matches the intent before it goes anywhere.
3. Add the `table_{tablename}` dependency entry to the papp's `papp_type.json`.
4. Applying the migration to any real DB, and loading data into the new table, are
   separate user-confirmed steps — ask how they want to run them (local setups differ).

### R5 — Write/mutating endpoint ⚠️ gated

Papp endpoints are overwhelmingly read-only; a mutating endpoint is an exception, not a
pattern to copy from elsewhere. Confirm with the user (what rows change, which DB, who can
call it), then follow R1's structure with the appropriate HTTP verb, a request-body
schema, and the same session/exception idioms — mutations inside one session context,
`pe.*` exceptions for failure paths. Flag to the user that tenant scoping and permissions
must be considered (see the shared backend-standards.md, "Tenancy & safety notes").

## Verify & report

Scope verification to the change: type-check always; run tests when logic changed; skip
what the change can't have broken.

- Backend: `ruff format .` + `ruff check .` + `ty check .` (repo root). Matching tests
  under `tests/src/` if they exist and need no live resources. Running a papp locally
  (`python papp_main.py` → `pab.debug_service`) touches a real collections path — a
  user-assisted step, never launch it unprompted.
- Frontend (from `dashboard/papps/frontends/`): `npx tsc -p tsconfig.json --noEmit` and
  `npx vitest run` (never from repo root with `--root`).
- **Report for a non-developer:** what you built (feature terms, not file terms), the
  files changed (short list), what was verified and how, and what still needs a human
  step (migration to apply, data to load, deploy). Plain sentences, no jargon without a
  one-phrase explanation.
