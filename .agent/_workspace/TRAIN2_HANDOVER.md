# Handover: Train 2 (2F-5111) integration for smr_outlet_pigtail

Complete, self-contained handover. Follow top to bottom. Do not improvise.
Repo root: `E:\akselos-dev-3.10\akselos-dev-2`.

> REVISION: This version is CONFIG-DRIVEN. There are **NO new applet arguments**.
> Equipment name and the constraint values live in each collection's
> `collection.json` and are read via `args.get_collection_config()`. The new Row
> column is **`Reducer`** (not "Catalyst"). Constraints are the **full 6 DOF**
> (x, y, z, theta_x, theta_y, theta_z).

---

## 0. Golden rules (obey exactly)

- **Do NOT touch `scrbe/`** — proprietary, off-limits.
- **Do NOT change unrelated numeric config values** in existing tests.
- **Neat, human comments only.** Comment *why*, not *what*. No AI-ish phrasing.
- **No git commit / push unless the user explicitly says so.** When committing,
  **no `Co-authored-by` trailer** (user preference).
- Match surrounding style. Copyright header stays. Line length 320. `import akselos as ak`.

---

## 1. Goal

Train 1 (`1F-5111`) collection:
`data/collections/ShellQatar/Pearl_GTL/LPU/SMR_Dashboard_Integration`
Train 2 (`2F-5111`) collection:
`data/collections/ShellQatar/Pearl_GTL/LPU/SMR_Dashboard_Integration_Train_2`

Both real collections derive from the **same shared akselos-testing component
collection**, so Train 1 vs Train 2 CANNOT be distinguished by the model alone —
the difference must come from each collection's `collection.json` config.

For Train 2, the applet must:
1. Auto-detect `cattube_reducer`↔`hanger_system` node-port connections and apply a
   6-DOF constraint (x, y, z, theta_x, theta_y, theta_z) to each (~104/unit).
2. Read equipment name + the 6 constraint values from `collection.json`
   (dashboard config) — NOT from UI arguments.
3. Handle the new `Reducer` column in Train 2's Row.csv (tolerant: Train 1 has none).

---

## 2. Config is the source of truth (read via `get_collection_config`)

`args.get_collection_config()` (`tools/applet_scripts/applet_utils/argument_parser.py:153-178`)
returns `collection.json → dashboard_config.default_values.<applet_name>` merged with
`.<applet_name>.<script_name>`. For this applet the applet_name is
`smr_outlet_pigtail`; put shared keys under `"smr_outlet_pigtail"` so BOTH the live
and what-if scripts inherit them.

Current state of both collections (only `asset_name` today):
```json
"dashboard_config": {
  "applets": ["smr_outlet_pigtail"],
  "default_values": {
    "smr_outlet_pigtail": { "asset_name": "QSGTL_1F-5111-CD-10001.pv" }
  }
}
```

### What you ADD to each `collection.json`

**Train 2** (`SMR_Dashboard_Integration_Train_2/collection.json`) — add
`equipment_name` and a `port_constraints` block (full 6 DOF, as expression strings
WITH units):
```json
"smr_outlet_pigtail": {
  "asset_name": "QSGTL_2F-5111-CD-10001.pv",
  "equipment_name": "2F-5111",
  "port_constraints": {
    "x": "0.0 * m",
    "y": "0.06917715581982975 * m",
    "z": "0.0 * m",
    "theta_x": "0.08377580409572781 * rad",
    "theta_y": "0.0 * rad",
    "theta_z": "0.0 * rad"
  }
}
```
Train 2 `asset_name` is `QSGTL_2F-5111-CD-10001.pv` (equipment 2F-5111) — ALREADY
FIXED in the Train 2 `collection.json` (was wrongly `1F-5111`). Confirm the real
`theta_y`/`theta_z` with the engineer; the four x/y/z/theta_x values above are the
ones given, theta_y/theta_z default to `0.0 * rad` unless told otherwise.

**Train 1** (`SMR_Dashboard_Integration/collection.json`) — add `equipment_name`
only, NO `port_constraints` block:
```json
"smr_outlet_pigtail": {
  "asset_name": "QSGTL_1F-5111-CD-10001.pv",
  "equipment_name": "1F-5111",
  "project_id": "akselos-test.qsgtl_brazed_hex"
}
```

**Gating rule:** apply the cattube constraints when the config contains a
`port_constraints` block (Train 2 has it, Train 1 does not). This is self-describing
and needs no equipment-string comparison. `equipment_name` is stored for
identity/labelling (notification etc.) and future use.

---

## 3. Harness team + skill + SDK tools

Use the existing team on disk. Orchestrator skill:
`.agent/skills/smr_orchestrator/SKILL.md` (pointer in `AGENTS.md` under
`## Harness: smr_outlet_pigtail`). Agents in `.agent/agents/`, all `model: opus`:
`smr-explorer` (Explore), `smr-applet` (general-purpose), `smr-cloud`
(general-purpose), `smr-qa` (general-purpose).

Flow: smr-explorer verifies Section 6 runtime facts → smr-applet does 4.1/4.2/4.4 →
smr-cloud does 4.3 (config read + threading; NO parser/JSON arg changes) → smr-qa
does Section 5/7.

### SDK APIs (verified locations)
- `model_state.auto_connect_close_ports_command(connection_tolerance=...)` — already
  called in `PreProcessing.set_up_model_configs` (`pre_processing.py:50`); creates the
  connections. You do NOT call it again.
- `model_state.set_port_constraint_group_command([port_constraint], "x_y_z_theta_constraint")`
  (`tools/akselos/model/model_commands/component_system_model_commands.py:48`).
- `model_state.set_port_constraint_command(port_constraint, name, value)` (same file:95).
- Iterate: `component_system.id_to_port_constraint.get_values(context)`.
- Constraint → components: `port_constraint.get_port_ids(context)` → `port_id.component_id`
  → `component_system.get_component(context, id).get_component_type_name(context)`.
- Group `"x_y_z_theta_constraint"` (fields x/y/z/theta_x/theta_y/theta_z) is in
  `ak.NAME_TO_PORT_CONSTRAINT_GROUP` (`port_constraint_group.py:178`).
- Copy the iteration pattern from `PreProcessing.set_up_cold_preset` (`pre_processing.py:54-67`).
- Config: `args.get_collection_config()` (argument_parser.py:153).

---

## 4. Exact implementation (config-driven, NO new args)

### 4.1 `pre_processing.py` — new method + go() hook
```python
def set_up_port_constraints(self, constraint_values: dict[str, str]) -> None:
    """Apply the 6-DOF constraint to each cattube_reducer<->hanger_system connection.

    Connections are created at runtime by auto_connect_close_ports_command in
    set_up_model_configs; here we assign the x_y_z_theta_constraint group and set the
    values (sourced from collection.json). Train 2 only (constraint_values is None on Train 1).
    """
    context = self.context
    component_system = self.model_state.component_system
    count = 0
    for port_constraint in component_system.id_to_port_constraint.get_values(context):
        component_type_names = [
            component_system.get_component(context, port_id.component_id).get_component_type_name(context)
            for port_id in port_constraint.get_port_ids(context)
        ]
        has_cattube = any("cattube_reducer" in name for name in component_type_names)
        has_hanger = any("hanger_system" in name for name in component_type_names)
        if has_cattube and has_hanger:
            self.model_state.set_port_constraint_group_command([port_constraint], "x_y_z_theta_constraint")
            for field, expression in constraint_values.items():
                self.model_state.set_port_constraint_command(port_constraint, field, expression)
            count += 1
    logging.info("> Set up %d cattube_reducer<->hanger_system port constraints", count)
```
Append ONE param to `PreProcessing.go` (last, defaulted):
`constraint_values: dict[str, str] | None = None`
and call right AFTER `self.set_up_cold_preset(...)`:
```python
if constraint_values:
    self.set_up_port_constraints(constraint_values)
```

### 4.2 `info_definitions.py`
Only if you want a tiny reader helper (optional — a plain `.get` in go() is fine):
```python
def get_port_constraints_config(collection_config: dict) -> dict[str, str] | None:
    """Return the 6-DOF port-constraint expressions from collection config, or None.

    Train 2 collections define dashboard_config.default_values.smr_outlet_pigtail.port_constraints;
    Train 1 omits it, so the caller skips the cattube constraint step.
    """
    return collection_config.get("port_constraints")
```
Do NOT add the old arg-based `get_port_constraint_values` helper or the module
constants — values now come from `collection.json`.

### 4.3 `run_creep_analysis.py` and `run_creep_analysis_what_if.py` — threading
NO parser changes. In each `go()`, read the config once and pass it through:
```python
collection_config = args.get_collection_config()
constraint_values = collection_config.get("port_constraints")
```
Then append `constraint_values=constraint_values` to the `pre.PreProcessing(...).go(...)`
call(s). (In the what-if script, compute it once before the scenario loop.)
NOTE: `get_collection_config()` raises if `dashboard_config.default_values` is
missing — both real collections already have it, but if you touch a collection that
does not, wrap defensively or ensure the config exists.

### 4.4 Row.csv `Reducer` column (tolerant)
Train 2 Row.csv header is `No,Bend,Hanger,Weld,Reducer` (Train 1: `No,Bend,Hanger,Weld`).
- `row_tube_utils.py`: `COLUMN_NAMES = ['Weld', 'Bend', 'Hanger', 'Reducer']`. In
  `create_row_tube_data`, skip any column absent from the CSV (`if col_name not in data: continue`).
- `post_processing_utils.py` `_create_length_damage_csv` (~line 943): replace the
  hard-coded `['Weld', "Bend", "Hanger"]` with `[key for key in rtu.COLUMN_NAMES if key in headers]`
  and iterate that (preserves order; Train 1 without Reducer still works). Add
  `import applet_scripts.smr_outlet_pigtail.row_tube_utils as rtu` in correct
  ALPHABETICAL position (it sorts BEFORE the `smr_*` sibling imports — misplacing it
  causes a ruff I001 failure).
- Do NOT edit Row.csv data files. Do NOT invent node-ids. The engineer owns the
  Reducer node-ids and the correct segment order.

### 4.5 What to REMOVE (if starting from the old stashed version)
The earlier draft (in `stash@{0}` on master) added UI arguments and an arg-based
helper. In THIS config-driven version those must NOT exist:
- No `--equipment-name`, `--port-constraint-configurations`, `--theta-x/--x/--y/--z`
  in `run_creep_analysis.py` `get_root_parser`.
- No equipment/port-constraint entries in either dashboard JSON.
- No `get_port_constraint_values(args)` / `PORT_CONSTRAINT_*` module constants /
  `is_train_2` arg-based gate.
Use `git stash show -p stash@{0}` only as a reference for the constraint-setting
mechanism and the Row-column mechanics; discard the argument-related parts.

---

## 5. Tests

No Train 2 test fixture exists — the shared test collection
`akselos-testing/smr/test_smr_outlet_pigtail` is Train 1 (no cattube). So:
1. `test_pre_processing.py` — mock-based unit test of `set_up_port_constraints`:
   build `PreProcessing.__new__(PreProcessing)`, set `.context` and a `mock.Mock()`
   `model_state` whose `component_system.id_to_port_constraint.get_values` returns
   stub port constraints and `get_component(...).get_component_type_name(...)` returns
   names by id. Assert a cattube↔hanger connection gets
   `set_port_constraint_group_command([pc], "x_y_z_theta_constraint")` + one
   `set_port_constraint_command` per supplied field; non-matching connections get
   nothing; and `go(..., constraint_values=None)` never calls it.
2. `test_row_tube_utils.py` — `create_row_tube_data` with a CSV that HAS `Reducer`
   and one WITHOUT it; assert no KeyError and correct dicts (use `tmp_path`).
3. (Optional) a small test that `get_port_constraints_config` returns the dict when
   present and `None` when absent.

There is a shared-collection limitation: to exercise Train 2 end-to-end in CI you
would need a Train 2 test collection (or add a `port_constraints` block to a test
collection's `collection.json`). Flag this to the user; do not force it.

---

## 6. Verify at build time (do not assume)

1. **Type-name match:** confirm `get_component_type_name` returns a name containing
   `cattube_reducer` for the Train 2 reducer component (it returns `ref_component_type`;
   `hanger_system` is confirmed). Adjust the accessor if the substring is only on the
   instance/ref name.
2. **auto_connect actually creates the ~104/unit connections** after docking
   (tolerance + compatible port type). Train 2 template
   `aks_files/run_creep_assessment.aks` has 104 `cattube_reducer` + 104
   `hanger_system` components but only 6 predefined `port_constraint_id`; the rest
   are expected to be auto-created. If not, they must be built at collection-build
   time (`tools/smr/preprocessing/`) — a separate task, out of applet scope.
3. **Group name** `"x_y_z_theta_constraint"` valid in `ak.NAME_TO_PORT_CONSTRAINT_GROUP`.
4. **Config keys** actually present in the real Train 2 `collection.json` after you
   add them; `get_collection_config` reads `dashboard_config.default_values.smr_outlet_pigtail`.
5. **Reducer node-ids + segment order** in Row.csv are the engineer's; wire tolerantly only.

---

## 7. Verification commands

```bash
cd /e/akselos-dev-3.10/akselos-dev-2
python -m ruff check tools/applet_scripts/smr_outlet_pigtail/ tests/src/tools/applet_scripts/smr_outlet_pigtail/
python -m ty check tools/applet_scripts/smr_outlet_pigtail/pre_processing.py tools/applet_scripts/smr_outlet_pigtail/info_definitions.py tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py
python -m json.tool data/collections/ShellQatar/Pearl_GTL/LPU/SMR_Dashboard_Integration_Train_2/collection.json > /dev/null && echo T2_JSON_OK
python -m json.tool data/collections/ShellQatar/Pearl_GTL/LPU/SMR_Dashboard_Integration/collection.json > /dev/null && echo T1_JSON_OK
python -m pytest tests/src/tools/applet_scripts/smr_outlet_pigtail/test_pre_processing.py tests/src/tools/applet_scripts/smr_outlet_pigtail/test_row_tube_utils.py -k "port_constraint or set_up_port or row_tube or reducer or Reducer" -q
```
`ruff`/`ty` may not be on PATH — use `python -m ruff` / `python -m ty`. Full workflow
tests need the SCRBE solver at `127.0.0.1:8000` (CI only); do not fake them.

Staging (only way to prove the count): run the live applet on the Train 2 collection
and confirm the log "Set up 104 cattube_reducer<->hanger_system port constraints" per
unit and the saved AKS carries the 6-DOF values. Run on Train 1 and confirm count 0 /
no change.

---

## 8. Definition of done
- `collection.json` updated for both trains (Section 2). Both parse.
- `pre_processing.py` + `run_creep_analysis*.py` read config and apply constraints
  (Section 4.1/4.3). NO new applet args, NO dashboard-JSON arg changes.
- `row_tube_utils.py` + `post_processing_utils.py` handle the `Reducer` column
  tolerantly (Section 4.4).
- Section 5 tests added and green (solver-free). Section 7 checks green.
- Section 6 items verified or flagged.
- No commit/push unless the user asks; neat message, no co-author trailer.
