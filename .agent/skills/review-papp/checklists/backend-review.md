# Backend review checklist (papp)

Domain checklist for reviewing code under `dashboard/papps/backends/` and
`tools/papp_components/` (incl. `db_schemas/`). Used either inline by the main reviewer
or by a spawned backend-review subagent. Read the shared standards first:
`.claude/skills/_shared/papp-standards/backend-standards.md` — it holds the papp anatomy,
the canonical router idiom, `papp_type.json`, the DB layer, and the "Endpoint quality
rules" this checklist enforces.

Reference papp: `backends/coker_dashboard/`. Note its routers carry one known bug —
`NotFoundException` raised inside a generic `except Exception` wrapper gets re-wrapped
into a 500 — so "the reference does it" is not a defense for that pattern.

## Working method

**Scale to the diff:** run only the checks the changed code could violate — no queries
touched means no query/performance pass, no schema/migration in the diff means dimension
5 is skipped, a docstring-only change needs none of this. The dimensions below are the
full menu, not a mandatory sequence.

1. Read the shared backend standards, then the changed files **in full**. For a router
   change, also open the SQLModel tables it queries (`db_schemas/{group}/tables.py`) —
   most backend bugs live in the gap between the query and the schema (wrong join key,
   filter on a nullable column, missing scenario/tenant scoping).
2. Mechanical checks: `ruff check` on changed files; grep for banned APIs (`pickle`,
   `os.system`, `os.popen`, `os.chdir`, `sys.path.append/insert`), module-level
   sessions/engines, `-> dict` / `-> tp.Any` / raw `JSONResponse` returns, missing
   copyright header.
3. **Write-path scrutiny:** anything in the diff that mutates data — POST/PUT/DELETE
   handlers, `session.add/delete/commit`, alembic revisions, scripts touching a DB —
   gets the highest scrutiny tier (see dimension 5) and must be called out prominently
   in the findings even when correct, so the human reviewer sees the blast radius.
4. Verify each finding before reporting — confirm the failure scenario against the
   actual table definitions and calling code.

## Dimensions

### 1. Correctness & data semantics

- Query correctness: join keys match the FK definitions in `tables.py`; filters include
  the scoping columns the domain requires (e.g. `scenario_name == "live"`); `outerjoin`
  vs `join` chosen deliberately (an inner join silently drops rows with missing
  relations — is that intended?).
- Null discipline: nullable columns (`x | None` in the model) are guarded before
  arithmetic/`round(...)`; the response schema types them `| None` so the frontend knows.
- Unit/format conventions: percentages are stored **pre-multiplied** (`50.0` = 50%) —
  flag any `/100` or `*100` on read; datetimes are UTC; rounding happens once, at the
  edge, when mapping rows into the response schema.
- Sorting/defaults that the frontend relies on ("first = latest") must be explicit in
  the query or documented in the docstring — not an accident of insertion order.

### 2. Performance

- Filtering/joining/limiting happens in SQL (`where`/`join`/`distinct`/`order_by`/
  `limit`), selecting only needed columns — never fetch-all-then-filter in Python, never
  a query inside a loop over ids (N+1 → one joined/`in_(...)` query). Papp tables can be
  large (time-series sensor values, per-cycle results).
- New tables/columns that queries filter or join on get `index=True`.
- Repeated blob/file serving goes through `PappBase` caching helpers
  (`get_cached_file_response_from_storage/disk`), not re-downloads.
- Watch response size: an endpoint returning unbounded rows to a dashboard (no limit, no
  aggregation) is a finding — the frontend charts will choke long before the DB does.
- **Python-level efficiency** (after the SQL is right, check the Python around it):
  - *Time:* right data structure for the job — membership tests and lookups inside a
    loop use a `set`/`dict` built once, not `x in some_list` scans (hidden O(n²));
    prefer builtins (`sum`, `max`, `min`, `any`, `sorted(key=...)`) over hand-rolled
    accumulation loops; don't recompute the same derivation inside a loop body.
  - *Memory:* don't materialize what you only iterate — generator expressions /
    iterating the result cursor instead of `list(...)`-ing large result sets and then
    transforming into more intermediate lists; avoid needless copies (row → dict →
    schema when row → schema works).
  - *Idiom:* prefer comprehensions (`[f(r) for r in rows if ...]`) over append-loops
    where they stay readable — the repo's mapping-rows-to-schemas idiom is exactly
    this. "Where possible" is the bar: a comprehension that needs three nested
    conditions is worse than a clear loop — readability wins ties.

### 3. API contract & types (Swagger is the documentation)

- Every handler: precise return annotation (`-> list[sch.X]`), one-line docstring, path
  in kebab-case `/{resource}/...`, registered in `routers/__init__.py` + `papp_main.py`.
- Schemas: precisely typed fields (`float | None` for nullable, `dt.datetime`, real
  enums), class docstring, `description=` on fields — all of it surfaces in `/docs` and
  is what the frontend developer reads.
- **Cross-stack contract:** a schema field added/renamed/retyped must be mirrored in the
  frontend TS type (`frontends/src/{papp}/types/{feature}.ts`) in the same change; an
  endpoint path change must be mirrored in the frontend service. If the frontend side of
  the diff is being reviewed separately, report the contract change so the synthesizer
  can cross-check.
- No hand-built `JSONResponse`, no `-> dict`, no undocumented query params.

### 4. Error handling

- Every failure-prone step (DB access, object-storage reads, parsing) is wrapped:
  missing data → `pe.NotFoundException("X not found")`; unexpected →
  `pe.ServerException(f"Unable to <do X>: {e}") from e` (message names the operation).
- **The 404→500 trap:** `pe.NotFoundException` raised inside a `try` whose
  `except Exception` re-wraps into `ServerException` turns the 404 into a 500. Correct
  form adds a pass-through before the generic wrap:
  ```python
  except pe.PappException:
      raise
  except Exception as e:
      raise pe.ServerException(f"Unable to <do X>: {e}") from e
  ```
  Existing routers contain the broken form — new code must not copy it.
- No silently swallowed exceptions (`except: pass`), no bare 500s, no stack traces in
  client-facing messages (context string yes, internals no).

### 5. DB writes, schema & migrations — highest scrutiny

- A schema change is complete only as a set: model change in `tables.py` (docstring +
  `description=` on new fields + `BIGQUERY_STR` kept in sync) + generated alembic
  revision in `versions/` (read the upgrade AND downgrade — autogenerate gets defaults,
  server-side types, and drops wrong often enough to check every line) + a
  `table_{tablename}` dependency in `papp_type.json` for each papp that reads it.
  A partial set is a Blocker.
- Mutating endpoints: mutations inside one session context; idempotency/duplicate-call
  behavior considered; who can call it — papps have no per-endpoint auth layer, so a
  write endpoint reachable by any tenant user must be flagged for the author to justify.
- Tenancy: per-tenant behavior goes through `tenant_config.py`/feature flags, never a
  hardcoded tenant name in logic.
- Data-mutation scripts in the diff (backfills, fixups) must state which DB they target
  and be gated on explicit confirmation — flag any that could run against a shared DB.

### 6. Python conventions & hygiene

- Repo style: copyright header `# Copyright (C) 2026 Akselos`; import aliases
  (`import fastapi as fapi`, `import sqlmodel as sm`, `import typing as tp`,
  `papp_components.papp_base as pab`, `papp_components.exceptions as pe`); lowercase
  generics; Google docstrings; line length 320 (don't flag long lines); `collections.abc`
  over `typing` equivalents.
- Sessions from `PAPP_BASE.get_sqla_sessionmaker()` in `with` blocks only — no
  module-level sessions, no manual engines, no leaked connections on early returns.
- Reuse `PappBase` helpers (object storage, publish, heartbeat) instead of reimplementing.
- Never touch `scrbe/`. Personal local tooling (seeding scripts, local sqlite helpers)
  must not be referenced by shared code.

## Verify commands

From repo root: `ruff format --check .` (or on changed files), `ruff check .`,
`ty check .`. Tests, if any exist for the touched area, live under `tests/src/`
mirroring `tools/` — `pytest tests/src/path/to/test.py`. Running a papp service locally
(`python papp_main.py` → `debug_service`) touches real collections — do not launch it
as part of a review.
