# smr-applet — Train 2 (2F-5111) applet-side changes

Agent: smr-applet. Scope: only the four applet files listed below. No git, no tests run.

## Files changed
1. `tools/applet_scripts/smr_outlet_pigtail/info_definitions.py`
2. `tools/applet_scripts/smr_outlet_pigtail/pre_processing.py`
3. `tools/applet_scripts/smr_outlet_pigtail/row_tube_utils.py`
4. `tools/applet_scripts/smr_outlet_pigtail/post_processing_utils.py`

## A. info_definitions.py
Added the four exact default constants and `get_port_constraint_values(args) -> dict[str, str]`
immediately before `get_pigtail_material` (constants at info_definitions.py:339-342, helper at
info_definitions.py:345-368). Defaults are the Train 2 design values; the
`port_constraint_configurations` boolean-group overrides any field the user set, mirroring the
omega pattern in `get_pigtail_material`. Uses `getattr(args, "port_constraint_configurations", False)`
so callers without the arg do not break. Contract name matches the shared spec exactly.

## B. pre_processing.py
New method `set_up_port_constraints(self, constraint_values)` at pre_processing.py:69-91, modelled on
`set_up_cold_preset`. For each `id_to_port_constraint` value whose two connected components' type
names include both `cattube_reducer` and `hanger_system`, it assigns the group and sets the four
fields:
```python
def set_up_port_constraints(self, constraint_values: dict[str, str]) -> None:
    """Set the X-Y-Z-Theta constraint on each cattube_reducer<->hanger_system connection.

    The connections are created at runtime by auto_connect_close_ports_command in
    set_up_model_configs; here we assign the x_y_z_theta_constraint group and its
    values to every detected connection. Train 2 only.
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
`PreProcessing.go` signature extended with the two trailing kwargs
`is_train_2: bool = False, constraint_values: dict[str, str] | None = None` (pre_processing.py:232-233),
and the guarded call added right after `set_up_cold_preset` (pre_processing.py:243-244):
```python
if is_train_2 and constraint_values:
    self.set_up_port_constraints(constraint_values)
```

## C. Row.csv Catalyst column (tolerant)
- `row_tube_utils.py`: `COLUMN_NAMES` is now the single shared ordered constant
  `['Weld', 'Bend', 'Hanger', 'Catalyst']` (row_tube_utils.py:6-9). `create_row_tube_data` skips any
  column not present in the CSV `data` (row_tube_utils.py:27-31) so Train 1 (no Catalyst) still works.
- `post_processing_utils.py`: added `import applet_scripts.smr_outlet_pigtail.row_tube_utils as rtu`
  (post_processing_utils.py:23). In `_create_length_damage_csv` the hard-coded
  `['Weld', "Bend", "Hanger"]` loop is replaced with the shared constant intersected with the file's
  `headers`, preserving column order (post_processing_utils.py:944-947):
  ```python
  segment_keys = [key for key in rtu.COLUMN_NAMES if key in headers]
  for idx, key in enumerate(segment_keys):
  ```
  Geometry-stitching logic (the `idx > 0` continuity branch) is unchanged; a comment notes the
  segment order follows the Row.csv column order. No Row.csv data files were modified.

## Verifications (3 required, all confirmed)
1. **Component-type-name substring is the right accessor.**
   `Component.get_component_type_name` returns `ref_component_type`
   (tools/akselos/model/component.py:254-255), a value like `.../hanger_system` — the component
   *type* directory name, not the ref/instance name. The confirmed component-type directory is
   `hanger_system` (data/collections/akselos-testing/smr/test_smr_outlet_pigtail/components/hanger_system).
   The existing `set_up_cold_preset` (pre_processing.py:61-65) and `set_up_model_configs`
   (pre_processing.py:42-43) already substring-match on `get_component_type_name`
   (`"sub_header_core_center" in ...`, `"main_pipe" not in ...`), so the same accessor + substring
   is the established, correct pattern. **No accessor change needed** — used
   `get_component_type_name` as spec'd. (Note: the local test collection is Train 1 and has no
   `cattube_reducer` type dir; the `cattube_reducer` name is confirmed as the agreed type name in
   the sibling dashboard JSON, dashboard/applet_scripts/smr_outlet_pigtail_whatif/run_creep_analysis_what_if.json:110.)
2. **`"x_y_z_theta_constraint"` is a real group key.** Defined in `PORT_CONSTRAINT_GROUPS`
   (tools/akselos/model/port_constraint_group.py:178-181) with fields
   `['x', 'y', 'z', 'theta_x', 'theta_y', 'theta_z']`, folded into
   `NAME_TO_PORT_CONSTRAINT_GROUP` at port_constraint_group.py:212. The four fields we set
   (theta_x/x/y/z) are all valid members. **Exact string is correct.**
3. **Command signatures.** `set_port_constraint_group_command(self, list_of_ports_or_port_constraints, port_constraint_group_name)`
   (component_system_model_commands.py:48-63) — takes a list + group name; raises on unknown group.
   `set_port_constraint_command(self, port_or_port_constraint, name, value)`
   (component_system_model_commands.py:95-107) — accepts a single PortConstraint. Both call sites match.

## Not done / environment note
Could not run `ruff`/`ty` — the sandbox blocks `uv sync` (venv `lib64` symlink access denied) and no
`ruff` binary exists under `.venv`. Changes are small and match surrounding style (import ordering,
docstrings, <=320 line length, copyright headers untouched). Linting is smr-qa's step.

## What smr-qa must assert
- `get_port_constraint_values`: defaults returned when `port_constraint_configurations` is False;
  each field overridden with `f"{value} * <unit>"` (m for x/y/z, rad for theta_x) only when the
  group is on AND the value is not None; None values fall through to the default.
- `set_up_port_constraints`: on a fixture with cattube_reducer<->hanger_system connections, every
  such connection ends up with `constraint_type == "x_y_z_theta_constraint"` and the 4 expected
  expressions; count == 104/unit; non-matching connections untouched.
- `PreProcessing.go`: calls `set_up_port_constraints` only when `is_train_2 and constraint_values`
  (Train 1 / no values -> skipped); the two new kwargs are trailing and default-safe.
- Row handling: `create_row_tube_data` and `_create_length_damage_csv` both work with a Train 1
  Row.csv (no Catalyst) and a Train 2 Row.csv (with Catalyst), reading Catalyst in column order when
  present. Confirm the shared `rtu.COLUMN_NAMES` is the only column-order source (no residual
  hard-coded list).
- Import: `row_tube_utils as rtu` added to post_processing_utils keeps ruff import-ordering
  (placed before `smr_*` siblings).
