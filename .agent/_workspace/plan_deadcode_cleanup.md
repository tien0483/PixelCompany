# Plan C — Dead-code audit & cleanup (wgpu_renderer)

## Goal
Remove genuinely dead code from the `wgpu_renderer` crate **without** deleting code that only *looks* dead. Output is a tiered report; only Tier-1 (provably unreferenced across every boundary) is deleted. Everything else is documented or left.

## The cardinal rule — cross-boundary before delete
A symbol unused *within Rust* can still be live across a boundary cargo cannot see. **Before declaring anything dead, grep it in all of:**
1. **JS bindings** — `build/wgpu_renderer.js` + `build/wgpu_renderer.d.ts` (and `pkg/`).
2. **Dashboard TS** — `dashboard/papps/frontends/src/**` (WgpuCanvas + per-dashboard wiring).
3. **Python exporter** — `tools/gl_graphics/{render_list,remote_render_list}.py`, `tools/wgpu_renderer/wgpu_data_utils/*.py`.
4. **Attributes** — `#[wasm_bindgen]` (FFI-live), `serde::Deserialize` (data-API-live).

If referenced in any → **not dead**. wasm-bindgen exports (40 in web_app.rs) and serde-deserialized structs/enums are the classic false positives.

## Method
1. Build and collect compiler signal:
   - `cargo build -p wgpu_renderer` and `--target wasm32-unknown-unknown` — capture `dead_code` / `unused_*` warnings. (Note: `pub` items in the lib crate do **not** warn even when unused — they need manual grep.)
   - Optional: `cargo +nightly udeps` for unused deps.
2. For each candidate, run the 4-boundary grep above → classify into the tiers below.
3. Delete Tier-1 only. Document Tier-2. Open issues for Tier-3.
4. QA after each deletion (build native+wasm, clippy, tests).

## Tiers (seeded from this session's findings)

### Tier 1 — safe to remove (verify no boundary ref first)
- **Commented-out shader logic** in `scalar_field_stage.rs` — `/* should_clip … */` and `/* min/max color … */` blocks ([:33](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L33), [:42](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L42)), and the comment block at [:314](../../tools/wgpu_renderer/src/scalar_field_stage.rs#L314). Dead commented code — confirm not a deliberate toggle-stub before removing.
- **Stale log files** in crate root: `build_error.log`, `build_error_utf8.log`, `error.log`. Not code — delete + ensure gitignored.
- Any private (non-`pub`) fn/field that cargo flags `dead_code` **and** has zero grep hits.

### Tier 2 — looks dead, is NOT — document, do not delete
- **TranslucentRenderStage** — dormant, fed only when HUI exports alpha<1 ([render_list.py:153](../../tools/gl_graphics/render_list.py#L153)). Live code path; deleting breaks transparency exports. Keep; add a one-line comment noting it is HUI-alpha-driven.
- **RenderStage variants Flat/Ghost/Highlight/Selection/Pick** ([render_list.rs:8](../../tools/wgpu_renderer/src/render_list.rs#L8)) — never matched by any `set_render_bundle`, but `serde::Deserialize`. Removing a variant breaks deserialization of any render_group containing it. Keep the variants; instead **log unhandled stages** (shared with Plan A) so the silent drop is visible.
- **`pick_utils::ray_segment` + `ray_quad`** — unused `pub fn`, forward-looking (`ray_segment` is the line-pick primitive). Keep; reference them from the future pick plan.
- **All `#[wasm_bindgen]` exports** in `web_app.rs` (40) — the JS API. Never judge by cargo. Cross-check `.d.ts` + dashboard TS instead.
- **Native fs helpers** `binary_utils::{read_binary_file, merge_binary_files}` — used by the native (`main.rs`) path, not wasm. Keep unless the native entry is itself retired.

### Tier 3 — investigate (decide after the boundary grep)
- `graphify-out/` committed under `src/` — generated WARP artifact (cache + graph.json/html). Not dead code but source-tree clutter; confirm nothing imports it, then **gitignore / move out of `src/`** rather than treating as code.
- `point.rs`, any stage helper, config fields flagged by cargo — run the 4-boundary grep each; promote to T1 only if clean.
- Duplicated render-pipeline construction across stages (line/point/tri variants) — possible *consolidation* (not deletion); separate refactor, out of this audit's delete scope.

## Files (likely touched)
- `tools/wgpu_renderer/src/scalar_field_stage.rs` — strip commented blocks (T1).
- crate root — remove stale `*.log` (T1) + `.gitignore`.
- `tools/wgpu_renderer/src/render_list.rs`, `wgpu_renderer.rs` — comments + unhandled-stage log (T2, shared with Plan A).
- `.gitignore` / repo layout — `graphify-out/` (T3).

## QA (wgpu-qa)
- After each removal: `cargo build` native + `wasm32-unknown-unknown`; `clippy -D warnings`; geometry/math unit tests.
- Boundary: confirm no JS binding (`.d.ts`) or dashboard TS symbol vanished; confirm serde still deserializes a render_group that includes a non-rendered stage (Flat etc.).
- Reproduce-before-report: any "dead" claim must cite the 4-boundary grep result.

## Explicit non-goals
- No removing wasm-bindgen exports on cargo's word.
- No removing serde enum variants / config fields.
- No deleting TranslucentRenderStage.
- No behavior change — pure dead-code/clutter removal. Refactors/consolidation are separate.
