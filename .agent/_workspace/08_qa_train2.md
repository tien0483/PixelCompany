# 08 — smr-qa: Train 2 (2F-5111) verification

Owner: smr-qa. Scope: lint/type/JSON/compile of the Train 2 landing, solver-free
tests for the two new helpers + parser boundary, and a source-read cross-check of
every forwarded arg / gate. No git, no source edits.

## Summary: FAIL (one blocking lint error in source)

- ruff: **FAIL** — one `I001` import-ordering error in `post_processing_utils.py`.
- ty: PASS (no errors on the three files; only pre-existing `unknown-rule` config warnings).
- JSON: PASS (both live + whatif parse).
- py_compile: PASS (all 6 changed .py files).
- New tests: PASS (13 solver-free cases, all green).
- Boundary cross-check: all confirmed against source.

The only failure is a mechanical import-sort in a source file. Exact fix below; it
is in source so smr-qa did **not** apply it (constraint: no source edits).

---

## 1. ruff — FAIL

Command:
```
python -m ruff check tools/applet_scripts/smr_outlet_pigtail/ tests/src/tools/applet_scripts/smr_outlet_pigtail/
```
Output (verbatim, trimmed to the finding):
```
I001 [*] Import block is un-sorted or un-formatted
  --> tools\applet_scripts\smr_outlet_pigtail\post_processing_utils.py:2:1
...
22 | | import applet_scripts.smr_outlet_pigtail.smr_table_utils as stu
23 | | import applet_scripts.smr_outlet_pigtail.row_tube_utils as rtu
24 | | import applet_scripts.smr_outlet_pigtail.smr_tables as smr_tables
...
help: Organize imports
Found 1 error.
[*] 1 fixable with the `--fix` option.
```

**Cause:** the new import `import applet_scripts.smr_outlet_pigtail.row_tube_utils as rtu`
was inserted at `post_processing_utils.py:23`, i.e. *after* `...smr_screenshot_utils`
and `...smr_table_utils`. Alphabetically `row_tube_utils` sorts before every `smr_*`
sibling, so ruff wants it moved up. (Report 06 claimed it was "placed before `smr_*`
siblings"; it is not.)

**Exact fix (source — NOT applied here):** move line 23 up so the
`applet_scripts.smr_outlet_pigtail.*` block reads
`...creep_calculation_utils`, `...cross_section_database`, `...row_tube_utils`,
`...smr_pigtail_dilation`, `...smr_screenshot_utils`, `...smr_table_utils`,
`...smr_tables`. Equivalent to `ruff check --fix post_processing_utils.py`.

My two extended test files are clean on their own:
```
python -m ruff check test_info_definitions.py test_row_tube_utils.py test_run_creep_analysis.py
-> All checks passed!
```
So the single `I001` is entirely in source, not in the tests I added.

## 2. ty — PASS

Command:
```
python -m ty check tools/applet_scripts/smr_outlet_pigtail/pre_processing.py \
  tools/applet_scripts/smr_outlet_pigtail/info_definitions.py \
  tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py
```
Result: `Found 49 diagnostics`, exit 0. Filtering for `error[` or any of the three
target filenames returns nothing — all 49 diagnostics are pre-existing
`warning[unknown-rule]` entries from `ty.toml` (e.g. `useless-overload-body`,
`unsupported-dynamic-base`), unrelated to this change. No error on our files.

## 3. JSON — PASS

```
python -m json.tool dashboard/applet_scripts/smr_outlet_pigtail/run_creep_analysis.json > /dev/null && echo LIVE_JSON_OK
-> LIVE_JSON_OK
python -m json.tool dashboard/applet_scripts/smr_outlet_pigtail_whatif/run_creep_analysis_what_if.json > /dev/null && echo WHATIF_JSON_OK
-> WHATIF_JSON_OK
```

## 4. py_compile — PASS

```
python -m py_compile info_definitions.py pre_processing.py run_creep_analysis.py run_creep_analysis_what_if.py
-> PY_COMPILE_OK (exit 0)
python -m py_compile row_tube_utils.py post_processing_utils.py
-> EXTRA_PY_COMPILE_OK
```
(All 6 touched .py files byte-compile.)

---

## New / extended tests (solver-free) — PASS

Run:
```
python -m pytest tests/src/tools/applet_scripts/smr_outlet_pigtail/ \
  -k "port_constraint_values or row_tube or create_row_tube or root_parser or is_train_2" -q
-> 13 passed, 87 deselected, 3 warnings
```

### `test_info_definitions.py` (+4 cases) — `get_port_constraint_values`
- `test_port_constraint_values_defaults_when_group_off` — group off returns the
  four Train 2 defaults even when field values are set.
- `test_port_constraint_values_override_when_group_on` — theta_x=1.5 -> "1.5 * rad",
  x=0.5 -> "0.5 * m", y=2.0 -> "2.0 * m", z=0.25 -> "0.25 * m".
- `test_port_constraint_values_unset_fields_keep_defaults` — group on, only theta_x
  and y set; x/z (None) keep defaults.
- `test_port_constraint_values_missing_attr_falls_back_to_defaults` — empty
  Namespace (no `port_constraint_configurations`) returns defaults via getattr, no crash.

### `test_row_tube_utils.py` (+2 cases) — Catalyst tolerance
- `test_create_row_tube_data_reads_catalyst_when_present` — Train 2 CSV
  (No,Weld,Bend,Hanger,Catalyst) reads all four IDs in COLUMN_NAMES order.
- `test_create_row_tube_data_tolerates_missing_catalyst` — Train 1 CSV
  (No,Weld,Bend,Hanger) does not KeyError on the absent Catalyst column.
  (Existing `test_create_row_tube_data` already covers the Row1/Row2 join.)

### `test_run_creep_analysis.py` (+4 cases) — parser boundary
Written via argparse-action introspection (`parser._actions`) rather than
`.parse_args(...)`, because the applet-test autouse fixture in
`tests/src/tools/applet_scripts/conftest.py:113-190` intercepts `parse_args`,
asserts a valid `--collection` prefix (conftest.py:127-129) and mkdir's an output
dir — machinery irrelevant to a pure flag-shape check. Introspection keeps the
test solver-free and fixture-free.
- `test_root_parser_equipment_and_port_constraint_flags` — dest mapping:
  `--equipment-name`->`equipment_name`, `--theta-x`->`theta_x`, `--x/--y/--z`->`x/y/z`.
- `test_root_parser_port_constraint_defaults_and_types` — `--port-constraint-configurations`
  store_true default False; the four numbers are `type=float`, default None, not required.
- `test_root_parser_equipment_name_required` — `--equipment-name` action `.required is True`.
- `test_is_train_2_truth_table` — mirrors the go() gate: True iff "2F-5111", else False.

---

## Boundary / logic cross-check (source-read, file:line)

1. **Helper attr names line up with the parser.**
   `get_port_constraint_values` reads `args.port_constraint_configurations`
   (info_definitions.py:357) and `args.theta_x/x/y/z` (info_definitions.py:358-365).
   Parser defines `--port-constraint-configurations` store_true
   (run_creep_analysis.py:32) and `--theta-x/--x/--y/--z` type=float
   (run_creep_analysis.py:33-36). argparse dest = flag with hyphens->underscores,
   so attrs are exactly `port_constraint_configurations`, `theta_x`, `x`, `y`, `z`.
   **MATCH** (also asserted by the introspection tests above).

2. **`PreProcessing.go` new params are trailing kwargs; both call sites pass by keyword.**
   Signature ends `..., is_train_2: bool = False, constraint_values: dict[str, str] | None = None`
   (pre_processing.py:242-243). Live call site passes `is_train_2=is_train_2,
   constraint_values=port_constraint_values` as the last two kwargs
   (run_creep_analysis.py:156-157). Whatif call site same, last two kwargs
   (run_creep_analysis_what_if.py:124). `is_train_2`/`port_constraint_values`
   computed once before the unit/scenario loop (run_creep_analysis.py:126-127;
   run_creep_analysis_what_if.py:77-78), `sid` imported at
   run_creep_analysis_what_if.py:12. **CONFIRMED.**

3. **`set_up_port_constraints` matches cattube_reducer<->hanger_system, assigns a real group, gated to Train 2.**
   Matches connections whose component-type names include BOTH `cattube_reducer`
   and `hanger_system` (pre_processing.py:84-86), assigns group
   `"x_y_z_theta_constraint"` (pre_processing.py:87) and sets all four fields
   (pre_processing.py:88-89). `"x_y_z_theta_constraint"` is a real group with fields
   `['x','y','z','theta_x','theta_y','theta_z']`
   (port_constraint_group.py:178-181) folded into `NAME_TO_PORT_CONSTRAINT_GROUP`
   (port_constraint_group.py:212) — so x/y/z/theta_x are all valid members. Called
   only under `if is_train_2 and constraint_values:` (pre_processing.py:246-247),
   right after `set_up_cold_preset`; Train 1 (or empty values) skips it. **CONFIRMED.**

4. **`_create_length_damage_csv` iterates COLUMN_NAMES ∩ headers; Train 1 stays safe.**
   `headers = data_csv[0]` (post_processing_utils.py:929);
   `segment_keys = [key for key in rtu.COLUMN_NAMES if key in headers]`
   (post_processing_utils.py:946); loop `for idx, key in enumerate(segment_keys)`
   (post_processing_utils.py:947). Each row is zipped to headers with strict=True
   (post_processing_utils.py:943), so only keys present in the file are dereferenced —
   a Train 1 Row.csv (No,Bend,Hanger,Weld, no Catalyst) yields
   `segment_keys=['Weld','Bend','Hanger']` and cannot KeyError on Catalyst. The
   geometry-stitching continuity branch still keys off enumerate order via
   `if idx > 0:` (post_processing_utils.py:971-975), unchanged. `rtu` imported at
   post_processing_utils.py:23. **CONFIRMED** (note: this is the same import line
   flagged by ruff I001 — correct behavior, wrong sort position).

5. **Both JSONs: `--equipment-name` choice + `--port-constraint-configurations` group.**
   Live (dashboard/applet_scripts/smr_outlet_pigtail/run_creep_analysis.json:91-137)
   and whatif (dashboard/applet_scripts/smr_outlet_pigtail_whatif/run_creep_analysis_what_if.json:91-137)
   are identical:
   - choice `--equipment-name`, options `1F-5111`/`2F-5111`, display `... (Train 1/2)`,
     `default_value: "2F-5111"` (lines 92-103).
   - boolean-group `--port-constraint-configurations`, `default_value: false`
     (lines 105-109), with 4 number children: `--theta-x` 0.08377580409572781,
     `--x` 0.0, `--y` 0.06917715581982975, `--z` 0.0 (lines 111-136).
   Defaults match the info_definitions constants
   (info_definitions.py:339-342). **CONFIRMED.**

---

## Gaps needing manual / staging verification

- **End-to-end `set_up_port_constraints`.** The local test collection
  (`akselos-testing/smr/test_smr_outlet_pigtail`) is Train 1 and has no
  `cattube_reducer` component type, so the actual connection-matching, group
  assignment, and per-field `set_port_constraint_command` calls (and the reported
  "104/unit" count) cannot be exercised here. The command signatures and group key
  are confirmed by source read, but the runtime path is **not covered by any test**.
  Requires a Train 2 template with cattube_reducer<->hanger_system connections —
  mark for manual/staging verification.
- **Train 2 Row.csv in `_create_length_damage_csv`.** Unit-level tolerance is proven
  (`test_row_tube_utils`), but the full post-processing path with a real Train 2
  Row.csv (Catalyst present) reading the extra `nodalAverage_year_component_*.exo`
  segment needs staging data — mark for manual verification.

## Action required before sign-off
Fix the single `I001` in `tools/applet_scripts/smr_outlet_pigtail/post_processing_utils.py`
(move the `row_tube_utils as rtu` import above the `smr_*` siblings, or run
`ruff check --fix`). Owner: smr-applet (source owner). Re-run ruff to green, then
smr-qa signs off. All other checks pass.
