# Papp backend — structure & conventions

Extracted from the real code; when in doubt the code wins. Reference papp:
`dashboard/papps/backends/coker_dashboard/`.

## Anatomy of a backend papp

```
backends/{papp}/
├── papp_main.py       # FastAPI entry — uvicorn looks for the `fast_api` variable (don't rename)
├── papp_type.json     # declaration: env vars, parameters, dependencies, run_type
├── TAG                # deploy tag
├── routers/           # one file per resource + __init__.py exporting {resource}_router
├── schemas/           # pydantic/SQLModel response models; __init__.py star-imports all
├── tenants/ + tenant_config.py   # per-tenant config (feature flags the frontend reads)
└── dist/              # built frontend (vite build output; served by get_fast_api)
```

`papp_main.py` pattern (copy verbatim shape):

```python
import set_akselos_path  # noqa: F401
import papp_components.exceptions as pe
import papp_components.papp_base as pab
from routers import (..., crack_status_router, ...)

fast_api = pab.get_fast_api()                      # also serves dist/ (frontend) at /
fast_api.add_exception_handler(pe.PappException, pe.papp_exception_handler)
fast_api.include_router(crack_status_router)       # one line per router

if __name__ == "__main__":
    pab.debug_service(fast_api, collections_path, papp_instance_id=1)  # local dev run
```

## Router idiom

From `routers/crack_status.py` — the canonical read endpoint:

```python
import fastapi as fapi
import sqlmodel as sm
import papp_components.db_schemas.coker.tables as dbs
import papp_components.exceptions as pe
import papp_components.papp_base as pab
import schemas as sch

router = fapi.APIRouter(tags=["Crack Status"])
PAPP_BASE = pab.PappBase()

@router.get("/crack-status/cycles")
def get_crack_cycles() -> list[int]:
    """Get cycle IDs that have live crack analysis results, sorted descending."""
    try:
        sqla_session_maker = PAPP_BASE.get_sqla_sessionmaker()
        with sqla_session_maker() as session:
            statement = sm.select(dbs.CokerCrackResult.cycle_id).where(...).distinct(...)
            rows = list(session.exec(statement).all())
            if len(rows) == 0:
                raise pe.NotFoundException("Crack Cycles not found")
            return sorted(rows, reverse=True)
    except Exception as e:
        raise pe.ServerException(f"Unable to get crack cycles: {e}") from e
```

Rules encoded there:

- Paths are `/{resource}/...` kebab-case; the frontend calls the same path **relative**
  (no host, no papp prefix) via its `apiClient`.
- Return type annotation = response schema; FastAPI serializes it. Multi-table reads use
  `sm.select(colA, colB, ...)` with `.join`/`.outerjoin`, then map rows into `sch.X(...)`
  explicitly (rounding/derivation happens here, at the edge).
- Error contract: `pe.NotFoundException` (404-shaped) for missing data; wrap everything
  else in `pe.ServerException(f"context: {e}") from e`. The handler registered in
  `papp_main.py` turns these into `{"message": ...}` JSON with the right status code —
  never return raw 500s or hand-built JSONResponses.
- Sessions come from `PAPP_BASE.get_sqla_sessionmaker()` in a `with` block — no
  module-level sessions, no manual engine creation.
- Every handler has a one-line docstring (Google style).

## Endpoint quality rules

Three rules every endpoint must satisfy (they're cheap to follow at write time and
expensive to retrofit):

**1. Optimize the query, not the Python.** The database is far better at filtering than
a Python loop, and papp tables can be large (time-series sensor values, per-cycle
results):

- Push `where`/`join`/`outerjoin`/`distinct`/`order_by`/`limit` into the `sm.select(...)`
  statement; select only the columns the response needs (see the crack_status example —
  it selects 12 named columns across 3 tables in ONE statement, not whole models).
- Never fetch-all-then-filter in Python, and never run a query inside a `for` loop over
  ids (N+1) — restructure as one joined/`in_(...)` query.
- Post-processing that SQL can't express (rounding, label formatting) happens once, at
  the edge, when mapping rows into the response schema.
- For a new table (R4), add indexes on columns the queries will filter/join on
  (`sm.Field(index=True)` on FKs and frequent `where` columns).

**2. Types are the API documentation.** FastAPI generates the Swagger UI (`/docs`) and
OpenAPI spec from the return annotation and schema classes — and the frontend developer
reads field names/types from there:

- Every handler has a precise return annotation (`-> list[sch.CrackResult]`), never
  `-> dict`, `-> tp.Any`, or a hand-built `JSONResponse`.
- Schema fields are precisely typed: nullable as `float | None` (so the frontend knows to
  guard), datetimes as `dt.datetime`, enums as real enums (they render as dropdowns in
  Swagger and mirror into the frontend TS enum).
- Give schema classes a docstring and fields a `description=` — both surface in Swagger.
- The frontend type in `types/{feature}.ts` mirrors the schema field-for-field; when you
  add/rename a schema field, update the TS type in the same change.

**3. try/except around every failure-prone step.** DB queries, object-storage reads,
file parsing, external calls — anything that can raise gets the standard wrap so the
client receives a structured error instead of a bare 500 stack trace:

- Missing data → `raise pe.NotFoundException("X not found")`. **Caveat in the reference
  code:** crack_status.py raises it *inside* the `try`, where the generic
  `except Exception` catches it and re-wraps it as `ServerException` — the intended 404
  silently becomes a 500. Don't copy that part. Either re-raise papp exceptions before
  the generic wrap:

  ```python
  except pe.PappException:
      raise
  except Exception as e:
      raise pe.ServerException(f"Unable to <do X>: {e}") from e
  ```

  or do the emptiness check after the `try` block.
- Everything unexpected → `raise pe.ServerException(f"Unable to <do X>: {e}") from e` —
  the message names the operation (shows up in logs and the client's `{"message": ...}`).
- Same discipline for non-HTTP processes (jobs, parsers): fail with context, never
  swallow exceptions silently.

`PappBase` also provides (use instead of reinventing): `create_object_storage_helper()` +
`get_cached_file_response_from_storage(path)` for serving images/files from object
storage, `create_sql_helper`, `create_publish_helper`/`publish_result` (pub/sub),
`create_heartbeat_helper`, `get_collection_path`. `PappJob` extends it for job-type papps
(`run_type: "job"` — see the `*_job` backends).

## papp_type.json

Declares what the papp needs; deployment provisions it. Key fields (see coker's):

- `ui_name`, `run_type` (`"service"` for dashboards, job papps differ),
- `env_variables` (values starting `^` are parameter references, e.g. `"^tenant_name"`),
- `parameters` (e.g. `tenant_name`),
- `dependencies`: `OBJECT_STORAGE` (family `object_storage_helper`), `SQL` (family
  `sql_helper`), and **one `table_{__tablename__}` entry per DB table the papp reads** —
  a new table isn't visible to the papp until it's listed here.

## DB layer (`tools/papp_components/db_schemas/`)

- One folder per table group (`coker`, `aiv`, `drum`, `example`, `mini_job_db`), each
  with `tables.py` + `versions/` (alembic revisions, numbered `0001_...py`) and
  optionally a generated `schema.json`.
- Models: `class CokerSensor(sm.SQLModel, table=True)` with snake_case `__tablename__`,
  class docstring, `description=` on every `sm.Field`, helpers from
  `papp_components.db_schemas.utils` (`create_primary_uuid_field`,
  `create_datetime_field`), FKs as `sm.Field(foreign_key="table.col")`, and a
  `BIGQUERY_STR: tp.ClassVar[str]` JSON column spec kept in sync with the fields.
- Type convention: percentage floats are stored **pre-multiplied** (`50.0` means 50%) —
  ready for display, never divide/multiply on read.
- Migrations: `python generate_migration.py {group} "title"` (run inside
  `tools/papp_components/db_schemas/`) autogenerates a revision by diffing `tables.py`
  against the applied revisions on a temp sqlite; `--disable-autogenerate` for a manual
  skeleton. Always read + verify the generated upgrade/downgrade. Applying migrations to
  a real DB is environment-specific and user-confirmed — local sqlite setups and seeding
  scripts vary per developer (private, untracked tooling; ask the user about theirs).

## Tenancy & safety notes

- Papps are instantiated per tenant (`TENANT_NAME` env from the `tenant_name` parameter);
  `tenant_config.py` + `tenants/` control per-tenant features the frontend reads via
  `useTenantConfig().features`. New behavior that should not apply to every tenant needs
  a feature flag there, not a hardcode.
- Data in the papp DB may be tenant-scoped by construction (separate DB per instance) —
  still, any new *write* path must be reviewed for who can call it; there is no
  per-endpoint auth layer inside the papp itself.
- `scrbe/` is off-limits (proprietary). Local seeding/import scripts and `mock_data/`
  folders in a developer's checkout are personal tooling — not part of the repo standard.

## Verify

- `ruff format .` / `ruff check .` / `ty check .` from repo root (line length 320,
  import-alias conventions enforced; banned APIs: `pickle`, `os.system`, `os.popen`,
  `os.chdir`, `sys.path.append/insert`).
- Tests (if any exist for the touched area) live under `tests/src/` mirroring `tools/`;
  run with `pytest tests/src/path/to/test.py`.
- `python papp_main.py` runs the papp via `pab.debug_service(...)` against a real
  collections path — a user-assisted step, not something to launch unprompted.
