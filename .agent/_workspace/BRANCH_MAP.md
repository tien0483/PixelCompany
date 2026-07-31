# wgpu_renderer Visibility + Extreme-Point — Branch Map (LIVE MARKER)

> **Read this before touching wgpu_renderer visibility / extreme-point code.**
> Source of truth for which code belongs on which branch, which worktree owns which branch,
> and how the work is reviewed. **Any agent or human** (not only Claude) must read this instead
> of re-deriving the split from the diff — re-deriving causes merge + review conflicts.
> Keep it current: update the LIVE map + status on every branch/worktree change.

This is tool-agnostic. The Claude harness (`.agent/`) is one way to execute it, not a requirement —
the plans, branch model, file ownership, and review flow below stand on their own.

## Tickets & plans
| Ticket | What | Plan (read in full first) |
|--------|------|---------------------------|
| **AKS-20746** | Visibility control + adaptive Visibility Option box (coker widget) | `.agent/_workspace/plan_visibility.md` |
| **AKS-20745** | Extreme-point layer (global max/min, color from color bar, D2 range-filtered) | `.agent/_workspace/plan_extreme_point.md` |

Supporting: `.agent/skills/checkbox_design/SKILL.md` (box UI). Optional orchestration: `.agent/skills/wgpu_orchestrator/SKILL.md` + agents in `.agent/agents/`.

## Branch model (INDEPENDENT — all off master)
```
master @ 078276f512
 ├─ AKS-20746-visibility-box   gate model + show_* config + on_layers_changed + the box.
 ├─ AKS-20745-extreme-point    extreme-point layer; ships its OWN show_extreme_points + toggle.
 └─ AKS-20774-consolidate-configs   consolidate 3D-widget configs (color bar / overlay text /
                               triad / sensors / background) out of hardcode into initialConfig +
                               a config UI + saved user prefs. Relational groups → one knob.
```
- **Decided 2026-06-30 (user): both fork `master` independently — NOT stacked.** 20745 no longer
  inherits 20746's pieces.
- **Overlap to reconcile at merge** (both branches now add the same things → conflict when both
  reach master): `DisplayConfig.show_extreme_points` (`renderer_config.rs` + TS `types.tsx`), the
  apply_config arm (`graphics_window.rs`), and the extreme-points toggle in the Visibility box.
  Whichever merges second resolves; keep both additive + mark with `// AKS-<id> (Tien):` so the
  reconciler can tell them apart. 20745 must build standalone — it adds its own `show_extreme_points`
  field + toggle (cannot assume 20746's box exists).
- 20746 already committed `b06256be0a`; 20745 reset to `master`, empty.
- Commit prefix: every commit starts with `AKS-20746` / `AKS-20745`. Seam edits get a human-voice
  `// AKS-<id> (Tien):` (Rust/TS) comment so merges/reviewers know how to reconcile.

## Base
Both fork from `master @ 078276f512`, **independently** (user decision 2026-06-30). Confirm with `git merge-base`.

## File / area ownership
| File / area | AKS-20746 (visibility) | AKS-20745 (extreme) |
|-------------|------------------------|----------------------|
| `src/shaded_stage.rs`, `src/translucent_stage.rs` | OWNS — add `is_empty()` | inherits |
| `src/web_app.rs` | OWNS — `set_on_layers` export + fire points | inherits |
| `src/renderer_config.rs` `DisplayConfig` | OWNS — `show_*` incl. `show_extreme_points` | inherits (uses `show_extreme_points`) |
| `src/render_list.rs` | unhandled-stage log | OWNS — extremes compute + cache, `scalar_field_extremes` |
| `src/wgpu_renderer.rs` | presence gather; unhandled-stage log | OWNS — `extreme_point_stage` instance, render, `Globals::color_for_value` |
| `src/graphics_window.rs` | `apply_config` `show_*` arms | OWNS — build markers + dirty-checked recompute |
| `src/custom_layer/` | — | reuses `sensor_stage::SensorStage` (no edit; 2nd instance) |
| JS `WgpuRenderer` binding + `WgpuCanvas.tsx` + zustand | OWNS — `on_layers_changed` wiring + the box | adds `show_extreme_points` toggle into the box |
| Frontend Visibility box (near `SettingsPanel`) | OWNS — adaptive panel/popover, flat switches | adds one toggle |

**Shared seam files** (both branches touch → conflict points when 20745 stacks/merges):
`renderer_config.rs`, `wgpu_renderer.rs`, `graphics_window.rs`, and the frontend box + zustand.
Mark seam edits with `// AKS-<id> (Tien):`. Because 20745 stacks on 20746, most "shared" files are
already 20746's when 20745 starts — 20745 ADDS to them, keeping its diff additive.

## Worktrees — LIVE map (update on every change)
| Worktree path | Branch | Role | Status |
|---------------|--------|------|--------|
| `E:/akselos-dev-3.10/akselos-dev-2` | `master` | baseline | — |
| `E:/akselos-dev-3.10/AKS-20746-wt` | `AKS-20746-visibility-box` | visibility + box | **committed `28d96af795`** — tree box + eye + persistence; not pushed |
| `E:/akselos-dev-3.10/AKS-20745-wt` | `AKS-20745-extreme-point` | extreme layer (independent, off master) | **committed `6b92ac77cf`** — markers + contrasting glow; not pushed |
| `E:/akselos-dev-3.10/config-consolidation-wt` | `AKS-20774-consolidate-configs` | consolidate 3D-widget configs (no hardcode) + UI + saved prefs | **committed `67b6253168`** — HIGH-value fields + UI + ConfigStore; QA green; not pushed |

Rule: a branch sits in at most one worktree — never `git checkout` one already checked out elsewhere
(this repo already has 7 live worktrees). Within a ticket, agents edit IN that ticket's one worktree
(coordinated, sequential on shared files) — not per-agent worktrees, which diverge.

Setup commands (run when starting):
```
git worktree add ../AKS-20746-wt -b AKS-20746-visibility-box master
# after 20746 is reviewed/merged (or at least stable):
git worktree add ../AKS-20745-wt -b AKS-20745-extreme-point AKS-20746-visibility-box
```

## Review flow (split-MR — so any reviewer can proceed)
Goal: small, self-contained, independently-buildable review units (model: `_archive/repo-misc/plans/split_MR_plan.md`).
- Each ticket is at minimum ONE MR. If a ticket's diff is large, split into sequential review MRs,
  each a single "idea", each building + passing on its own. Suggested split if 20746 grows:
  - `AKS-20746-MR1` Rust: `is_empty()` + presence gather + unhandled-stage log.
  - `AKS-20746-MR2` WASM: `set_on_layers` export + JS binding + zustand.
  - `AKS-20746-MR3` Frontend: adaptive Visibility box + `show_*` wiring + coupling.
  20745 is smaller — likely one MR (compute+cache, render instance, marker build+gate).
- A reviewer reviews the CHILD branch/MR. Reviewer comments are applied ON that branch, then flow up
  (20746 → 20745 via merge; never rebase a branch someone else may have based on).
- **WASM rebuild after Rust changes** (the renderer is consumed as wasm by the dashboard):
  `cd tools/wgpu_renderer && cargo build --release --target wasm32-unknown-unknown && wasm-bindgen ...`
  then copy `build/` into `dashboard/.../wasm/wgpu_renderer/` (see `dashboard/papps/frontends/build_wgpu_renderer.py`).
  Frontend can't see Rust changes until this is done.

## Verification (per branch, before review)
- `cargo build -p wgpu_renderer` native + `--target wasm32-unknown-unknown`; `cargo clippy -p wgpu_renderer -- -D warnings`; `cargo test -p wgpu_renderer`.
- Rebuild wasm + run the coker dashboard (`FatigueStatus`/`ProcessMonitoring`) to verify the widget at small + large sizes.
- Decisions locked in the plans (D2 range-filtered, color-from-colorbar, tie→one marker, `{:.3}`, data-gate vs flag-gate, adaptive flat box). Don't re-litigate; if changing, update the plan + this map.

## Status log (append on every change)
- 2026-06-30: Map created. Both branches **not created**. Plans + checkbox skill ready. Base `master @ 078276f512`. Nothing started.
- 2026-06-30: AKS-20746 built (explorer→systems→web→qa, all opus). QA GREEN (native+wasm32 build, clippy clean on new code, 24 tests, wasm-bindgen rebuilt+copied, tsc clean). Committed `b06256be0a` on `AKS-20746-visibility-box` (13 source files; `public/` data + `.agent/` excluded). Tested live via `simple_wgpu_canvas_app` (vite dev). 20745 worktree created at `AKS-20745-wt`, forked off 20746 tip `b06256be0a` — inherits box + `LayerPresence` + `DisplayConfig.show_extreme_points`. node_modules junctioned from dev-2 in both worktrees. Not pushed, not reviewed.
- 2026-06-30: **User changed branch model — both off master, NOT stacked.** Reset `AKS-20745-extreme-point` from `b06256be0a` back to `master @ 078276f512` (had no own commits — nothing lost). 20745 now builds standalone and ships its own `show_extreme_points` + toggle; overlap with 20746 (config field, apply arm, box toggle) reconciled at merge-to-master. 20746 unchanged (`b06256be0a`).
- 2026-06-30: AKS-20745 built (explorer→systems→qa, all opus). Verify-first verdict: `array_bundle` dropped at RenderList::new → caches required. Implemented: dedicated `custom_layer/extreme_point_stage.rs` (ExtremePointStage composing SensorStage — user decision, room for distinct glyph), per-item geometry cache + un-padded scalar-floats cache + `compute_extremes` (D2 range-filter) in render_list.rs, `Globals::color_for_value` (WGSL bin port + clamp), `rebuild_extreme_markers` + dirty-check in graphics_window.rs, `DisplayConfig.show_extreme_points` (Rust + TS). QA GREEN (native+wasm32, clippy clean on new code [1 trivial fix], 24 tests, wasm rebuilt+copied, tsc clean, correctness reviewed — no bugs). Committed `cc22e4b011`. Not pushed, not reviewed.
- 2026-07-01: Reviewed both branches (8-angle finder + verify) and applied minimal refactors + comment tidy, then amended each commit (neat messages, no Co-authored-by trailer). 20746 `b06256be0a`→`0d857db21e`: fixed shaded/translucent is_empty (guard render_bundle so presence is truthful), dropped a leftover console.log + a no-op if-let, kept the native popover button (CircularButton lacks forwardRef for Popover.Target), trimmed AI-ish comments. 20745 `cc22e4b011`→`3c86948a3f`: derived scalar_field_bounds from the cached floats (removed a ~30-line duplicate cast loop), zipped compute_extremes, collapsed the 3 marker-rebuild sites to a single per-render dirty-check (config/field paths only reset last_extreme_bounds; still re-colours on bins/reverse), kept the dedicated ExtremePointStage, trimmed comments. Both: native + wasm32 build, clippy clean on changed lines, tsc clean.
- 2026-07-01: Follow-up features + persistence. 20746 `0d857db21e`→`28d96af795`: adaptive box redesigned to an eye-toggle TREE on large widgets (Overlays group + toggle-all parent) and an eye button + switches popover on small widgets (IconStack2→IconEye); new pluggable `visibilityStore` (localStorage default, swappable for a per-user backend) persisting overlay selections, merged over developer initialConfig on load + debounced auto-save. 20745 `cc22e4b011`→`73de3b6bc4`: extreme markers get a contrasting OUTLINE RING (additive `SensorData.outline_color`; luminance-picked black/white; phased draw so sensors are byte-identical) — the LEADER LINE was dropped (user: the sensor-style offset label is enough; TODO removed).
- 2026-07-01: Marker look changed per user — inner sphere + transparent CONTRASTING glow (not the
  opaque outline ring). Reverted the phased-draw/MarkerBindGroups; `outline_color` now just tints the
  outer glow (`SensorStage::outer_glow_color`); sensors keep their own-colour glow. Marker build in
  graphics_window deduped via a `marker(prefix, value, pos)` closure. 20745 re-amended `6b92ac77cf`
  (+407/-37). Left concise `TODO (config consolidation, next ticket)` notes on the hardcoded
  sensor/extreme constants (SensorManager consts, contrast_outline). 3rd branch `config-consolidation`
  (temp) created off master for that work; rename to its JIRA branch when the id is given.
- 2026-07-01: 3rd branch = AKS-20774 "Consolidate 3D Widget configs". Built full pass (explorer audit
  -> systems Rust -> web TS+UI+ConfigStore -> QA). HIGH-value fields exposed additively (Option,
  defaults = old consts): display.label_font_size (sensor+colourbar labels, not triad), triad_config.scale
  (whole-triad via model transform, render+pick aligned), sensors {pixel_radius, inner_ratio, glow_alpha},
  color_bar bar_height_px/bar_width_px. SettingsPanel gained Display/Triad/Sensors + colour-bar size
  controls. New standalone ConfigStore (full-config persistence, localStorage default, initialConfig <
  saved) — separate concern from 20746's view-only VisibilityStore (user's distinction). QA GREEN
  (native+wasm32, clippy clean on new code, 24 tests, wasm-bindgen rebuilt+copied, tsc clean, defaults
  byte-identical). Committed `67b6253168`. MEDIUM items (sensor/triad colours, tick format, offsets,
  background colour) deferred to a follow-up pass. Background colour was dropped from the HIGH set by user. Comments tidied. Both build native+wasm32, clippy clean on new code, tsc clean. Coker persistence audit: no per-user/per-widget save exists today; reuse the historical_trends object-storage-JSON pattern + add user+canvasId key for the backend adapter later.
- 2026-07-01: UI Checkbox / Visibility Audit on `tiennguyen/new-wgpu-developments`. Restored Master Toggle "Overlays (All)" to `VisibilityPanel` inside the Eye popover. Refactored `SettingsPanel` sliding sidebar into a clean floating `<Popover.Dropdown>` triggered by the `IconSettings` cog. Added `happy-dom` Vitest suite (`WgpuSlice.test.tsx`) asserting safe state merges. Code committed to child branch.
- 2026-07-02: `tiennguyen/new-wgpu-developments` is now the live integration line (all three tickets + follow-ups). Fixed the popover-refactor crash (`isSettingsOpen` undeclared) + Settings double-toggle; fixed first-render extreme markers (empty-cache latch) + label font default 12→13. **Design pivot (per manager): the 3D widget is embedded per page — config is developer-owned via `initialConfig` (no runtime config UI), the only end-user UI is the layers panel.** Removed SettingsPanel + configStore + the enlarge button/`useInteractionStore` (enlarge idea parked in `plan_enlarge_widget.md`). `config.ui.visibility` is a developer allow-list (`VisibilityOption[]`); visibility STATE stays a user runtime pref (`display.show_*`), keeping both the data-gate (color_bar/extreme_points need a scalar field) and flag-gate (user toggle). VisibilityPanel rebuilt as a viewer-style eye-toggle layer list: per-layer type icons, alt-click solo, on/total count, empty state, and truthful colour legend chips (triad X/Y/Z + colormap mirror, reverse-aware). Removed dead `isSettingsOpen`, `Units.tsx`, `visibilityStore.ts`. Follow-up done on `AKS-20746-layer-colors` (off hub), fast-forwarded back to hub `55b3bf4e23`. NOT DONE (needs Rust): hover-to-highlight a layer in 3D — MEDIUM effort, add a highlight bitmask to `Globals` + a fragment multiply in scalar_field/shaded/translucent stages + a `set_layer_highlight` export; per-layer sensor colours are per-type (no single chip). tsc clean; WgpuSlice vitest green (other test files fail on a pre-existing jsdom/ESM infra issue, unrelated). Not pushed.
