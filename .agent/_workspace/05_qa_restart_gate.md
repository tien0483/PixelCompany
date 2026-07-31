# 05 — QA: restart-data readiness gate on the What-If chain

**QA agent:** smr-qa
**Date:** 2026-07-03
**Scope (changed files):**
- `tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py`
- `tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py`

## Summary verdict: PASS (with expected infra block on solve-based tests)

- ruff check: **PASS**
- ty check: **PASS** (no diagnostics against the changed files)
- AST parse sanity: **PASS**
- pytest fast cases (`test_get_previous_month_start_stop`): **PASS (6/6)**
- pytest solve-based cases: **BLOCKED** — hang waiting on SCRBE @ 127.0.0.1:8000 / ref-collection setup (not a fabricated pass; see below)
- Boundary / logic cross-check: **PASS** on all points

---

## Check 1 — ruff check

`ruff` not on PATH; ran via `python -m ruff` (uv path failed on `.venv\lib64` access-denied, unrelated).

Command:
```
python -m ruff check tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py
```
Output:
```
All checks passed!
```
**PASS.** (Per instructions, `ruff format` was NOT run.)

## Check 2 — ty check

`ty` not on PATH; ran via `python -m ty check <both files>`.

Result: `Found 49 diagnostics` — **all are `warning[unknown-rule]` pointing at `ty.toml` lines** (config/version drift, pre-existing, repo-wide). None reference the two changed files.

Filter confirming no file-level diagnostics:
```
python -m ty check <both files> | grep -iE "run_creep_analysis|test_run_creep_analysis|error\[" | grep -v "unknown-rule"
-> NO_FILE_LEVEL_DIAGNOSTICS
```
**PASS** for the changed files. (The 49 `ty.toml` unknown-rule warnings are out of scope / pre-existing.)

## Check 3 — AST sanity + pytest

AST parse:
```
python -> ast.parse(test_run_creep_analysis.py) -> AST_PARSE_OK
```
**PASS.**

pytest full file (`python -m pytest .../test_run_creep_analysis.py -q`): background run produced **no pass/fail line after ~3.5 min** — hangs. Isolating:

- Fast cases:
  ```
  python -m pytest ".../test_run_creep_analysis.py::test_get_previous_month_start_stop" -q
  -> 6 passed, 2 warnings in 0.93s   (EXIT=0)
  ```
  **PASS (6/6).**

- Solve-based case (`::test_smr_pigtail_outlet_creep_no_whatif_chain_when_restart_missing`) under a 90s `timeout`: **no result line emitted; killed by timeout** — confirms it blocks in fixture/solve setup reaching SCRBE @ 127.0.0.1:8000. The other two solve tests (`test_smr_pigtail_outlet_creep`, `..._no_whatif_chain_when_incomplete`) go through the same `rc.go()` solve path and are blocked for the same reason.

  Note: direct `curl` reachability probe of 127.0.0.1:8000 is denied by user deny-rule; the hang itself is the evidence. **BLOCKED — reported verbatim, not fabricated as pass.**

---

## Boundary / logic cross-check (source-cited)

### 1. Producer/consumer folder string match — CONFIRMED IDENTICAL
- **Consumer (this change):** `run_creep_analysis.py:141-142`
  ```
  folder = workspace.restart_data_dir.joinpath(
      workspace.get_creep_restart_data_folder(unit, sensor_date_str, short_job_id))
  ```
- **Producer (live solve):** `pre_processing.py:181-182`
  ```
  solver_option.set_data(context, "path_to_output_saved_solution", self.workspace.get_creep_restart_data_folder(
      unit=unit, sensor_date_str=self.configs.sensor_date_str, short_job_id=applet_job_id))
  ```
- Both call the **single source of truth** `workspace.py:164-170`:
  ```
  @staticmethod
  def get_creep_restart_data_folder(unit, sensor_date_str, short_job_id) -> str:
      return f"Unit_{unit}_{sensor_date_str}_{short_job_id}"
  ```
  Producer writes the folder as `restart_data_dir` (base) + this name; consumer probes `restart_data_dir.joinpath(<same name>)`. **Exact match.** Note the producer's `sensor_date_str`/`applet_job_id` originate from `configs.sensor_date_str` and the `short_job_id` passed to `PreProcessing.go`, which is the same `short_job_id` used at the consumer call site (`run_creep_analysis.py:175`, `:186 go(applet_job_id=short_job_id)`).

### 2. Guard wraps the chain call; all names in scope — CONFIRMED
- `run_creep_analysis.py:306-307`:
  ```
  if this_run_restart_data_ready(workspace, succeeded_units, configs.sensor_date_str, short_job_id):
      trigger_whatif_applet(args)
  ```
  Sits inside `if all_units_present:` (opened at `:267`), itself inside `if args.is_run_creep_analysis and len(succeeded_units) > 0:` (`:244`).
- Scope at call site: `workspace` (`:150`), `succeeded_units` (`:179`, appended `:239`), `configs` (`:161`) so `configs.sensor_date_str` valid, `short_job_id` (`:175`). All defined before `:306`. **PASS.**

### 3. Empty-folder check guarded against missing dir — CONFIRMED
- `run_creep_analysis.py:143`:
  ```
  if not folder.is_dir() or not any(folder.iterdir()):
  ```
  Short-circuit `or`: when `folder.is_dir()` is False, `not folder.is_dir()` is True and the whole condition is True **without evaluating `folder.iterdir()`** — so `iterdir()` (which would raise on a missing dir) only runs when `is_dir()` is True. **PASS.**

### 4. Three tests internally consistent — CONFIRMED
- **Positive** `test_smr_pigtail_outlet_creep` (test file `:83,86,95`): `check_all_units_data_present -> True` and `rc.this_run_restart_data_ready -> True`; asserts `len(whatif_calls) == 1`.
- **Incomplete** `..._no_whatif_chain_when_incomplete` (`:205,212`): `check_all_units_data_present -> False` (so `all_units_present` block skipped); asserts `whatif_calls == []`.
- **Restart-missing** `..._no_whatif_chain_when_restart_missing` (`:241-242,249`): `check_all_units_data_present -> True` + `rc.this_run_restart_data_ready -> False`; asserts `whatif_calls == []`.
- **Monkeypatch target correctness:** tests patch module attribute `monkeypatch.setattr(rc, "this_run_restart_data_ready", ...)` (`:86`, `:242`), and `go()` calls it as a bare module-level name `this_run_restart_data_ready(...)` at `:306` (same module), so the patch on `rc.<name>` intercepts the call. **PASS.**

### 5. Numeric-config / omega sanity — CONFIRMED
- `test_run_creep_analysis.py:69` still `'--omega-m-max', '2000'` (NOT 1000).
- Omega modification flag is OFF: only the positive test forwards omega args, and it does **not** pass `--omega-parameter-modification`, so `trigger_whatif_applet` omits the omega group (`run_creep_analysis.py:116-122`).
- Omega assertion is the "not in" form: `test_run_creep_analysis.py:108` `assert "--omega-parameter-modification" not in whatif_data`.
- **Stale claim in `.agent/_workspace/02_cloud_whatif_chain.md` about "omega 1000" is incorrect** per the actual test file. **PASS.**

---

## Fixes required
None. No failures attributable to the change. The only non-green item is the SCRBE-dependent pytest cases, which are an environment/infra block (no solver at 127.0.0.1:8000), not a code defect.
