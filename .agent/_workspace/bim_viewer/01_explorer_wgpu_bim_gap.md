# 01 — Explorer: `tools/wgpu_renderer` vs. Web-BIM-Viewer plan (gap map)

Produced by the `wgpu_orchestrator` team pattern (3 × `wgpu-explorer`, read-only) on 2026-07-29.
Inputs: `BIM_VIEWER_PLAN.csv`, `SUMMARY.md`, `MISCONCEPTIONS_AND_FAQ.md` (copies in this folder).
Target: `E:\akselos-dev-3.10\akselos-dev-2\tools\wgpu_renderer` (Rust + wgpu 27 + WGSL, native + wasm32).
All `file:line` are relative to that crate unless prefixed.

---

## 0. WARP graph drift (graphify-out is stale)

`src/graphify-out/GRAPH_REPORT.md` is dated **2026-05-19**; `src/` was modified through **2026-07-15**. Verified drift — trust source, not the graph:

| Graph claims | Reality |
|---|---|
| `GizmoStage` is a god node | Gone. `src/custom_layer/` holds only `mod.rs` + `sensor_stage.rs`. |
| `VisibilityConfig` in the config community | Gone. `renderer_config.rs:1-45` has `WgpuRendererConfig`, `ColorBarConfig`, `TriadConfig`, `TriadLabels`, `DisplayConfig`. |
| `read_render_groups() → fetch_bytes()` ("surprising connection") | `read_render_groups` deleted; replaced by `RenderDataLoader::new` (`src/web_app.rs:628`) fed bytes from JS. |
| `pipelines.rs` (`BGL`/`PipelineSet`/`PipelineFormats`/`ShaderModules`) is live architecture | **Orphaned file.** Not declared in `lib.rs:6-30`, referenced by nothing. Contains a *complete* pick pipeline (`pipelines.rs:410-435`) + highlight/selection blend pipelines (`:386-408`) that are never compiled. |
| `brute_transform_bounding_box`, `combine_boxes` are API | `#[cfg(test)]` items (`bounding_box.rs:94-107`, `:214`). |

→ **Re-run `/update_warp` on `tools/wgpu_renderer/src` before relying on the graph again.**

## 1. What the crate actually is

A **FEA result viewer**, not a scene graph. Server pre-tessellates in Python (headless HUI Modeler under Xvfb — `wgpu_data_utils/helper_functions.py:20-80`, `worker.py:21-217`) into Avro descriptor + raw f32/u16/u32 binary blobs (`tools/gl_graphics/remote_render_list.py:13-98` ↔ `src/render_list.rs:37-73`), chunked to 8 MiB `.partNNN` + MD5 (`worker.py:242-285`). Browser fetches chunks 6-way parallel (`loadRenderData.util.ts:100`), pushes them into wasm (`web_app.rs:686`), concatenates, and creates ~3 big GPU buffers (VERTEX / INDEX / scalar) via `create_buffer_init` (`render_list.rs:320-346`). Draw = one `draw_indexed(.., 0..1)` per `RenderItem`, baked once into immutable render bundles.

So: **the "server pre-tessellation + streamable chunk" half of the BIM plan already exists.** The "queryable semantic model" half does not exist at all, and the "loading LESS" half (culling/LOD/eviction) does not exist at all.

## 2. Capability audit against the plan (CSV step → status)

| Plan step | Status in `wgpu_renderer` | Anchor |
|---|---|---|
| 1 Render in browser | **PRESENT** (WebGL2, see §3) | `web_app.rs:742-759`, `wgpu_renderer.rs:297-322` |
| 2 Semantic tree + click-to-data | **ABSENT — biggest gap.** `GraphicsItem` is a zero-sized geometry-factory namespace (`graphics_item.rs:75`). `RenderItem` carries only *array* ids (`render_list.rs:45-58`); `ItemKey` deliberately **merges** items sharing (transform-id, colour) to dedupe bind groups (`render_list.rs:432-457`) — identity is destroyed by design. No parent/child anywhere; `RenderMap`'s 4-level nesting is draw-bucketing (`render_list.rs:115-131`). | — |
| 3 Query/filter/aggregate | ABSENT. No name→item or id→item lookup on `RenderList` (`render_list.rs:133-143`); after bundling, items aren't addressable at draw time (`shaded_stage.rs:190-206`). | — |
| 4 Dashboards/schedules | ABSENT (host-side concern; only `on_layout`/`on_bounds` callbacks exist, `web_app.rs:71-75`). | — |
| 5 Instancing + merging | **PARTIAL.** Geometry *is* merged into shared per-`BufferType` buffers (`render_list.rs:172-249`) and bind groups deduped (`:486-534`), but **zero 3D instancing** — every `draw_indexed` is `0..1` (`shaded_stage.rs:200`, `scalar_field_stage.rs:358`, `translucent_stage.rs:182`, `sensor_stage.rs:351`, `triad_stage.rs:607`). Only 2D label rects instance (`overlay_pass.rs:125,296`). Draw ranges of adjacent items sharing pipeline+buffers are never merged, and `set_vertex_buffer(1, ..)` is re-issued *inside* the per-item loop (`shaded_stage.rs:194-197`). | — |
| 6 Frustum culling | ABSENT. No plane rejection; bundles are immutable + camera-independent so per-frame culling is structurally impossible without rebuilding them (`wgpu_renderer.rs:738-774`, only caller `graphics_window.rs:44` = once at load). `RenderItem.should_clip` and `.primitive_size` are deserialized and never read (`render_list.rs:53-54`). | — |
| 7 Occlusion culling | ABSENT. `occlusion_query_set: None` in all 7 passes; no depth pre-pass — `shaded_stage.rs:133` in fact **clears depth mid-frame**. | — |
| 8 LOD chain / proxies | ABSENT. No LOD/decimation/SSE/mip; `RenderItem` has one index range, no tier; sphere/cone segment counts are compile-time consts (`sensor_stage.rs:16`). | — |
| 9 SSE LOD selection | ABSENT. Only screen-size *transform* scaling for sensors/triad (`sensor_stage.rs:181-233`, `triad_stage.rs:256-320`). | — |
| 10 Server-side tessellation | **PRESENT — reusable as-is.** | `worker.py:168-217`, `remote_render_list.py:130-195` |
| 11 Spatial streaming + LRU | **PARTIAL/ABSENT.** Chunking is a *parallel-download* trick, not streaming: `finalize_chunks` hard-fails unless every chunk landed (`web_app.rs:705-713`), nothing renders before the last byte. No tiles/octree — one global bbox (`render_list.rs:141`). `id_to_buffer` is insert-only (`:341`, `:697`); the only free is dropping a whole window (`web_app.rs:328`). | — |
| 12 RTC / double precision | ABSENT. f32 everywhere: `Vertex.xyz:[f32;3]` (`graphics_item.rs:61`), `Transformation{Quat,Vec3,f32}` (`point.rs:4-9`); `Dtype` can't even express f64 (`render_list.rs:27-32`) and `validate_arrays` rejects non-Float32 vertices (`:617-623`). Precision sink is the collapsed MVP `ndc_from_model = ndc_from_eye * eye_from_model` (`graphics_window.rs:89`) uploaded as one f32 `Mat4`. Jitter also enters via large `ItemData.model_from_local` translations (`wgpu_renderer.rs:232`) and accumulates in `CameraInfos` mul/inverse chains (`camera_infos.rs:51,105,134`, `point.rs:144-155`). Ortho + linear depth (`transformations.rs:40-62`) softens it; near/far shrink-wrap the *whole model* (`transformations.rs:25-26`) so depth resolution scales with global model size. | — |
| 13 Decoupled loader (workers + budgeted upload) | **ABSENT — second biggest gap.** No Web Worker anywhere; `Cargo.toml:24-27` doesn't even expose `Worker` to Rust. Avro parse (`web_app.rs:634-639`), per-8-MiB `md5::compute` (`:688`), full-blob memcpy (`:715-720`) and `create_buffer_init` of the entire blob (`render_list.rs:336`) all run in **one `spawn_local` microtask** (`web_app.rs:293-318`) → render loop *and* all DOM input frozen for its duration; peak RAM ≈ 3× geometry. Geometry never uses `queue.write_buffer` (that's uniforms only). Progress hits 100 % *before* finalize+upload (`loadRenderData.util.ts:81-84`, `WgpuCanvas.tsx:268`) so the UI says "done" exactly while the tab is locked. The pre-first-frame input gate is vacuous — `has_rendered` is initialised `true` and never reassigned (`wgpu_renderer.rs:526`, `graphics_window.rs:58-60`, gate at `web_app.rs:557-568`). | — |
| 14 Local cache | ABSENT. No IndexedDB/OPFS/CacheStorage; scalar fields explicitly not cached (`render_list.rs:663-667`) — every field switch re-fetches + rebuilds the buffer + re-bundles (`web_app.rs:472`, `graphics_window.rs:444-457`). | — |
| 15 Benchmark harness | ABSENT. `canvas_id_to_loading_progress` is written once and never read (`web_app.rs:43,281`). | — |
| 16 NL/LLM query | ABSENT (needs step 3 first). | — |
| 17 Prefer WebGPU | **ABSENT / actively opposed.** `let use_webgl = true;` is a **hardcoded local, not a cfg** (`wgpu_renderer.rs:297-306`) → `Backends::GL`, limits clamped to `downlevel_webgl2_defaults()` (`:322`), features `empty()` (`:328`); the `webgl` wgpu feature is unconditional (`Cargo.toml:14`). Web runs **WebGL2**, native is forced onto GL too, and the true-WebGPU branches (`:305`, `:336-345`) are dead. This also *causes* the buffer split — mixing vertex+index in one buffer is illegal on GL (`render_list.rs:174-182`). | — |

## 3. Cross-cutting hazards found

- **Depth ordering is broken by pass order.** Translucent draws *before* opaque with `depth_write_enabled:false` (`translucent_stage.rs:313`), then the shaded pass **clears depth** (`shaded_stage.rs:130-136`), so shaded geometry never depth-tests against scalar-field/translucent output. No back-to-front sort, no OIT; intra-bundle draw order follows `HashMap` iteration (`render_list.rs:119`) → **nondeterministic across runs**.
- **Per-frame CPU churn:** ~9 `Vec` + 3 `String` allocations (`wgpu_renderer.rs:880-901`, `triad_stage.rs:713`), a full `device.create_buffer` for label rects (`overlay_pass.rs:238-243`), an O(n²) `Vec::remove` label-merge fixpoint (`graphics_item.rs:690-711`), and a ~2.7 KB `Globals` rebuilt + re-uploaded from unchanged inputs every frame (`graphics_window.rs:124-126` → `wgpu_renderer.rs:709`).
- **Silent drops:** 5 of 8 `RenderStage` variants (`Flat`, `Ghost`, `Highlight`, `Selection`, `Pick` — `render_list.rs:10-16`) are accepted by `RenderList::new` and never drawn, no warning.
- **Panic traps:** `_get_buffer_slice` unwraps (`render_list.rs:842`) so a `ShadedRenderStage` item with `normals_id == -1` panics even though `validate_arrays` permits it (`:620`); `scalar_field_stage.rs:350` asserts `scalar_values_id > 0`.
- **Single-slot loader race:** `SHARED_RENDER_LOADER` (`web_app.rs:731-733`) is `take()`n with `.expect` (`:747-750`); two canvases loading concurrently clobber it — JS holds it together by a comment-enforced "no await between attach and start" rule (`WgpuRenderer.tsx:47-51`).
- **Stale generated bindings:** `pkg/wgpu_renderer.d.ts` (Jun 10) is an orphaned build exporting 4 functions that no longer exist (`:8,10,16,17`) and missing `RenderDataLoader`; the deployed copy under `dashboard/papps/frontends/src/library/components/wasm/wgpu_renderer/` still exports `set_on_layers`. `tools/wgpu_renderer/README.md` is stale (wrong out-dir `pkg/`, missing `library/` path segment) — the real build is `dashboard/papps/frontends/build_wgpu_renderer.py`. `TARGET_VERSION_FILE` is declared (`:18`) and never written, so the deployed wasm's source revision is unknowable.

## 4. What is genuinely reusable for a BIM viewer

1. **Server-side pre-tessellation + chunk/manifest/MD5 pipeline** (Python side) — matches plan step 10 and half of 11.
2. **Coalesced per-`BufferType` buffers + `ItemKey` bind-group dedup** (`render_list.rs:154-537`) — a working batching substrate; needs draw-range merging + instancing on top.
3. **Attribute → colour path, fully working end-to-end** (`scalar_field_stage.rs:123-137` per-vertex `ScalarValue`; LUT in `Globals` `wgpu_renderer.rs:99-110`; hot-swap `render_list.rs:662-703` ← `web_app.rs:137`). Critically, the shader already has a **discrete/`is_enumerating` categorical branch** (`scalar_field_stage.rs:53-70`) that snaps to nearest bin — i.e. colouring by a BIM *category* (material / discipline / system / status) needs **no shader work**, only a value↔category encoding on the host.
4. **`ColorBar` legend + React layout mirroring** (`color_bar.rs:385-424` → `web_app.rs:202-217`).
5. **`BoundingBox` + `transform`/`mutate_combine`/`center`/`diameter`** (`bounding_box.rs:3-75`). Note `get_bounding_box_in_model` already computes a per-`(model_from_local_id, vertices_id)` box and **throws the map away** (`render_list.rs:751-767`) — retaining it is the single cheapest step toward frustum culling *and* broad-phase scene picking.
6. **Complete CPU raycast library** (`pick_utils.rs:2-220`: cylinder/torus/quad/segment/aabb) — currently used only by the triad widget (`triad_stage.rs:355-418`); `ray_quad`/`ray_segment` have no callers. No `BoundingBox → ray_aabb` bridge exists yet (one small fn).
7. **Orphaned `pipelines.rs`** — a ready-made design for id-buffer picking (`:410-435`, dedicated `pick_color` target + `layout_pick` + `bgl.pick`) and highlight/selection blend pipelines (`:386-408`). Worth mining rather than deleting.
8. **`update_sensors_json`** (`web_app.rs:158-161`) — the existing pattern for "host pushes tagged markers into the scene"; a template for a BIM-id → marker bridge (but it replaces the whole set, no per-id addressing).

## 5. Recommended order (adapts the CSV to this crate)

1. **Identity first, before anything else.** Add a stable `element_id` to `RenderItem` (`render_list.rs:45`) + the Avro schema (`remote_render_list.py:13-98`), and stop letting `ItemKey` erase it. Everything in plan phases 1/2/3/5 depends on this.
2. **Retain per-element bboxes** (`render_list.rs:751`) → unlocks frustum culling *and* picking broad-phase from one change.
3. **Picking + `on_pick` callback:** bridge `BoundingBox → ray_aabb`, add a `pick_at(x,y)` wasm export next to the existing setters (`web_app.rs:34-171`), fire an `on_pick(element_id)` callback alongside `on_layout`/`on_bounds` (`:71-75`). Then `select_by_id` inbound + revive `HighlightRenderStage` using `pipelines.rs:386-408`.
4. **Un-freeze the loader** (plan step 13): move avro parse + MD5 + merge off the main thread, and split `create_buffer_init` into budgeted `queue.write_buffer` slices. This is the "two worlds on two clocks" rule from `SUMMARY.md` §6 and the one item the research flags as painful to retrofit — it is currently 100 % un-implemented.
5. **Decide WebGL2 vs WebGPU deliberately** (`wgpu_renderer.rs:297`). The plan says WebGPU (draw-call overhead is the BIM bottleneck); the crate hardcodes GL and its buffer layout is shaped by GL's restrictions. This is a fork in the road, not a flag flip.
6. Then instancing + draw-range merging → frustum culling → LOD/proxies (needs a new server-side LOD chain in `worker.py`) → eviction.

## 6. Refusals / limits

- `scrbe/` not touched (proprietary, per `wgpu_orchestrator` SKILL.md).
- Nothing was edited; this is a read-only map.
