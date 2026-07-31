# Handoff — wgpu 3D-widget session 2026-07-02 (read first)

For the next AI agent / reviewer. Pairs with `BRANCH_MAP.md` (branch model + full status log)
and the parked-idea note `plan_enlarge_widget.md`. `.agent/` is gitignored — these docs are local.

## TL;DR
- **Branch (hub / integration line):** `tiennguyen/new-wgpu-developments` @ **`e048554740`**, base `master @ 078276f512`, **14 commits ahead, NOT pushed.**
- **Builds:** tsc 0 errors; `cargo check` (in `tools/wgpu_renderer`) 0; **both vitest suites green — WgpuCanvas 8/8 + WgpuSlice 3/3 (run them with `-p tsconfig`; other test files in the repo fail on a pre-existing jsdom/ESM infra issue, NOT this work)**; wasm + UI rebuilt.

## Review round applied (2026-07-02, after an external reviewer pass)
A reviewer found real issues; all confirmed ones fixed on hub (commits `d09dfa352c` Rust / `e048554740` frontend). Corrections to the earlier "builds green" claim: it had only run the WgpuSlice suite — this branch had **broken its own `WgpuCanvas.test.tsx`** (imported deleted `Units`, mock lacked `set_on_layers`, asserted deleted SettingsPanel testids). Now rebuilt + green.
Fixed:
- **Blast radius — extreme markers leaked into untouched apps.** They were default-visible + auto-built on scalar load. Now `show_extreme_points` defaults **false** (opt-in). Affected reactor_time_series / simple_wgpu_canvas_app / coker.
- **Fit View button restored** (fit without re-orient) — its removal left only Home (forces iso-align), breaking axis-locked panels.
- **Field combobox threshold back to `> 0`** (single-field canvases had lost the field-name display).
- **Config push dedup** — skip the WASM round-trip when serialized config is unchanged (inline-literal `initialConfig` caused identity churn every render).
- **`ui` added to the `updateConfig` merge list** (partial `ui` no longer clobbers).
- **`LayerPresence` deduped** to the single definition in `slices/types` (WgpuRenderer re-exports).
- **Rust (`d09dfa352c`)**: `compute_extremes` skips NaN + clamps truncated payloads; `apply_config` stores `unit_scale` (extreme labels scale correctly) and only resets the extreme dirty-check when a recolour field actually changed (was a full vertex rescan on every unrelated toggle).

Still open from the review (lower value / larger): latent gate — initial layer-presence can report `scalar_field=true` from placeholder-zero buffers before a field loads (`web_app.rs:391`, `render_list.rs:276-281`); ~90 lines dead Switch-era SCSS + a duplicated `.visibility-status-dot` block; orphaned `model_iso`/`getModelImage` in the demo store; `ExtremePointStage` is a pass-through over `SensorStage`; a dormant colormap copy in `ColorBar.tsx` disagrees with Rust (`#ff3300` vs Rust `[1,0.25,0]`) — the LIVE `VisibilityPanel` COLORMAP matches Rust. Pre-existing (not this branch): `onLoadingChange(progress>=100)` passes "isLoaded" into a param `HybridCanvas` reads as "loading" → inverted ready badge.
- **Big shift this session (per manager):** the 3D widget is **embedded per page**. Config is **developer-owned** via `initialConfig` (no runtime config UI). The **only end-user UI is the layers/visibility panel**. Visibility STATE is always a user runtime pref; config only declares the **allow-list** of supported options.
- Working tree clean except `AGENTS.md` (M, unrelated pre-existing) + gitignored junk (`public/`, `stash_*`, `.gemini/`).

## What this session changed (on top of the pre-session hub baseline `db22477065`)
Pre-session baseline already had the 3 tickets: **AKS-20746** visibility, **AKS-20745** extreme points, **AKS-20774** config consolidation, plus another agent's popover refactor (`db22477065`).

Session commits (oldest→newest):
| Commit | What |
|--------|------|
| `1d08c574b4` | **Crash fix**: `isSettingsOpen` used but never destructured → ReferenceError killed the whole canvas render. Also fixed the controlled Settings-Popover double-toggle. Decoupled enlarge to props (removed a `library`→`demo_ai` store import). WidgetCard style prop. colorBarLayout dedup guard (stops a WASM re-render loop). Removed a leftover merge-conflict marker + duplicate `show_extreme_points` in `renderer_config.rs` (HEAD would not compile without it). VisibilityPanel rewrite (dropped drag-reorder, always reachable). |
| `8f9bb745bb` | **AKS-20745 fixes**: extreme markers no longer latch empty on first render (retry until the scalar cache lands); label-font default 12→13 to match `color_bar.rs`. |
| `915759e472` | (intermediate) developer allow-list `userControls` + no-op default config store. |
| `6d3426a423` | (intermediate) unit switcher developer-supplied. |
| `00f5061552` | **Pivot**: config is developer-only. Deleted `SettingsPanel` + settings popover + `configStore` persistence. Removed the enlarge button + `useInteractionStore` + Home fullscreen overlay + WidgetCard style. `config.ui` collapsed to `{ visibility?: boolean }`. VisibilityPanel rebuilt as an eye-toggle layer list. |
| `877cdc3f6c` | `config.ui.visibility` → **allow-list** `VisibilityOption[]` (not a boolean). Panel upgrades: **alt-click solo**, stack trigger icon, on/total count, empty state. Removed dead `isSettingsOpen`; deleted unused `Units.tsx`; trimmed the vitest suite. |
| `de6c6dedd8` | **Colour legend chips** (truthful, TS-only): Triad X/Y/Z, Color Bar + Extreme Points colormap (mirrored from `wgpu_renderer.rs`, reverse-aware). Sensors: none (per-type colours). |
| `55b3bf4e23` | Deleted dead `visibilityStore.ts` (superseded). |

Note: `915759e472` + `6d3426a423` added `userControls`/`unitOptions` that `00f5061552` then removed — **history noise**. The NET diff vs master is clean; consider squashing these when this becomes a real MR to master (do NOT rebase now — other worktrees exist off the ticket branches; see BRANCH_MAP rule).

## Design model (what a reviewer must hold in mind)
- **Config = developer-owned.** Pages pass `initialConfig` (a `WgpuRendererConfig` JSON) → applied to store → pushed to the renderer (`update_wgpu_config`). No user config UI, no user-side persistence.
- **`config.ui.visibility: VisibilityOption[]`** = developer allow-list of which layers the page supports toggling. Absent/empty ⇒ no panel. It is one export/import JSON blob with the rest of the config. Rust ignores the `ui` field (serde, no `deny_unknown_fields`).
- **Visibility STATE is always a user runtime pref** in `display.show_*` (`show_sensors`/`show_triad`/`show_color_bar`/`show_extreme_points`), toggled in the panel.
- **Two gates, both kept:** data-gate (`needsScalar` — `color_bar`/`extreme_points` only appear when a scalar field is loaded) AND flag-gate (the user `show_*` toggle).

## Layers panel (only end-user UI) — `VisibilityPanel.tsx`
Stack button → popover. Rows: read-only Model/Solution stage badge; an "Overlays" parent (toggle-all, mixed state); per-overlay eye-toggle rows with a type icon + colour chip + eye. **Alt-click a row = solo (isolate).** Header shows on/total count; empty state when a view has no toggleable layers.

## Key files (net vs master)
Frontend (`dashboard/papps/frontends/src/library/components/WgpuCanvas/`): `WgpuCanvas.tsx` (slimmed props, config→renderer), `VisibilityPanel.tsx` (the panel), `zustand/slices/types.tsx` (`WidgetUiConfig`, `VisibilityOption`, config types), `zustand/slices/WgpuSlice.tsx` + `zustand/store.tsx` (state), `WgpuRenderer.tsx` (`set_on_layers` binding). SCSS: `assets/sass/components/wgpu_component.scss` (`.visibility-*`). App: `demo_ai_dashboard/Home/Home.tsx` (opts into `ui.visibility`). Test: `__tests__/WgpuSlice.test.tsx`.
Rust (`tools/wgpu_renderer/src/`, AKS-20745/20774, QA'd earlier): `renderer_config.rs`, `graphics_window.rs`, `render_list.rs`, `wgpu_renderer.rs`, `custom_layer/extreme_point_stage.rs`, `sensor_stage.rs`, `color_bar.rs`, `triad_stage.rs`, `web_app.rs`, `shaded_stage.rs`, `translucent_stage.rs`.

## Verify / review recipe
```bash
# types
cd dashboard/papps/frontends && npx tsc --noEmit -p tsconfig.json      # expect 0
# rust
cargo check -p wgpu_renderer                                           # expect 0
# unit test (this suite only — others fail on infra, see gotchas)
cd dashboard/papps/frontends && npx vitest run WgpuSlice               # 3/3
# wasm (only needed if Rust changed)
python dashboard/papps/frontends/build_wgpu_renderer.py
# UI
cd dashboard/papps/frontends && VITE_MY_APP=demo_ai_dashboard npm run build
```
Review the net diff: `git diff master..HEAD -- dashboard/papps/frontends tools/wgpu_renderer`.

## NOT DONE / open items
1. **Hover-to-highlight a layer in 3D** (#2). Needs Rust: a highlight bitmask on `Globals` + a fragment-shader multiply in `scalar_field`/`shaded`/`translucent` stages + a `set_layer_highlight(canvasId, key)` export + JS binding + a panel hover handler. MEDIUM effort. Recipe detail in the Explore report (see BRANCH_MAP status log 2026-07-02). Do NOT fake it with a visibility blink.
2. **Sensor colour chip** — sensors are per-type (fluid/metal/pressure); no single truthful swatch. Would need the renderer to report present sensor types/colours via the `set_on_layers` payload (trivial to extend — the payload is a `Reflect::set` object in `web_app.rs`).
3. **Coker pages don't opt in.** `FatigueStatus`/`ProcessMonitoring` pass no `ui.visibility` → no layers panel. Add the allow-list to their `initialConfig` if wanted.
4. **Enlarge/fullscreen** — removed; idea + clean reintroduction recipe parked in `plan_enlarge_widget.md`.
5. **Commit-history squash** for the MR-to-master (intermediate add-then-remove commits).

## Gotchas
- **Never `git add -A`.** `public/` (7MB binaries) + generated wasm are gitignored — keep them out. Verify `git diff --cached --name-only | grep -cE 'public/|\.wasm'` = 0.
- **`.agent/` is gitignored** — these handoff docs are local to this machine, not in git.
- **Vitest infra failure**: 2 test files fail with `ERR_REQUIRE_ESM` (`html-encoding-sniffer` → `@exodus/bytes`) under jsdom — **pre-existing infra**, unrelated to this work. The `WgpuSlice.test.tsx` uses happy-dom and passes.
- **`AGENTS.md` shows M** — unrelated pre-existing edit, left unstaged; not part of this work.
- **Not pushed.** Commit convention on this work: `AKS-<id>:` prefix, no Co-authored-by / AI trailer, terse human `// AKS-<id> (Tien):` seam comments.
- Ready to run via `build_papp` + `papp_start` (`demo_ai_dashboard`); wasm + UI already built.
