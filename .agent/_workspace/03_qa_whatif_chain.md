# 03 — QA: chain What-If applet after successful live creep run

Verifier: smr-qa. Repo: `akselos-dev-2` (master). Shell: Git Bash on Windows.
Toolchain note: `ruff`/`ty` are not on PATH; `uv run` fails on a `.venv` permission
error (`failed to remove file '...\.venv\lib64': Access is denied`). Used the working
interpreter `python -m ruff` / `python -m ty` / `python -m pytest` (ruff 0.13.0,
ty 0.0.1-alpha.20, pytest 8.3.3).

## Summary table

| Check | Result |
|-------|--------|
| 1. ruff format --check | FAIL (would-reformat) — pre-existing whole-file style, NOT introduced by this change; not applied (see below) |
| 2. ruff check | PASS |
| 3. ty check | PASS (exit 0; 49 diagnostics are all `unknown-rule` config warnings from ty.toml, none on the changed files) |
| 4. pytest (whatif tests) | BLOCKED — no SCRBE solver at 127.0.0.1:8000 (environment blocker, not a code defect). Fast tests in the file PASS. |
| Boundary cross-check | PASS (all flags/types/names/gate confirmed) |

---

## Check 1 — ruff format --check

Command:
```
python -m ruff format --check tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py
```
Output:
```
Would reformat: tests\src\tools\applet_scripts\smr_outlet_pigtail\test_run_creep_analysis.py
Would reformat: tools\applet_scripts\smr_outlet_pigtail\run_creep_analysis.py
2 files would be reformatted
EXIT=1
```

Per instructions, ran `--diff` (NOT `format` write) to inspect what differs. The entire
diff is ruff collapsing pre-existing manually-wrapped code onto single lines under the
repo's `line-length = 320` (`ruff.toml:14`). Examples that predate this change and are
the bulk of the diff:
- the `@pytest.mark.parametrize(...)` block for `test_get_previous_month_start_stop`
- `cu.compare_json_items(...)` / `cu.compare_json_files(...)` calls
- `parser.add_argument("--merge-window-days", ...)`, `--log-level`, `--email-recipients`
- `sdp.get_and_process_sensor_data(...)`, `ppu.run_all_post_processing_steps(...)`,
  `ucu.upload_to_cloud(...)`, backslash-continued `ak.CloudTask...` chains

The NEW code specifically added by this change is already conformant — the
`trigger_whatif_applet` body and the test's `whatif_data` assertions / new negative
test produce NO diff of their own.

Decision: NOT applied. Reasons: (a) reformatting would rewrite large amounts of
pre-existing unrelated code across both files (the file was already non-conformant
before this change), and (b) my constraints forbid editing source to work around a
check. This is a pre-existing repo formatting state, flagged here for the implementer.
If a clean `ruff format` is desired it should be a separate, whole-file formatting
commit, not folded into this feature.

## Check 2 — ruff check

Command:
```
python -m ruff check tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py
```
Output:
```
All checks passed!
EXIT=0
```
PASS.

## Check 3 — ty check

Command:
```
python -m ty check tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py
```
Output (tail):
```
Found 49 diagnostics
EXIT=0
```
PASS. Exit 0. All 49 diagnostics are `warning[unknown-rule]` entries pointing at
`ty.toml` (e.g. `abstract-method-in-final-class`, `invalid-argument-type`, ...): the
installed ty alpha (0.0.1-alpha.20, 2025-09-03) predates those rule names in ty.toml.
None reference `run_creep_analysis.py` or `test_run_creep_analysis.py`. No type errors
on the changed code. (Preface warning: "ty is pre-release software...".)

## Check 4 — pytest (whole file)

Command:
```
python -m pytest tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py -v
```
Result: TIMED OUT after 10m (exit 143). Collection is fine (8 tests collected in 1.76s;
neither whatif test is marked `slow` or skipped). The two `test_smr_pigtail_outlet_creep*`
tests perform a REAL solve (`ak.CloudTask.create_from_aks_file(...).submit(...).wait(...)`).

Ran the negative test alone with live logs to capture the blocker verbatim:
```
python -m pytest ".../test_run_creep_analysis.py::test_smr_pigtail_outlet_creep_no_whatif_chain_when_incomplete" -v -s --log-cli-level=INFO
```
The test progresses correctly through preprocessing (parses the args incl. the collection
fixtures) and reaches the solve, then blocks on a refused connection to the local solver:
```
autouse_fixtures.py:88  |W| Found 8 cores when submitting solve in testing, force to 4
cloud_task.py:426       |I| Set `parent_job_id` = pytest-...-test_smr_pigtail_outlet_creep_no_whatif_chain_when_incomplete-...
connection.py:127       |W| RequestException: HTTPConnectionPool(host='127.0.0.1', port=8000): Max retries exceeded with url: /scrbe/akselos/ (Caused by NewConnectionError('...: Failed to establish a new connection: [WinError 10061] No connection could be made because the target machine actively refused it'))
connection.py:108       |I| Retrying 'FeSolverSolve' request in 4.0 seconds (retry #1)
... exponential backoff ... Retrying 'FeSolverSolve' request in 128.0 seconds (retry #6)
```
BLOCKER (verbatim): no SCRBE solver server is running at `127.0.0.1:8000` in this
environment; `FeSolverSolve` requests are refused (`WinError 10061`) and the test retries
indefinitely with exponential backoff. This is an environment/infra blocker (missing
solver backend), NOT a defect in the change. Both whatif tests need a live solver to
complete end-to-end; I did NOT fabricate a pass.

Fast tests in the same file (no solver needed) PASS:
```
python -m pytest ".../test_run_creep_analysis.py::test_get_previous_month_start_stop" -v
======================== 6 passed, 2 warnings in 0.79s ========================
```

Consequence for sign-off: the positive/negative whatif assertions could not be executed
here. A machine with the SCRBE solver (or CI with the solver service) must run:
`pytest tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py`
to green before final sign-off. Everything statically verifiable is green.

---

## Boundary cross-check (both sides read)

### A. Every flag in the `data` dict exists in child parser + dashboard JSON, types match

Call site `data` dict: `run_creep_analysis.py:109-123`.
Child parser: `run_creep_analysis_what_if.py:23-32` `get_parser` -> `rc.get_root_parser`
(`run_creep_analysis.py:22-55`). Dashboard JSON: `run_creep_analysis_what_if.json`.

| data key | value (parent dest / type) | child parser (get_root_parser / whatif) | dashboard JSON | match |
|----------|----------------------------|------------------------------------------|----------------|-------|
| `--creep-model` | `args.creep_model` str | `run_creep_analysis.py:40` type=str | `json:91-106` choice (Omega_API in options) | OK |
| `--api-version` | `args.api_version` str | `run_creep_analysis.py:41` type=str | `json:107-122` choice (2016 in options) | OK |
| `--solver-integration-type` | `args.solver_integration_type` str | `run_creep_analysis.py:49` type=str | `json:168-183` choice (default in options) | OK |
| `--cold-preset-value` | `args.cold_preset_value` float | `run_creep_analysis_what_if.py:26` type=float, required | `json:156-161` number | OK |
| `--n-cores` | `args.n_cores` int | `run_creep_analysis.py:51` type=int | `json:184-189` number | OK |
| `--is-upload-bigquery` | `args.is_upload_bigquery` bool | `run_creep_analysis.py:54` store_true | `json:190-195` boolean | OK |
| `--omega-parameter-modification` (nested, only if True) | store_true group | `run_creep_analysis.py:42` store_true | `json:123-155` boolean-group | OK |
| ↳ `--omega-m-max` | `args.omega_m_max` int | `run_creep_analysis.py:43` type=int | `json:131-135` number (default 1000) | OK |
| ↳ `--delta-omega-cd` | `args.delta_omega_cd` float | `run_creep_analysis.py:44` type=float | `json:136-141` number (default 0.3) | OK |
| ↳ `--delta-omega-sr` | `args.delta_omega_sr` float | `run_creep_analysis.py:45` type=float | `json:142-147` number (default -0.5) | OK |
| ↳ `--beta-omega` | `args.beta_omega` float | `run_creep_analysis.py:46` type=float | `json:148-153` number (default 0.33) | OK |

All present in both child parser and dashboard JSON with matching value types. Bool/scalar
by value, omega group nested — matches the `call_gpr_applet` precedent and the
`run_applet(... data=dict)` server contract (`argument_parser.py:242-262`, where `data`
is embedded verbatim into the `RunScriptRequest`).

Omitted-by-design (confirmed intentional -> child defaults):
- `--unit-selection` — child `run_creep_analysis.py:31` store_true default False ->
  `run_creep_analysis_what_if.py:72` selects all 6 units. Dashboard `json:46-90` group.
- `--scenario-selection` — child `run_creep_analysis_what_if.py:28` store_true default
  False -> `:61-64` selects all 3 scenarios. Dashboard `json:18-45` group.
Positive test asserts both keys absent (`test_run_creep_analysis.py:100-101`).

### B. applet_name / script_name match dashboard dir + JSON stem

- `applet_name="smr_outlet_pigtail_whatif"` (`run_creep_analysis.py:126`) ==
  dashboard dir `dashboard/applet_scripts/smr_outlet_pigtail_whatif/`. OK.
- `script_name="run_creep_analysis_what_if"` (`run_creep_analysis.py:127`) == JSON stem
  `run_creep_analysis_what_if.json` (and `json:3` `script_filepath` points at
  `applet_scripts/smr_outlet_pigtail/run_creep_analysis_what_if.py`). OK.
- `script_version` omitted -> defaults to `'latest'` (`argument_parser.py:242`). OK.

### C. Call fires once, only on full success — NOT reachable on partial runs

`trigger_whatif_applet(args)` is called at `run_creep_analysis.py:290`, which is:
- inside `if all_units_present:` (opened at `:253`),
- which is inside `if args.is_run_creep_analysis and len(succeeded_units) > 0:` (`:230`),
- immediately AFTER `ucu.upload_to_cloud(...)` (`:279-287`).

The partial-run branch is the `else:` at `:292-293` ("Not all 6 units have completed ...
Skipping ...") which does NOT call the helper. So the chain cannot fire on a partial /
incomplete run. Fires exactly once per successful complete assessment. CONFIRMED.
Negative test `test_smr_pigtail_outlet_creep_no_whatif_chain_when_incomplete`
(`test_run_creep_analysis.py:186-217`) monkeypatches `check_all_units_data_present ->
False` and asserts `whatif_calls == []` (`:217`) — matches the gate structure.

Submit failure swallowed: `run_creep_analysis.py:124-132` wraps the `run_applet` call in
`try/except Exception: logging.exception(...)`, so a submit failure never fails the parent
assessment. CONFIRMED.

### D. omega-m-max 2000 -> 1000 keeps solver constants unchanged

Omega args are gated on `omega_parameter_modification` in
`info_definitions.py:341-347` (`get_pigtail_material`):
```
additional_params = [
    (int(args.omega_m_max) if args.omega_parameter_modification else OMEGA_M_MAX, "Omega_m_max", OMEGA_M_MAX),
    (float(args.delta_omega_cd) if args.omega_parameter_modification else DELTA_OMEGA_CD, "DeltaOmegaCD", DELTA_OMEGA_CD),
    (float(args.delta_omega_sr) if args.omega_parameter_modification else DELTA_OMEGA_SR, "DeltaOmegaSR", DELTA_OMEGA_SR),
    (float(args.beta_omega) if args.omega_parameter_modification else BETA_OMEGA, "BetaOmega", BETA_OMEGA),
]
pigtail_mat_full += "".join(f"_{name}_{value}" for value, name, default in additional_params if value != default)
```
Constants (`info_definitions.py:16-19`): `OMEGA_M_MAX = 1000`, `DELTA_OMEGA_CD = 0.3`,
`DELTA_OMEGA_SR = -0.5`, `BETA_OMEGA = 0.33`.

- Before the change: the test did NOT pass `--omega-parameter-modification`, so the flag
  was False. The parsed `--omega-m-max 2000` was ignored; `get_pigtail_material` used the
  DEFAULT `OMEGA_M_MAX = 1000`. (The suffix-append only fires when `value != default`, so
  with the flag off nothing was appended and the material name used the default 1000.)
- After the change: the test passes `--omega-parameter-modification` (flag True) with
  `--omega-m-max 1000` + cd 0.3 / sr -0.5 / beta 0.33 — all EQUAL to the defaults. So each
  `value != default` comparison is False and NOTHING is appended to `pigtail_mat_full`;
  the effective solver constant remains `Omega_m_max = 1000` exactly as before.

Net: the solved material name and solver constants are identical before vs after, so the
reference-CSV comparisons are unaffected. The 2000 in the old test was dead (flag off);
switching to flag-on + 1000 exercises the omega forwarding path in `trigger_whatif_applet`
without changing what is solved. CONFIRMED — the rationale in `02_cloud_whatif_chain.md`
is correct.

## Conflicts

None found in the code boundary. The only failing check (ruff format) is a pre-existing
whole-file style state under line-length 320, not introduced by this change and not a
correctness issue. The pytest end-to-end run is blocked by a missing local SCRBE solver
(environment), not by the change.
