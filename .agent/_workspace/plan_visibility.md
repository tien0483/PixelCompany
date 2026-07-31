# Plan A — Visibility control + Visibility Option box

**Ticket: AKS-20746**

> **Orchestrator:** `wgpu_orchestrator` (`.agent/skills/wgpu_orchestrator/SKILL.md`) · **Mode:** agent team · **Isolation:** git **worktree**, branch `AKS-20746-visibility-box` · **Skill:** `checkbox_design` for the box UI.
> **Sequencing:** Do this ticket **first** — it establishes the gating model, `show_*` config, presence report, and the box that Plan B's toggle plugs into. Plan B (`AKS-20745`) branches off this result.

## Execution assignment (next session)
| Phase | Agent (`.agent/agents/`) | runtime · model | Work |
|---|---|---|---|
| 1 Map | **wgpu-explorer** | Explore · opus | Map boundaries: `is_empty` pattern, `render()` dispatch + clear, `on_bounds_changed` plumbing ([web_app.rs:345](../../tools/wgpu_renderer/src/web_app.rs#L345)), `apply_config` `show_*` arms, `SettingsPanel`. Output boundary map to `_workspace/`. |
| 2 Rust | **wgpu-systems** | gp · opus | §1 `is_empty()` on shaded+translucent; §3 keep-clear guard; §4 unhandled-stage log; presence gather in `wgpu_renderer`. |
| 2 WASM+FE | **wgpu-web** | gp · opus | §2 `set_on_layers` export + fire points + JS binding + zustand; §5 Visibility Option box (uses `checkbox_design`) + `config.display.show_*` wiring + coupling. |
| 3 Verify | **wgpu-qa** | gp · opus | build native+wasm32, clippy, boundary checks (callback sig, config arms), manual `.aks` vs `.asl` matrix. Incremental per module. |

Worktree note: agents operate **in the one ticket worktree** (coordinated by the orchestrator, sequential on shared files: `renderer_config.rs`, `graphics_window.rs`, `wgpu_renderer.rs`), **not** per-agent worktrees — avoids intra-ticket divergence. QA gates sign-off.

## Goal
A **Visibility Option box** that lets the user show/hide overlay layers (sensors, extreme points, triad, color bar, …), built on a correct, consolidated visibility model in `wgpu_renderer`:
- **Data stages** (`scalar_field`, `shaded`, `translucent`) are **data-gated** — drawn iff their bundle has data. **No user toggle** (each face lives in exactly one stage; a toggle would punch holes). Surfaced as **read-only status**.
- **Decoration/overlay stages** (`triad`, `sensors`, `color_bar`, `extreme_points`) are **flag-gated** (+ data presence where the decoration depends on data) → these are the **toggles** in the box.
- Surface *what data is loaded* via a presence **report** to JS, which also drives **which toggles appear/enable**.

## Background (verified)
- Stage assignment happens at export from the HUI graphics tree: `RemoteRenderList` (web) inherits the rule `alpha<1 → Translucent; FlatRenderType → Flat; else Shaded` ([render_list.py:149-158](../../tools/gl_graphics/render_list.py#L149)). Scalar faces → `ScalarFieldRenderStage`.
- Route = data contract: one canvas = one `renderGroupPath`; field switch reloads only the scalar bin ([WgpuCanvas.tsx:111](../../dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx#L111)).
- wgpu `render()` consumes only `scalar_field` / `translucent` / `shaded` ([wgpu_renderer.rs:805](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L805)). Flat/Pick/Ghost/Highlight/Selection are silently dropped.
- `color_bar` already uses the correct hybrid: flag AND data (`!scalar_field.is_empty() && bounds.is_some()`, [wgpu_renderer.rs:853](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L853)).

## Scope (no data-stage flags)

### 1. `is_empty()` parity on shaded + translucent
`ScalarFieldStage` has `is_empty()` ([scalar_field_stage.rs:290](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L290)). Add the same (`render_bundle.is_none()`) to `ShadedRenderStage` and `TranslucentRenderStage`. Needed for the presence report and for any data-dependent decoration.

### 2. Presence report → JS (`on_layers_changed`)
Mirror the existing `on_bounds_changed` plumbing ([web_app.rs:345](../../tools/wgpu_renderer/src/web_app.rs#L345)):
- New wasm export `set_on_layers(canvas_id, callback)` + handler slot in `CanvasEventHandlers`.
- Fire it: (a) after `FinishAddGraphicsWindow` (initial), (b) after `UpdateScalarData` (field reload).
- Payload: `{ scalar_field: bool, shaded: bool, translucent: bool, field_name: String }` — presence from the three `is_empty()`, `field_name` already known at `update_scalar_field` ([web_app.rs:438](../../tools/wgpu_renderer/src/web_app.rs#L438)).
- React shows what's loaded (labels), and only renders decoration toggles that make sense.

### 3. Keep the framebuffer clear intact
`scalar_field.render_model` clears (`LoadOp::Clear(WHITE)`, [scalar_field_stage.rs:392](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L392)) and is the base layer. Do **not** add a `visible` short-circuit that early-returns out of `render_model` — the pass (with clear) must still run; only `execute_bundles` is empty when no data. No change required; this is a guard-rail for the implementer.

### 4. Log unhandled render stages
In `set_render_bundle` (or where `render_map` is dispatched), log any `RenderStage` the wgpu renderer does not handle (Flat/Pick/Ghost/Highlight/Selection). Turns silent geometry drops into a visible warning.

### 5. Visibility Option box (AKS-20746, frontend) — coker 3D widget
Primary real use case = the coker dashboard 3D widget, which is **variable/small** (`height: calc(100vh - 234px)` in a column, [FatigueStatus.tsx:297](../../dashboard/papps/frontends/src/coker_dashboard/pages/FatigueStatus/FatigueStatus.tsx#L297)). Build with the **`checkbox_design`** skill (`.agent/skills/checkbox_design/SKILL.md`).

**Form — Adaptive (decided):**
- **Big widget:** small inline "Layers" panel pinned in a corner, switches visible.
- **Small widget:** collapses to a single **layers icon** (new `CircularButton` next to Fit/Home, [WgpuCanvas.tsx:276](../../dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx#L276)) that opens the same list as a **popover**.
- Drive the collapse off the existing size signal the colorbar already uses — `colorBarLayout.is_text_visible` / `set_on_layout` ([WgpuCanvas.tsx:154](../../dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx#L154)). Same threshold → consistent collapse behavior across colorbar + layers.

**Structure — Flat, availability-driven (decided):**
- Flat list under a "Layers/Overlays" header. **No tree / no parent select-all** (2–4 items; indeterminate state is error-prone per skill).
- **Switches** (immediate-apply), full-label hit area, keyboard + visible focus ring.
- **Toggles (overlays):** sensors, extreme points, triad, color bar. State ↔ `config.display.show_*`; on change → `update_wgpu_config` ([WgpuCanvas.tsx:229](../../dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx#L229)).
- **Only render a toggle when its layer has data** (presence + coupling §5a): model-only `.aks` → only sensors/triad; solution `.asl` → all four. A dead toggle is worse than none.
- **Read-only status row:** "Model" / "Solution" from the `on_layers_changed` report — not a toggle.

> Rejected: always-on inline panel (eats scarce canvas), gear-only (vanishes in collapsed/model-only). Popover-only is the fallback if the inline panel proves cramped even on big widgets.

### 5a. Coupling / overlap rules (consolidation)
Decoration availability depends on what data loaded:

| Loaded (route/export) | Data stages present | color_bar toggle | extreme_points toggle | sensors / triad toggle |
|---|---|---|---|---|
| **Model `.aks`** (no field) | shaded (+translucent) | **hidden/disabled** (no scalar) | **hidden/disabled** (needs field) | available |
| **Solution `.asl`** (field) | scalar_field | available | available | available |

Rule: color_bar and extreme_points are meaningful **only when `scalar_field` is present**. Drive their toggle visibility from the presence report's `scalar_field` flag. sensors/triad are always available.

## Decision table
| Layer | Gate | In the box? |
|---|---|---|
| scalar_field / shaded / translucent | data (bundle present) — no flag | read-only status |
| color_bar | flag AND data (scalar present) | toggle, coupled to scalar |
| extreme_points | flag AND data (scalar present, Plan B) | toggle, coupled to scalar |
| sensors / triad | flag | toggle, always |
| awareness | presence report (`on_layers_changed`) | drives availability |

## Files
- `tools/wgpu_renderer/src/shaded_stage.rs`, `translucent_stage.rs` — add `is_empty()`.
- `tools/wgpu_renderer/src/web_app.rs` — `set_on_layers` export, handler slot, fire points.
- `tools/wgpu_renderer/src/wgpu_renderer.rs` — gather presence; unhandled-stage log.
- JS: `WgpuRenderer` binding + `WgpuCanvas.tsx` callback wiring + zustand store field for layer presence.
- Frontend: adaptive Visibility "Layers" box — inline panel (big) + layers `CircularButton`→popover (small), collapse driven by `colorBarLayout.is_text_visible`; built per `checkbox_design` skill; flat availability-driven switches; `config.display.show_*` wiring. Verify in the coker `FatigueStatus`/`ProcessMonitoring` widget at small heights.

## QA (wgpu-qa)
- `cargo build -p wgpu_renderer` native **and** `--target wasm32-unknown-unknown`; `clippy -D warnings`.
- Boundary: `set_on_layers` JS signature ↔ Rust call args (count/types), like `on_bounds`; `config.display.show_*` ↔ `apply_config` arms.
- Manual: model-only (`.aks`) → status "Model", color_bar/extreme toggles hidden; solution (`.asl`) → status "Solution", all toggles present. Confirm clear still happens with no scalar field (no stale frame). Toggling each overlay shows/hides without affecting the model.
- Coker responsive: in `FatigueStatus`/`ProcessMonitoring`, shrink the widget → "Layers" inline panel collapses to the icon+popover at the **same** threshold the colorbar collapses (`is_text_visible`). No overlap with model/colorbar/field dropdown at small heights.

## Out of scope
No data-stage user toggles. No UV. Extreme-point compute/render = Plan B (this plan only adds its visibility toggle + coupling).
