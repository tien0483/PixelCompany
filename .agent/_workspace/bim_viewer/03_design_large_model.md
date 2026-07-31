# 03 — Design: rendering large models in `wgpu_renderer`

Revises the perf half of [01_explorer_wgpu_bim_gap.md](01_explorer_wgpu_bim_gap.md) §2 and [02_design_semantic_layer.md](02_design_semantic_layer.md) §4, after two claims were checked against wgpu 27 source. **Both corrections change the order of work.**

---

## 1. Correction 1: render bundles do not reduce draw-call cost on WebGL2

`wgpu-core-27.0.3/src/command/bundle.rs:983-999` — `RenderBundle::execute` iterates `self.base.commands` and **re-issues each recorded command into the HAL pass**. `render.rs:3004` `execute_bundle` is just that loop. There is no backend object that collapses a bundle into one driver submission on the GL backend.

So the three baked bundles (`shaded`, `scalar_field`, `translucent`) buy **wgpu-side validation and bookkeeping savings, not GL call savings**. Every `draw_indexed` still reaches the driver individually, every frame.

Consequence, and this is the important one: **the "bundles are immutable, so per-frame culling is structurally impossible" blocker from the audit is much weaker than it looked.** Dropping bundles for the model stages and encoding draws per frame *with frustum culling* costs the validation overhead the bundle was saving, and saves every culled draw. For any model where a meaningful fraction is off-screen, that trade is strongly positive. Culling moves from "hard, needs a bundle-rebuild strategy" to "straightforward".

## 2. Correction 2: instancing is NOT gated on WebGPU

[02_design_semantic_layer.md](02_design_semantic_layer.md) §4 claimed steps 5 and 17 were one decision. That is wrong, and this repo disproves it: `overlay_pass.rs:125` already uses `wgpu::VertexStepMode::Instance`, drawn at `:296` as `draw(0..6, 0..vertex_count)`, and it ships to browsers on WebGL2 today. WebGL2 has instanced arrays in core.

What is actually WebGPU-gated:
- **storage buffers in the vertex stage** — i.e. the "one big `ItemData` array indexed by `@builtin(instance_index)`" design. Not available under `downlevel_webgl2_defaults()`.
- **occlusion queries** — `occlusion_query_set` is unsupported on the GL backend.

Instancing on WebGL2 is therefore available *via per-instance vertex attributes*: put `model_from_local` (4 × `vec4`) + `color` (1 × `vec4`) in an instance-step vertex buffer instead of a per-item uniform. 5 attribute slots of the 16 WebGL2 guarantees, alongside position/normal/scalar. This replaces the one-uniform-buffer-and-bind-group-per-`ItemKey` design (`render_list.rs:486-537`) for the common case.

## 3. The real ceiling for large models is the load path, not the renderer

This is the part that bites first, and it is a hard wall rather than a slowdown.

Today, per `01_...gap.md` §2 step 13, one `spawn_local` (`web_app.rs:293-318`) does: avro parse → per-8-MiB `md5::compute` → `finalize_chunks` full-blob memcpy (`:715-720`) → `create_buffer_init` of the entire per-type blob (`render_list.rs:336`). Peak residency is **~3× the geometry size**: `unmerged_chunks` + the concatenated blob + the wgpu staging copy.

All of that lives in **wasm32 linear memory, which is capped at 4 GB** (and practically lower). So a 700 MB geometry export needs ~2.1 GB of wasm address space to *load*, before considering VRAM. That, not the WebGPU per-buffer limit, is the "2 GB problem" for this renderer — and the research doc's reassurance ("geometry lives in ArrayBuffers, not the JS heap") does not apply, because here it lives in wasm linear memory and is copied twice.

**The fix, and it is enabled by data the format already carries:** `array_descriptors` give the exact dtype and shape of every array up front (`render_list.rs:37-43`, `get_n_bytes` at `:95`). So the destination GPU buffer sizes and every array's offset are known *before any chunk arrives*. Therefore:

1. Parse the avro, compute the buffer layout, `device.create_buffer` each destination buffer empty (`COPY_DST | VERTEX/INDEX`).
2. As each 8 MiB chunk lands, `queue.write_buffer` it straight into the right offset — splitting the write where a chunk straddles a buffer boundary (chunk boundaries are at 8 MiB, buffer boundaries at `BufferType` transitions; they do not align).
3. Never build `unmerged_chunks`, never concatenate, never `create_buffer_init`.

Peak wasm memory becomes **one chunk (8 MiB)** instead of 3× the model. The freeze disappears because each chunk is a small unit of work. And it makes progressive rendering possible later (draw what has arrived) — `finalize_chunks`' all-or-nothing gate (`web_app.rs:705-713`) goes away.

Two cheap companions: drop or debug-gate the per-chunk MD5 (8 MiB of hashing per chunk on the main thread, over a channel HTTPS already integrity-checks), and fix the progress bar, which reaches 100 % before finalize+upload (`loadRenderData.util.ts:81-84`, `WgpuCanvas.tsx:268`) so the UI claims "done" precisely while the tab is locked.

## 4. Revised order for large models

| # | Work | Why here | Effort |
|---|---|---|---|
| 1 | **Benchmark harness** — draw calls, `RenderItem` count, frame-time 1 % lows, parse/upload ms, buffer bytes | Nothing below is falsifiable without it, and there are zero numbers today (`canvas_id_to_loading_progress` is written once, never read, `web_app.rs:43,281`) | S |
| 2 | **Streaming upload** (§3): pre-allocate from `array_descriptors` + `write_buffer` per chunk | Removes the 3×-geometry wasm ceiling *and* the load freeze. Biggest single win, and it is a memory-limit fix, not just a speed fix | M–L |
| 3 | **Free draw-call wins, no architecture change**: merge adjacent index ranges within a `(stage, ItemKey, vertices_id, indices_id)` group (their ranges are already contiguous in one buffer); hoist `set_vertex_buffer(1, …)` out of the per-item loop (`shaded_stage.rs:194-197`, `scalar_field_stage.rs:352-355`); swap the nested `HashMap`s (`render_list.rs:119-131`) for `BTreeMap` so draw order is deterministic — which also fixes the run-to-run-varying transparency order | Pure wins. The merge alone can collapse many draws to one | S–M |
| 4 | **Frustum culling, immediate-mode** — retain the per-element bboxes that `get_bounding_box_in_model` already computes and discards (`render_list.rs:751-767`), drop the model-stage bundles, encode with culling per frame | Unblocked by Correction 1; the bboxes are already being computed | M |
| 5 | **Instancing via instance-step attributes** (§2) for repeated bodies | Unblocked by Correction 2. Follows 3/4 because it changes the `ItemKey`/bind-group design | M–L |
| 6 | **Per-frame CPU cleanup**: the O(n²) `Vec::remove` label-merge fixpoint (`graphics_item.rs:690-711`), ~9 `Vec` + 3 `String` allocs (`wgpu_renderer.rs:880-901`), the per-frame `device.create_buffer` for label rects (`overlay_pass.rs:238-243`), and the ~2.7 KB `Globals` rebuilt and re-uploaded from unchanged inputs every frame (`graphics_window.rs:124-126`) | Label merge is O(n²) in label count — with many labels this can dominate a frame | S |
| 7 | **Server-side LOD chain** in `worker.py` + a detail tier on `RenderItem`, then screen-space-error selection | Correct order per the research: proxies are baked offline. Needs 1 to prove it pays | L |
| 8 | **Spatial tiling + eviction**, extending the existing chunk manifest (not 3D Tiles) | Largest item; only worth it once 2/4/7 are in | L |
| 9 | **WebGPU adapter with GL fallback** (`use_webgl = true`, `wgpu_renderer.rs:297`) | Now buys: occlusion queries, storage-buffer instancing, lower validation cost — no longer a prerequisite for 5 | M |

Deferred, unchanged: occlusion culling (needs 9), Draco (chunked+gzip likely enough), 3D Tiles/Cesium and three.js (§4 of doc 02 — would mean replacing this renderer).

## 5. Interaction with the semantic layer already built

The pick pass added in `src/pick_stage.rs` renders one extra `draw_indexed` per pickable face, but **only on a click**, never per frame — so it does not enter the frame budget. It will need updating alongside items 4 and 5 (it walks the same `render_map`, so culling/instancing changes apply to it identically), and its `pick_at` must become async before item 9, because `poll(Wait)` is a no-op on a real WebGPU device. Both are noted in the module's doc comments.
