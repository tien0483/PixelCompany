# 02 — Cloud: chain What-If applet after successful live creep run

## What changed

### `tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py`
- New module helper `trigger_whatif_applet(args)` placed immediately before `def go(args):`.
- Call added at the full-success gate: inside `if all_units_present:`, on the line right
  after the `ucu.upload_to_cloud(...)` call. Fires exactly once, only when all 6 units
  completed and the live snapshot uploaded.

### `tests/src/tools/applet_scripts/smr_outlet_pigtail/test_run_creep_analysis.py`
- `test_smr_pigtail_outlet_creep`: added `--omega-parameter-modification` to the args
  (required so the omega group forwards) AND changed `--omega-m-max` from 2000 to 1000.
  Rationale: `info_definitions.py:342-345` only applies the omega args when
  `omega_parameter_modification` is True; the original test parsed omega-m-max=2000 but
  ran with the DEFAULT constant (1000) because the flag was off. Enabling the flag with
  2000 would change Omega_m_max in the solve and break the reference-CSV comparison. Using
  1000 (= default) plus the already-default cd/sr/beta keeps the solver constants identical
  to before, so reference outputs are unchanged while the omega group still forwards.
  Monkeypatched `applet_args.run_applet` with a capturing lambda; added payload assertions.
- New `test_smr_pigtail_outlet_creep_no_whatif_chain_when_incomplete`: same collection
  setup, `check_all_units_data_present -> False`, asserts `run_applet` is NOT called.

## Target applet / script (verified)
- `applet_name="smr_outlet_pigtail_whatif"` — equals dashboard dir
  `dashboard/applet_scripts/smr_outlet_pigtail_whatif/`.
- `script_name="run_creep_analysis_what_if"` — JSON stem
  `run_creep_analysis_what_if.json`.
- `script_version` omitted -> defaults to `'latest'` (per `run_applet` signature).

## Exact forwarded payload (`data` dict)
Always present (scalars/bool by value, per gpr precedent):
```
"--creep-model":             args.creep_model             (str,  e.g. "Omega_API")
"--api-version":             args.api_version             (str,  e.g. "2016")
"--solver-integration-type": args.solver_integration_type (str,  e.g. "default")
"--cold-preset-value":       args.cold_preset_value       (float, e.g. -0.04)
"--n-cores":                 args.n_cores                 (int,  e.g. 8)
"--is-upload-bigquery":      args.is_upload_bigquery       (bool)
```
Nested group, only when `args.omega_parameter_modification` is True:
```
"--omega-parameter-modification": {
    "--omega-m-max":    args.omega_m_max     (int; test uses 1000)
    "--delta-omega-cd": args.delta_omega_cd  (float)
    "--delta-omega-sr": args.delta_omega_sr  (float)
    "--beta-omega":     args.beta_omega      (float)
}
```
`--unit-selection` and `--scenario-selection` are intentionally OMITTED -> child defaults
False -> all 6 units, all 3 scenarios (DOW/IOW/Operating).

## Gate location (file:line)
`tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py`, inside `if all_units_present:`
block, on the line immediately after `ucu.upload_to_cloud(...)` (the block that ends at the
former line 253). Under `if args.is_run_creep_analysis and len(succeeded_units) > 0` +
`all_units_present`.

## Interface verification (all confirmed)
- Child JSON flags exist and types match: creep-model/api-version/solver-integration-type
  (choice/str), cold-preset-value/n-cores (number), is-upload-bigquery (boolean),
  omega group (boolean-group of numbers). See
  `dashboard/applet_scripts/smr_outlet_pigtail_whatif/run_creep_analysis_what_if.json`.
- Parent `args` dest names verified against `run_creep_analysis.get_root_parser`:
  creep_model, api_version, solver_integration_type (str), cold_preset_value (float),
  n_cores (int), is_upload_bigquery / omega_parameter_modification (store_true),
  omega_m_max (int), delta_omega_cd / delta_omega_sr / beta_omega (float).
- `run_applet(applet_name, script_name, script_version='latest', use_parent_job_id=True,
  cpus_per_task=1, data=None)` in
  `tools/applet_scripts/applet_utils/argument_parser.py`.
- Encoding follows `call_gpr_applet` in `tools/coker/coker_submit_solver.py` (bools by
  value, groups nested).

## Boundaries smr-qa must cross-check
1. Positive test asserts run_applet called once with the exact applet/script names and the
   full payload above (including nested omega group, and omission of unit/scenario keys).
2. Negative test asserts NO run_applet call when `all_units_present` is False.
3. The chain call sits strictly INSIDE `if all_units_present:` and AFTER `upload_to_cloud`
   — confirm it cannot fire on partial/failed runs.
4. Submit failure is swallowed (try/except logging.exception) — never fails the parent.
5. Existing positive test now passes `--omega-parameter-modification` with omega-m-max=1000
   (= default) so solver constants are unchanged; confirm the reference-CSV comparisons and
   the bigquery_to_send/screenshot assertions still pass unchanged. If any ref diff appears,
   the omega-m-max value is the suspect.

---

## Restart-data gate (this-run saved-solution readiness)

### Why
What-If does NOT read the live creep CSV output — it reads back the **saved solution**
(restart_data) that the live creep solve writes (`pre_processing.py:178-182`,
`write_saved_solution=True`). So the chain must wait until this run's restart_data folders
are actually on disk. We keep What-If's own auto-discovery of the latest restart, but gate
the *chain* on this-run restart_data being present.

### Gate helper (added)
`tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py` — new module function
`this_run_restart_data_ready(workspace, succeeded_units, sensor_date_str, short_job_id) -> bool`,
placed immediately after `trigger_whatif_applet` and before `def go(args):`.

```python
def this_run_restart_data_ready(workspace, succeeded_units, sensor_date_str, short_job_id) -> bool:
    for unit in succeeded_units:
        folder = workspace.restart_data_dir.joinpath(
            workspace.get_creep_restart_data_folder(unit, sensor_date_str, short_job_id))
        if not folder.is_dir() or not any(folder.iterdir()):
            logging.info("Saved solution missing for Unit %d at %s; skipping What-If chain.", unit, folder)
            return False
    return True
```

Returns True only if, for every unit in `succeeded_units`, the restart folder exists AND is
non-empty. Empty/missing -> returns False (chain skipped), logs which unit/path failed.

### Exact folder path checked (verified against workspace.py)
- `workspace.restart_data_dir` = `collection_dir/restart_data` (a `Path`; workspace.py:11,47).
- `get_creep_restart_data_folder(unit, sensor_date_str, short_job_id)` is a `@staticmethod`
  returning the string `"Unit_{unit}_{sensor_date_str}_{short_job_id}"` (workspace.py:164-170).
- Absolute folder checked = `collection/restart_data/Unit_{u}_{sensor_date}_{short_job_id}`.

### Call site (file:line)
`tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py`, inside the
`if all_units_present:` block, immediately after `ucu.upload_to_cloud(...)`. The former
unconditional `trigger_whatif_applet(args)` is now guarded:

```python
# What-If reads the saved solution this run wrote, not the creep CSV output, so
# only chain once every solved unit's restart_data folder is present.
if this_run_restart_data_ready(workspace, succeeded_units, configs.sensor_date_str, short_job_id):
    trigger_whatif_applet(args)
```

In-scope vars in `go()`: `workspace`, `succeeded_units`, `configs`, `short_job_id`. Approx
line 300 (inside the same `if args.is_run_creep_analysis and len(succeeded_units) > 0` +
`all_units_present` block).

### Tests (added/updated)
- `test_smr_pigtail_outlet_creep` (positive): added
  `monkeypatch.setattr(rc, "this_run_restart_data_ready", lambda *a, **k: True)` before
  `rc.go(...)`, so payload assertions don't depend on the solver having written restart_data.
  No omega args or numbers changed; all existing assertions kept.
- `test_smr_pigtail_outlet_creep_no_whatif_chain_when_incomplete` (negative): unchanged;
  chain never reached because `check_all_units_data_present -> False`.
- NEW `test_smr_pigtail_outlet_creep_no_whatif_chain_when_restart_missing`: structurally
  identical to the positive test's arg list; monkeypatches `check_all_units_data_present ->
  True` (so the upload/gate block runs) AND `rc.this_run_restart_data_ready -> False`;
  captures `run_applet`; asserts `whatif_calls == []`.

### What smr-qa must assert
1. Positive test still chains exactly once (gate monkeypatched True) — payload assertions
   independent of on-disk restart_data.
2. NEW restart-missing test: `run_applet` NOT called when gate is False even though
   `all_units_present` is True. Key assertion: empty capture list.
3. The gate reference is `rc.this_run_restart_data_ready` (module-level; monkeypatch on the
   module alias `rc`, not on an imported name).
4. Folder path checked is `restart_data/Unit_{u}_{date}_{jobid}`; producer/consumer string
   is the single-source-of-truth `get_creep_restart_data_folder`.
5. Solver-gated tests (positive + restart-missing) behave the same in CI as the other
   solver-dependent tests; the load-bearing assertion in the new test is the empty list.
