# Plan B — Extreme-point layer (global max/min of current solution field)

**Ticket: AKS-20745**

> **Orchestrator:** `wgpu_orchestrator` (`.agent/skills/wgpu_orchestrator/SKILL.md`) · **Mode:** agent team · **Isolation:** git **worktree**, branch `AKS-20745-extreme-point`.
> **Depends on Plan A (AKS-20746):** branch this worktree off A's result — it reuses A's `show_*` config, the flag-AND-data gate pattern, and the visibility box (the `show_extreme_points` toggle lands in A's box). Run **after** A.

## Execution assignment (next session)
| Phase | Agent (`.agent/agents/`) | runtime · model | Work |
|---|---|---|---|
| 1 Map | **wgpu-explorer** | Explore · opus | Verify the key boundary: does `RenderList` retain `array_bundle` (CPU vertices + `model_from_local`) post-construction? Map scalar `buffer_range`→vertex index→`model_from_local`. Confirm `Globals.colors/colors_values` shape for `color_for_value`. Output to `_workspace/`. |
| 2 Rust core | **wgpu-systems** | gp · opus | §1 cache field + `compute_extremes(bounds)` (D2 range-filter) + store `scalar_field_extremes`; `Globals::color_for_value`; §2 `extreme_point_stage: SensorStage` instance + render + update_camera. |
| 2 Glue+gate | **wgpu-systems** (graphics_window) → **wgpu-web** (config/JS toggle) | gp · opus | §4 build markers + dirty-checked recompute on reload/bounds-change; §5 `show_extreme_points` flag AND extremes-present, wired into Plan A's box. |
| 3 Verify | **wgpu-qa** | gp · opus | build native+wasm32, clippy, geometry tests; correctness: picked position = actual in-range max/min (spot-check), reload + bounds-change recompute, tie→single marker, out-of-range→no marker, color matches surface. |

Worktree note: single ticket worktree, orchestrator-coordinated sequential edits on `render_list.rs` / `wgpu_renderer.rs` / `graphics_window.rs`. QA gates sign-off.

## Goal
Show two markers for the **current loaded scalar field**: global **max** and global **min** over the whole model. Each marker = sphere + label (sensor style). Label states which it is and the value, e.g. `Max: 12.34 MPa`.
- **Marker color = color-bar color at that value** (not fixed red/blue) — the sphere matches the gradient the field shows.
- Recompute on **field reload** AND on **color-bar change** (bounds / bins / discrete / reverse) so the marker stays correct for the current range.

## Design decision
Extreme point = position + label + sphere color = exactly `SensorData` ([sensor_stage.rs:75](../../tools/wgpu_renderer/src/custom_layer/sensor_stage.rs#L75)). **Reuse `SensorStage` as a second instance** `extreme_point_stage` — zero new GPU code (sphere geometry, screen-constant scaling, label projection all reused). Own toggle, own data. Distinct glyph (diamond/cross) can come later.

## Background (verified)
- Single reload path `update_scalar_field` ([render_list.rs:662](../../tools/wgpu_renderer/src/render_list.rs#L662)), called on first load and every field switch via `reload_scalar_field_array` ([graphics_window.rs:444](../../tools/wgpu_renderer/src/graphics_window.rs#L444)).
- The bounds loop already finds min/max **values** ([render_list.rs:717](../../tools/wgpu_renderer/src/render_list.rs#L717)). Value is free; **position** needs an index→vertex mapping.
- Scalar buffer is one global flat buffer; each render item slices it by `buffer_range` (note [render_list.rs:707](../../tools/wgpu_renderer/src/render_list.rs#L707)). Vertices are per-item (`vertices_id`), transformed by `model_from_local` — same as `get_bounding_box_in_model` ([render_list.rs:763](../../tools/wgpu_renderer/src/render_list.rs#L763)).

## Scope

### 1. Compute range-filtered extremes + positions (`render_list`) — D2
Decision: **range-filtered (D2).** The extreme is the max/min among only values **within the current color-bar range `[lo, hi]`**. Point + value + color move when bounds change → must be able to rescan on bounds change without a re-fetch.

- **Cache the current field CPU-side** after reload: the scalar floats + a per-item map `(vertices, model_from_local, scalar_buffer_range)`. Vertices are static across field reloads and bounds changes — cache once.
- `compute_extremes(bounds: (lo, hi)) -> Option<Extremes>`:
  - Iterate per render item (mirror `get_scalar_field_bounds` [render_list.rs:782](../../tools/wgpu_renderer/src/render_list.rs#L782)); slice cached scalar floats by the item's `buffer_range`, zip with vertices.
  - Consider only values with `lo <= v <= hi`. Track max/min within that filter + the winning vertex.
  - Position = `model_from_local * vertices[local_idx]`.
  - **All values out of `[lo,hi]` → `None`** (no markers). (Edge noted in open Q below.)
  - Use raw field values (not zero-padded), so padding can't win.
- Store `scalar_field_extremes: Option<{ max: (f32, glam::Vec3), min: (f32, glam::Vec3) }>`; `None` when field empty or nothing in range.

**Boundary to verify first (wgpu-systems):** does `RenderList` retain `array_bundle` (CPU vertices + `model_from_local`)? `get_bounding_box_in_model`/`get_scalar_field_bounds` take it as a static arg at init. If dropped, build the per-item cache at construction. The scalar-floats cache is new state on `RenderList` either way (D2 needs the values available at bounds-change time, not just reload).

### 2. Renderer wiring (`WgpuRenderer`)
- Add field `extreme_point_stage: SensorStage` next to `sensor_stage` ([wgpu_renderer.rs:270](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L270)); construct same as sensors.
- In `render()`, after `sensor_stage`, call `extreme_point_stage.render_model(...)` and `extreme_point_stage.update_camera(...)` for constant screen size ([wgpu_renderer.rs:814](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L814)).

### 3. Color from the color bar (AKS-20745)
The marker sphere color = the color the color bar assigns to that value, under the **current** bounds/bins/reverse.
- The mapping data already exists: `Globals { colors[], colors_values[] }` ([wgpu_renderer.rs:101](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L101)), rebuilt every render from `current_color_bar_config` + bounds ([graphics_window.rs:119-126](../../tools/wgpu_renderer/src/graphics_window.rs#L119)).
- Add a CPU helper `Globals::color_for_value(v) -> Vec4` that replicates the scalar-field WGSL bin logic ([scalar_field_stage.rs:50-95](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L50)): discrete = pick bin color; continuous = interpolate between adjacent bin colors; values outside range clamp to end colors. `reverse` is already baked into the colors order, so no special-casing.
- This guarantees the marker matches exactly what the surface shows at that point.

### 4. Build markers + recompute hook (`graphics_window`)
Build two `SensorData` from `render_list.scalar_field_extremes`:
- max → `label = format!("Max: {value:.?} {unit}")`, `color = globals.color_for_value(max_value)`.
- min → `label = format!("Min: {value:.?} {unit}")`, `color = globals.color_for_value(min_value)`.
- `unit` from `current_color_bar_config.unit` / `set_scalar_field_unit`.
- `extreme_point_stage.update_sensors(device, vec![max, min])`.
- Field empty / `None` → `update_sensors(device, vec![])` (SensorStage early-returns on empty).

**Recompute triggers (D2 — point moves with range):**
- **Field reload** — `reload_scalar_field_array` caches the new field (step 1) and runs `compute_extremes(current_bounds)`, rebuilds markers.
- **Color-bar bounds change** — the per-render block at [graphics_window.rs:119-126](../../tools/wgpu_renderer/src/graphics_window.rs#L119) computes `bounds` every frame. When `bounds` changed (**dirty-check**, like `color_bar.update_bounds` guards `if current_bounds == … return` [color_bar.rs:393](../../tools/wgpu_renderer/src/color_bar.rs#L393)), re-run `compute_extremes(bounds)` over the cached field and `update_sensors`. Only on change — never per-frame.
- Bins/reverse change re-colors via `color_for_value` (position unaffected by those).

### 5. Visibility gate (ties into Plan A)
`show_extreme_points` flag **AND** `scalar_field_extremes.is_some()` — mirror the color_bar hybrid. Add to `DisplayConfig` ([renderer_config.rs:40](../../tools/wgpu_renderer/src/renderer_config.rs#L40)) + apply arm ([graphics_window.rs:197](../../tools/wgpu_renderer/src/graphics_window.rs#L197)) + `extreme_point_stage.set_visible`.

## Decisions (resolved)
- **Color source** — from the color bar (`Globals::color_for_value`). (AKS-20745)
- **Recompute semantics** — **D2 range-filtered**: extreme = max/min among values within current `[lo,hi]`; point+value+color move on bounds change.
- **Tie / flat field** (`min == max`) — **show one** marker (collapse to single when uniform).
- **Label number format** — **fixed decimals** `{:.3}` + unit. Honor `unit_scale` from `ColorBarConfig` when scaling the displayed value.

## Remaining edge to confirm (non-blocking)
- **All values out of `[lo,hi]`** (user clipped the range below min or above max): current plan → no markers. Alternative → clamp to nearest in-range extreme. Default to **no markers**; revisit if it feels wrong in use.

## Files
- `tools/wgpu_renderer/src/render_list.rs` — extremes computation + storage (+ possible per-item cache).
- `tools/wgpu_renderer/src/wgpu_renderer.rs` — `extreme_point_stage` field, render, update_camera.
- `tools/wgpu_renderer/src/graphics_window.rs` — build markers on reload; apply visibility.
- `tools/wgpu_renderer/src/renderer_config.rs` — `show_extreme_points`.

## QA (wgpu-qa)
- `cargo build` native + `wasm32-unknown-unknown`; `clippy -D warnings`; run geometry/math unit tests.
- Correctness: picked position maps to the actual max/min vertex (spot-check against a known field); markers update on field switch; empty field clears markers; padded/corrupt field does not select a padding zero.

## Out of scope
Top-N extremes, per-region/per-component extremes, local extrema, UV. Global single max/min only.
