# HANDOFF — wgpu 3D widget work (read this first)

Single read-first doc for the next agent. Three related tickets are in flight, each on its own
branch + git worktree, all forked independently from `master`. Everything is committed but **not
pushed and not reviewed** — the human (Tien) will manually review. Do not push or open MRs unless
asked.

If anything here disagrees with the code, trust the code and update this doc.

---

## 0. TL;DR — current state

| Ticket | What | Worktree | Branch | HEAD | Status |
|--------|------|----------|--------|------|--------|
| AKS-20746 | Visibility model + adaptive "Layers" box + visibility persistence | `E:/akselos-dev-3.10/AKS-20746-wt` | `AKS-20746-visibility-box` | `28d96af795` | committed, QA green |
| AKS-20745 | Extreme-point markers (global max/min of the scalar field) | `E:/akselos-dev-3.10/AKS-20745-wt` | `AKS-20745-extreme-point` | `6b92ac77cf` | committed, QA green |
| AKS-20774 | Consolidate 3D-widget configs (no hardcode) + settings UI + saved prefs | `E:/akselos-dev-3.10/config-consolidation-wt` | `AKS-20774-consolidate-configs` | `67b6253168` | committed, QA green |

- Base for all three: `master @ 078276f512`.
- All three are **independent off master (NOT stacked)** — this was a deliberate user decision.
- Each branch = ONE clean commit (history was amended during review; keep it that way — one
  self-contained commit per branch unless the human says otherwise).
- Working trees are clean except untracked `dashboard/papps/frontends/public/` (test data — never commit it).

---

## 1. Repo facts you must know

- Python 3.10 monorepo. The 3D widget is a Rust + wgpu + WGSL crate at `tools/wgpu_renderer/`,
  compiled to native AND `wasm32-unknown-unknown`, consumed by the dashboard frontend
  (React/TS/Vite) under `dashboard/papps/frontends/`.
- **NEVER read or touch `scrbe/`** (proprietary, off-limits).
- The frontend consumes the renderer as WASM. After ANY Rust change you must rebuild the wasm and
  copy it into the dashboard before the frontend sees it (see §5).
- There are ~7 pre-existing git worktrees in `E:/akselos-dev-3.10/`. A branch lives in at most one
  worktree — never `git checkout` a branch that's already checked out elsewhere.

---

## 2. How the branches / worktrees are set up (branch "skill")

There is NO magic skill command — "use branch skill" just means follow this recipe. The live source
of truth for branch ownership is `.agent/_workspace/BRANCH_MAP.md` — read it before touching shared files.

**To create a new independent ticket branch + worktree (off master):**
```
cd E:/akselos-dev-3.10/akselos-dev-2
git worktree add ../<TICKET>-wt -b <TICKET>-<slug> 078276f512
```
Then seed the untracked bits the worktree does NOT inherit:
1. **Test data** (needed to run the app): copy `public/` in:
   `cp -r akselos-dev-2/dashboard/papps/frontends/public <wt>/dashboard/papps/frontends/public`
   (Original source: `E:/akselos-dev-3.10/_archive/repo-misc/zips/wgpu_data.zip` → unzips to
   `dashboard/papps/frontends/public/`. Note: it lacks `sigma_11.bin`; the test app references it but
   only loads it when that field is selected — `u.bin`/`von_mises.bin` are present so default views work.)
3. **node_modules** (for tsc / vite): make a junction to dev-2's node_modules (Windows):
   `mklink /J "<wt>\dashboard\papps\frontends\node_modules" "E:\akselos-dev-3.10\akselos-dev-2\dashboard\papps\frontends\node_modules"`
   (Do it via a tiny `.bat` file run with `cmd //c` — mklink through git-bash mangles paths.)
4. **.agent/_workspace** docs (untracked): copy the `*.md` in so the agent has context.

**`.gitignore` gotchas:** `public/` is NOT gitignored (so it shows as untracked — never `git add` it,
it's ~7 MB of binaries + wasm). `.agent/` IS gitignored. Generated wasm under
`dashboard/papps/frontends/src/library/components/wasm/wgpu_renderer/` IS gitignored (never commit it).

---

## 3. Commit requirements (STRICT — the user cares)

- **Message prefix:** every commit starts with the ticket, e.g. `AKS-20746: <summary>`.
- **NO AI / co-author trailer.** Do NOT add `Co-authored-by:` or any "Generated with" line. The user
  explicitly removed these. Plain, neat, straightforward messages — a short title line, then bullet
  sections (Renderer / WASM / Frontend) describing what changed and why. No marketing, no fluff.
- **One clean commit per branch.** These branches were amended down to a single commit each. Prefer
  `git commit --amend` to keep it one commit, unless the human asks for separate commits.
- **Stage explicitly; never `git add -A`.** Use `git add -u` for tracked changes + `git add <newfile>`
  for new files. ALWAYS confirm `public/` and generated wasm are excluded:
  `git diff --cached --name-only | grep -c public` must be 0.
- After committing, update `BRANCH_MAP.md` (HEAD hash + status) and its status log, then copy it to
  every worktree's `.agent/_workspace/` (see §8).

---

## 4. Comment requirements (STRICT — no AI-ish comments)

- **Seam / branch-scoped comments:** prefix with `// AKS-<id> (Tien):` (Rust/TS). Write them in a
  terse, human voice — a short note explaining intent or a cross-file contract. NOT an essay.
- **Ban AI-ish comments:** do not narrate the obvious, do not restate the line below, no multi-line
  design-doc blocks inside functions, no dangling content-free `// AKS-xxxx (Tien):` markers, no
  "TODO" for things that were decided against. If a comment just repeats the code, delete it.
- Match the file's existing indentation/style. Some files use tabs oddly (e.g. scalar_field_stage.rs) —
  match the file you edit; don't reformat neighbouring code.
- Copyright header on new files: `// Copyright (C) 2026 Akselos`.

---

## 5. Build / verify (run before declaring done — do NOT fabricate a pass)

From the ticket worktree:
```
cd tools/wgpu_renderer
cargo build -p wgpu_renderer                                   # native
cargo build -p wgpu_renderer --target wasm32-unknown-unknown  # wasm (mandatory if web_app.rs / any cfg path touched)
cargo clippy -p wgpu_renderer -- -D warnings                  # see note below
cargo test -p wgpu_renderer
```
- **Clippy:** the crate is NOT clippy-clean crate-wide — there are ~75-76 PRE-EXISTING errors (incl. an
  unused `use crate::render_list::BufferType;` at graphics_window.rs:4 that is on master). Do NOT try to
  fix those. Only ensure YOUR changed lines are clippy-clean; grep clippy output filtered to your files.
- **Tests:** `cargo test -p wgpu_renderer` currently reports 0 in the bin target; the ~24 geometry unit
  tests live in the lib target (run plain `cargo test -p wgpu_renderer` picks them up in QA's runs).

**WASM rebuild + copy (frontend can't see Rust changes until this runs):**
```
# inspect first, it has the exact wasm-bindgen invocation + copy destination:
dashboard/papps/frontends/build_wgpu_renderer.py
```
It does: `cargo build --release --target wasm32-unknown-unknown` → `wasm-bindgen --target web` (pin
0.2.108, matches Cargo.toml) → copies `wgpu_renderer.js/.d.ts/_bg.wasm(.d.ts)` into
`dashboard/papps/frontends/src/library/components/wasm/wgpu_renderer/`.

**Frontend typecheck / run (node_modules junctioned from dev-2):**
```
cd dashboard/papps/frontends
npx tsc -b                                          # typecheck (needs the generated wasm bindings to exist)
VITE_MY_APP=simple_wgpu_canvas_app npm run dev      # run the test app (index.html uses %VITE_MY_APP%)
```
`simple_wgpu_canvas_app` (dashboard/papps/frontends/src/simple_wgpu_canvas_app/) is the test bed — 4
WgpuCanvas panels. To see extreme markers, its initialConfig display needs `show_extreme_points: true`
(20745 branch); markers only render when a scalar field is loaded.

---

## 6. What each branch contains (so you can extend/fix intelligently)

### AKS-20746 — visibility (`28d96af795`)
- **Renderer:** `is_empty()` on shaded + translucent stages (render_bundle kept only when the stage has
  geometry, so layer presence is truthful); `LayerPresence` + `WgpuRenderer::layer_presence()`;
  a one-pass `log::warn!` in `update_render_list` for any RenderStage the renderer doesn't handle
  (Flat/Ghost/Highlight/Selection/Pick are silently dropped otherwise); `DisplayConfig.show_extreme_points`
  (applied in AKS-20745).
- **WASM:** `set_on_layers` export + `fire_layers_callback` firing `on_layers_changed` on initial load
  and field reload with `{ scalar_field, shaded, translucent, field_name }` (mirror of `set_on_bounds`).
- **Frontend:** `VisibilityPanel.tsx` — adaptive "Layers" box. Large widget = an eye-toggle TREE
  (Overlays group with a toggle-all parent, indeterminate state); small widget = an eye `IconEye` button
  opening the overlays as Mantine switches in a Popover; collapse threshold = the colorbar's
  `colorBarLayout.is_text_visible`. Data stages show a read-only Model/Solution status; color-bar +
  extreme-point toggles appear only when a scalar field is loaded. Zustand `layerPresence` slice.
  `visibilityStore.ts` = pluggable persistence for the overlay toggles (localStorage default), wired into
  WgpuCanvas (load-merge over initialConfig + debounced save).
- **Note:** the popover list is Mantine-portaled, so its SCSS status-dot rule is scoped-out (harmless
  ~13-line dup left intentionally). The collapsed trigger is a native `.canvas-btn` button, NOT
  CircularButton, because Popover.Target needs a ref-forwarding element (CircularButton lacks forwardRef).

### AKS-20745 — extreme points (`6b92ac77cf`)
- **Dedicated layer:** `custom_layer/extreme_point_stage.rs` `ExtremePointStage` (composes `SensorStage`;
  room for a distinct glyph later — user wanted a dedicated module, not a bare SensorStage instance).
- **RenderList:** two caches — a per-item geometry cache built once in `new` (the `ArrayBundle` CPU
  vertices are dropped at construction, so they MUST be cached there) + the current un-padded scalar
  floats refreshed on reload. `compute_extremes(bounds)` range-filters to `[lo,hi]` (D2), maps the winning
  values to model-space positions. `scalar_field_bounds` is derived from the same cached floats.
- **Color:** `Globals::color_for_value` ports the scalar-field WGSL bin logic to the CPU so a marker
  matches the surface colour at its value.
- **graphics_window:** `rebuild_extreme_markers` builds Max/Min markers (or one on a tie) with `{:.3}`+unit
  labels (value scaled by unit_scale). A `last_extreme_bounds` dirty-check keeps the recompute off the
  per-frame path but still fires on field reload, bounds change, and colorbar bins/reverse change.
- **Marker look (final, per user):** inner sphere + transparent CONTRASTING glow (NOT an opaque ring).
  `SensorData.outline_color: Option<Vec4>` tints the outer glow; sensors (None) glow in their own colour.
  The label uses the sensor-style offset (no leader line — user decided the offset is enough).
- **Gate:** `DisplayConfig.show_extreme_points` flag AND markers present.
- **Config TODOs:** `// TODO (config consolidation, next ticket)` notes were left on the hardcoded
  SensorManager consts + `contrast_outline` — those are AKS-20774's job to pull out.

### AKS-20774 — config consolidation (`67b6253168`)
- **Additive config fields** (every one is `Option<T>` defaulting to the old constant → absent config =
  byte-identical to before): `display.label_font_size` (sensor + colorbar labels, NOT triad);
  `triad_config.scale` (one knob for the whole triad, applied as a model-space scale so render AND
  picking stay aligned); `sensors { pixel_radius, inner_ratio, glow_alpha }`; `color_bar.bar_height_px`,
  `color_bar.bar_width_px`. Wiring pattern per field: `renderer_config.rs` Option field → `apply_config`
  arm in graphics_window.rs → stage instance field (default = old const) + setter.
- **UI:** `SettingsPanel.tsx` gained Display / Triad / Sensors sections + colorbar size sliders (reusing
  the existing `BoundSlider` + `updateConfig` pattern).
- **Persistence:** new standalone `configStore.ts` `ConfigStore` — FULL tunable-config persistence
  (`{ color_bar, display, triad_config, sensors }`), localStorage default, per-user backend adapter later.
  This is a SEPARATE concern from 20746's view-only `VisibilityStore` (user's explicit distinction:
  ConfigStore = full control of settings; VisibilityStore = just toggling what's shown).

---

## 7. Leftovers / open items (what's NOT done)

- **Not pushed, not reviewed.** The human reviews manually. Don't push/MR unless asked.
- **WASM artifacts are stale** on the branches where Rust changed after the last `build_wgpu_renderer.py`
  run (they're gitignored). Rebuild before any live run.
- **AKS-20774 deferred (MEDIUM) items** for a follow-up pass: sensor colour map, triad axis/torus colours
  (keep aligned with `colors.py`), colorbar text colour + tick format, sensor label offsets, colorbar
  top_offset. Background colour was in the plan but the user DROPPED it from the first set — do not add
  it unless asked. Full ranked list: `config-consolidation-wt/.agent/_workspace/01_explorer_config_audit.md`.
- **Merge overlaps to reconcile when these hit master** (all three touch shared files additively):
  - `DisplayConfig.show_extreme_points` exists in BOTH 20746 and 20745 (Rust + TS) → conflict; keep both,
    mark with `// AKS-<id>`.
  - `ConfigStore` (20774) vs `VisibilityStore` (20746) — separate files, fine, but WgpuCanvas wiring for
    both will need merging.
  - Sensor/triad hardcodes: 20745 left `TODO(config)` markers, 20774 pulls them out → reconcile.
  - Whoever merges second resolves; keep everything additive.
- **Mesh artifact / duplicate vertex+face cleanup** is explicitly OUT OF SCOPE for all of this — the user
  has a separate plan for it. Do not touch it.

---

## 8. Workspace docs (per worktree, under `.agent/_workspace/`)

- `BRANCH_MAP.md` — LIVE source of truth: branch model, worktree map, file ownership, review flow,
  status log. **Update it on every branch/worktree/commit change, then copy to all worktrees:**
  `for wt in AKS-20746-wt AKS-20745-wt config-consolidation-wt; do cp akselos-dev-2/.agent/_workspace/BRANCH_MAP.md $wt/.agent/_workspace/BRANCH_MAP.md; done`
- `plan_visibility.md` (AKS-20746), `plan_extreme_point.md` (AKS-20745),
  `plan_config_consolidation.md` (AKS-20774) — the plans.
- `01_explorer_*` / `02_systems_*` / `03_web_*` / `04_qa_*` — per-ticket audit/impl/QA notes.
- The older `HANDOFF.md` predates the config ticket; THIS file (`HANDOFF_NEXT.md`) is current.

---

## 9. Optional: multi-agent execution

There is a `wgpu_orchestrator` skill + agent team under `.agent/` (wgpu-explorer / wgpu-systems /
wgpu-web / wgpu-qa, all model opus). Pattern used successfully this session: explorer maps/audits →
systems does Rust → web does TS+UI → qa builds (native+wasm32) + boundary-cross-checks + rebuilds wasm.
Not required — a single capable agent can do it inline. If you fan out, agents must be told the exact
worktree path and to stay out of other worktrees + `scrbe/`.

---

## 10. Decisions already locked (do not re-litigate)

- Three branches independent off master (not stacked).
- Extreme point = dedicated custom_layer module; marker = inner sphere + transparent contrasting glow
  (no opaque ring, no leader line).
- Visibility box = adaptive: tree (large) / eye button + switches popover (small); eye icon.
- Config: additive Option fields, defaults = old consts; relational groups get ONE knob
  (triad.scale, shared label_font_size); MEDIUM colours/formats deferred; background colour dropped.
- ConfigStore (full config) is separate from VisibilityStore (view toggles).
- Commits: `AKS-xxxxx:` prefix, neat, NO co-author/AI trailer, one commit per branch, never commit
  `public/` or generated wasm.
- Comments: `// AKS-<id> (Tien):`, terse human voice, no AI-ish narration.
