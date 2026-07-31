# HANDOFF — wgpu_renderer Visibility + Extreme-Point (AKS-20746, AKS-20745)

Single entry point for a fresh session/agent. Read this, then the linked docs. Goal: build two
tickets on `tools/wgpu_renderer`, plus an optional dead-code audit. Decisions are already made —
don't re-derive; if you must change one, update the relevant doc + `BRANCH_MAP.md`.

## Read order
1. **`.agent/_workspace/BRANCH_MAP.md`** — LIVE source of truth: branch model, base, file ownership, seam files, worktree map, split-MR review flow. Tool-agnostic.
2. **`.agent/_workspace/plan_visibility.md`** — AKS-20746 (do FIRST).
3. **`.agent/_workspace/plan_extreme_point.md`** — AKS-20745 (stacks on 20746).
4. **`.agent/_workspace/plan_deadcode_cleanup.md`** — optional audit, independent.
5. **`.agent/skills/checkbox_design/SKILL.md`** — for the visibility box UI.
6. Optional: **`.agent/skills/wgpu_orchestrator/SKILL.md`** + **`.agent/agents/`** — agent team to execute.

## What we're building
- **AKS-20746** — correct visibility model + an adaptive "Layers" Visibility Option box for the coker 3D widget.
- **AKS-20745** — extreme-point markers (global max/min of the current solution field), sphere+label like a sensor, colored by the color bar.

## Architecture facts established (so you don't re-derive)
- **Render stages mean different things on the same mesh:** `scalar_field` = solution result as color (value→colorbar bins, no lighting, **clears the framebuffer** = base layer); `shaded` = solid model, lit by normals, flat material color; `translucent` = see-through shell + wireframe edges, unlit, alpha-blended. Render order: scalar_field → translucent → shaded → sensors → triad ([wgpu_renderer.rs:805](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L805)).
- **Route = data contract.** One canvas = one `renderGroupPath` (avro built by `remote_render_list.py` from the HUI graphics tree). Each render item is pre-tagged with its stage at export; the loader is dumb pass-through. Field switch reloads only the scalar bin ([WgpuCanvas.tsx:111](../../dashboard/papps/frontends/src/library/components/WgpuCanvas/WgpuCanvas.tsx#L111)).
- **Stage assignment rule** (export): face alpha<1 → Translucent; opaque FlatRenderType → Flat; else Shaded; scalar faces → ScalarField ([render_list.py:149](../../tools/gl_graphics/render_list.py#L149)). Each face goes to **exactly one** stage — no fallback duplicate.
- **Translucent is dormant, not dead** — fed only when HUI exports alpha<1. Keep it.
- **wgpu consumes only 3 stages** (scalar_field/translucent/shaded). Flat/Pick/Ghost/Highlight/Selection are deserialized but **silently dropped** — hence the unhandled-stage log in Plan A/C.
- **Visibility model:** data stages (scalar/shaded/translucent) are **data-gated** (drawn iff bundle present) — NO toggle, because toggling one punches a hole (no fallback). Decorations (sensors/triad/color_bar/extreme_points) are **flag-gated**. color_bar already does the right hybrid: flag AND data ([wgpu_renderer.rs:853](../../tools/wgpu_renderer/src/wgpu_renderer.rs#L853)).
- **UV mapping brings nothing** to picking/inspection/line-rendering — it's a display feature (2D contour). Dropped from scope.
- **Extraction collapse loses ids:** `_remove_unused_vertices` remaps to a compact range, dropping original node/element ids ([remote_render_list.py:240](../../tools/gl_graphics/remote_render_list.py#L240)). Future mesh-pick/point-inspection needs ids carried through + ray tests (`ray_segment` already exists in `pick_utils.rs`, unused, forward-looking). NOT part of these two tickets — noted for later.
- **Coker widget is the real customer use case** and is variable/small (`height: calc(100vh-234px)`, [FatigueStatus.tsx:297](../../dashboard/papps/frontends/src/coker_dashboard/pages/FatigueStatus/FatigueStatus.tsx#L297)). It already has a collapse signal (`colorBarLayout.is_text_visible`) the box should reuse.

## Decisions locked
**AKS-20746 (visibility):**
- Data stages = data-gate (read-only "Model"/"Solution" status); decorations = flag-gate toggles.
- Add `on_layers_changed` presence report (`{scalar_field, shaded, translucent, field_name}`); add `is_empty()` to shaded+translucent; keep the framebuffer clear; log unhandled stages.
- Box = **adaptive** (inline panel when big; layers icon→popover when small, collapse on `is_text_visible`); **flat, availability-driven switches** (no tree). Coupling: color_bar + extreme toggles only when scalar present (`.aks` model → no colorbar; `.asl` solution → colorbar).

**AKS-20745 (extreme point):**
- Reuse `SensorStage` as a 2nd instance `extreme_point_stage` (zero new GPU code). Global max/min.
- **D2 range-filtered:** extreme = max/min among values within the current colorbar `[lo,hi]`; point+value+color move on bounds change → cache the field CPU-side, recompute dirty-checked on reload + bounds change.
- Color from the color bar via new `Globals::color_for_value` (mirror the scalar-field bin logic).
- Tie (min==max) → **one** marker. Label fixed decimals `{:.3}` + unit. All-out-of-range → no marker.
- Gate: `show_extreme_points` flag AND extremes present.

## How to execute
- **Branches (INDEPENDENT — user decision 2026-06-30):** both fork `master @ 078276f512` directly, NOT stacked. `AKS-20746-visibility-box` (committed `b06256be0a`) and `AKS-20745-extreme-point` (off master, empty). Worktree per ticket (`AKS-20746-wt`, `AKS-20745-wt`). 20745 builds standalone — adds its OWN `show_extreme_points` + box toggle; overlap with 20746 reconciled at merge. See BRANCH_MAP.md.
- **Roles (if using the agent team):** wgpu-explorer (map/verify — esp. does `RenderList` retain `array_bundle`), wgpu-systems (Rust), wgpu-web (WASM export + React box), wgpu-qa (build native+wasm32, clippy, correctness). Orchestrate via `wgpu_orchestrator`. All `model: opus`. Agents share the one ticket worktree.
- **WASM rebuild after Rust edits** before the dashboard reflects changes (see `build_wgpu_renderer.py`). Verify in coker `FatigueStatus`/`ProcessMonitoring` at small + large widget sizes.
- **Review:** split-MR per BRANCH_MAP (20746 can split MR1 Rust / MR2 WASM / MR3 frontend; 20745 likely one MR). Reviewer reviews the child branch; comments flow up.
- Commit prefix `AKS-2074x`; seam comments `// AKS-<id> (Tien):`.

## Open / watch
- **Verify first (20745):** does `RenderList` keep `array_bundle` (CPU vertices + `model_from_local`) after construction? If dropped, cache per-item `(vertices, model_from_local, scalar_buffer_range)` at construction.
- Extreme-point all-out-of-range behavior defaulted to "no marker" — revisit if it feels wrong live.
- Flat-tagged opaque faces would silently vanish in wgpu — the unhandled-stage log surfaces this.

## Status (2026-06-30)
Plans + branch map + checkbox skill + agent team all written. **No branches/worktrees created, no code changed.** Base `master @ 078276f512`. Memory: `project_wgpu_visibility_extreme_plans` + `project_wgpu_harness_team`.
