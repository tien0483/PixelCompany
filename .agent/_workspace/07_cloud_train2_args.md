# 07 — smr-cloud: Train 2 (2F-5111) args + JSON

Owner: smr-cloud. Scope: parser args, arg threading into `PreProcessing.go`, dashboard JSONs.

## Files changed
- `tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py`
- `tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis_what_if.py`
- `dashboard/applet_scripts/smr_outlet_pigtail/run_creep_analysis.json`
- `dashboard/applet_scripts/smr_outlet_pigtail_whatif/run_creep_analysis_what_if.json`

## A. Parser (run_creep_analysis.py `get_root_parser`)
New "Equipment / train selection" group added at the top of `get_root_parser` (root parser
is inherited by both live and whatif, so both get the flags):
- `--equipment-name` (str, required)
- `--port-constraint-configurations` (store_true, default False)
- `--theta-x`, `--x`, `--y`, `--z` (float, optional)

argparse hyphen->underscore mapping (for the shared helper the other agent reads):
- `--equipment-name` -> `args.equipment_name`
- `--port-constraint-configurations` -> `args.port_constraint_configurations`
- `--theta-x` -> `args.theta_x`; `--x`/`--y`/`--z` -> `args.x`/`args.y`/`args.z`

## B. run_creep_analysis.py `go()`
Near `pigtail_mat_full = sid.get_pigtail_material(args)`:
```python
is_train_2 = args.equipment_name == "2F-5111"
port_constraint_values = sid.get_port_constraint_values(args)
```
Appended to the `pre.PreProcessing(workspace=workspace, configs=configs).go(...)` call as the
last two keyword args:
`is_train_2=is_train_2, constraint_values=port_constraint_values`

## C. run_creep_analysis_what_if.py `go()`
Computed once before the scenario loop (near `pigtail_mat_full = sid.get_pigtail_material(args)`):
```python
is_train_2 = args.equipment_name == "2F-5111"
port_constraint_values = sid.get_port_constraint_values(args)
```
Appended to the `pre.PreProcessing(workspace=scenario_workspace, configs=configs).go(...)` call
(last two kwargs): `is_train_2=is_train_2, constraint_values=port_constraint_values`.
`sid` = `applet_scripts.smr_outlet_pigtail.info_definitions` (already imported).

## D. Dashboard JSON (both files)
Inserted after the unit-selection group, before the `--creep-model` choice, mirroring the
existing `choice` (`--creep-model`) and boolean-group (`--omega-parameter-modification`) style:
- `choice` `--equipment-name`, options `1F-5111`/`2F-5111`, display `... (Train 1/2)`, default `2F-5111`.
- `boolean-group` `--port-constraint-configurations` (default false) with 4 nested `number` args:
  `--theta-x` 0.08377580409572781, `--x` 0.0, `--y` 0.06917715581982975, `--z` 0.0.

## Verification done
- Both JSONs parse: `python -m json.tool <file>` -> live OK / whatif OK.
- Both Python files byte-compile: `python -m py_compile ...` OK.
- Kwargs appended are the last args at each `PreProcessing.go` call site and keyword-based:
  - live: run_creep_analysis.py `go()` PreProcessing.go call (ends with `constraint_values=port_constraint_values`).
  - whatif: run_creep_analysis_what_if.py `go()` PreProcessing.go call (ends with `constraint_values=port_constraint_values`).

## Contract relied on (owned by the other agent — NOT implemented here)
- `sid.get_port_constraint_values(args) -> dict[str, str]` in info_definitions.py.
- `PreProcessing.go(...)` accepts trailing kwargs `is_train_2: bool = False, constraint_values: dict[str,str] | None = None`.

## What smr-qa must assert
1. Both root parsers accept `--equipment-name`, `--port-constraint-configurations`,
   `--theta-x/--x/--y/--z`; hyphen->underscore attr mapping (`args.theta_x` etc.).
2. `--equipment-name` is required (parse fails without it) in both live and whatif.
3. `is_train_2` is True iff `args.equipment_name == "2F-5111"`, else False (e.g. `1F-5111`).
4. `PreProcessing.go` is called with `is_train_2=` and `constraint_values=` in both applets
   (kwargs, last position) — mock and assert.
5. Both dashboard JSONs are valid JSON and contain the `--equipment-name` choice
   (default `2F-5111`) and `--port-constraint-configurations` boolean-group with the 4 number
   sub-args and the exact default values above.
