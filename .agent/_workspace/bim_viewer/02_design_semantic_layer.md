# 02 — Design: unblock the semantic layer in `wgpu_renderer` (BIM viewer, phase 1)

Follows [01_explorer_wgpu_bim_gap.md](01_explorer_wgpu_bim_gap.md). Decision: **`wgpu_renderer` is the renderer**; the BIM plan is re-cut to fit it (§4).
WARP graph refreshed 2026-07-29 (`graphify update src` in WSL) — 423 nodes / 662 edges, ghosts purged.

---

## 1. The find: identity already exists, one layer up

The audit said "identity is destroyed by design". That is true **inside the Rust crate**, but the layer that *produces* its data already has a complete, battle-tested identity + GPU-id-picking design — used today by the OpenGL desktop renderer. The wgpu path inherits the producer and silently discards its identity output.

`tools/gl_graphics/render_list.py` is an abstract base with two implementations: `GlRenderList` (desktop OpenGL) and `RemoteRenderList` (the wgpu/web exporter). Everything below is in the **shared base**, i.e. it already runs on every wgpu export:

| Mechanism | Site | What it gives us |
|---|---|---|
| `graphics_face.pick_ref` | `tools/graphics_api/graphics_face.py:7-11` | the stable per-element identity, one per pickable face |
| `new_pick_color_association(ref, pick_color_map)` | `render_list.py:107-114` | allocates `idx` (random, 1..2²³), records `pick_color_map[idx] = ref`, returns `encode_padic(idx)` as an RGB colour |
| pick items are emitted into the render list | `render_list.py:163-169` | for every pickable face: a **second `RenderItem` in `PickRenderStage`** whose `color` *is* the encoded id |
| `pick_ref_map` | `render_list.py:105`, `:165-166` | `pick_ref → [(graphics_body, graphics_face, walk_data)]` |
| `add_selection_and_highlight_items(...)` | `render_list.py:200+` | emits `Highlight`/`SelectionRenderStage` items, `HIGHLIGHT_COLOR`/`SELECTION_COLOR` at `render_list.py:88-89` |
| hierarchy | `render_list.py:116-137` — the recursive `key_tuple` walk + `graphics_body_key_map[key_tuple]` | the Project→Group→Body→Face **tree**, already computed |
| attribute payload | `Pick.to_json(context)` — `tools/akselos/ui/pick.py:33-75` | ready-made JSON per element: `{'code':'Component','id':…}`, `{'code':'NamedGeom','component_id':…,'geom_name':…}`, ports, boundary conditions, solutions, stored selections… |
| readback+decode reference impl | `pick_info.py:61-88` (`decode_padic` `:7-12`), driven from `gl_renderer.py:676-679` | exactly the algorithm to port |
| serialize-the-map precedent | `gl_renderer.py:29-36` `write_out_pick_color_map()` → `pick_color_map.json` | precedent for shipping the id→ref map |

**So the Avro that the browser downloads today already contains a per-element id for every pickable face**, encoded as the `color` of a `PickRenderStage` item. Two things throw it away:

1. `wgpu_data_utils/worker.py:183` creates `pick_color_map = {}`, passes it to `RemoteRenderList.create` (which fills it in place, `remote_render_list.py:110-116`), and **never writes it out** — the `idx → pick_ref` mapping dies with the process.
2. The Rust crate declares `PickRenderStage` (`render_list.rs:16`) but no stage filters on it (`shaded_stage.rs:167`, `translucent_stage.rs:153`, `scalar_field_stage.rs:320`), so those items are accepted by `RenderList::new` (`:561-586`) and never drawn — silently.

**Cost of the pick items — CORRECTED, see [04_jira_journey_and_tickets.md](04_jira_journey_and_tickets.md) §3.** `_get_array_part_dict` (`remote_render_list.py:228-237`) resolves arrays through `remember_array` (`:118-128`), which dedups by `GraphicsArray` identity, so a pick item reuses its display twin's `vertices_id`/`indices_id`/`normals_id` **only when one `GraphicsBody` carries both `draw_pick` and `draw_regular`.** The common model path instead builds a *separate* pick tree with its own geometry (`graphics_trees/graphics_group_node.py:251`), which does add bytes; and solution graphics set `draw_pick=False` entirely, so an `.asl` export may contain **no pick items at all**. Making the export carry pick items is a blocking prerequisite (ticket S2 in doc 04), not a detail.

What does hold unconditionally: `ItemKey` (`render_list.rs:434-437`) cannot merge pick items, because their colours are unique by construction — the dedup that erases display identity *preserves* pick identity. And on the GPU each pick item costs only one 80-byte uniform + bind group.

Also note `pipelines.rs:410-435` (the orphaned, uncompiled file) already contains a `pick` pipeline with a dedicated `pick_color` target, `layout_pick`, and `bgl.pick` — someone started this port and stopped.

## 2. Design A (recommended): id-buffer picking, mirroring the desktop path

Zero wire-format change, zero change to the three model stages' shaders. Four small pieces.

### A1 — Server: ship the id map + the tree (Python)
In `wgpu_data_utils/worker.py:_generate_render_list_files` (`:168-217`), after `RemoteRenderList.create(...)` at `:192`:

```python
# AKS-<id> (Tien): export the pick id -> entity map so the browser can resolve picks.
context = self.app.context
pick_map = {
    idx: {"pick": ref.to_json(context) if hasattr(ref, "to_json") else {"code": type(ref).__name__}}
    for idx, ref in pick_color_map.items()
}
(output_dir / "pick_map.json").write_text(json.dumps(pick_map))
```
Precedent + the exact shape to follow: `gl_renderer.py:29-36`.

For the **semantic tree**, expose the walk keys the base class already builds. `RemoteRenderList` can record `key_tuple` alongside each pick allocation (the tuple is in scope at `render_list.py:127-135`; it currently reaches `graphics_body_key_map` at `:132` and is dropped by the remote impl). Emit `{"idx": ..., "path": ["layer0", "group_a", "body_7"], "pick": {...}}` into the same `pick_map.json`. That is plan step 2's tree, for free, from HUI's own hierarchy.

Non-obvious constraint: `pick_color_map` keys are **random per export** (`render_list.py:109-111`), so ids are *not* stable across re-exports. Fine for click-to-data within a session; if cross-session/persisted selection is ever needed, key the map on `pick_ref` content (e.g. `component_id`) instead — a separate, later change. Say so in the ticket rather than discovering it later.

### A2 — Rust: a `PickStage` that renders ids offscreen
New `src/pick_stage.rs`, modelled on `translucent_stage.rs` (same flat/colour-only vertex layout — pick items carry no normals and no scalars). Register on all 10 boundary points listed in `01_explorer_wgpu_bim_gap.md` §2 step 7 — **`lib.rs:6-30` is the one people forget; that omission is exactly why `pipelines.rs` is dead.**

- Filter `RenderStage::PickRenderStage` in `set_render_bundle`, bundle it once at load like the other three.
- Own offscreen colour target, **`Rgba8Unorm` + `COPY_SRC`**, plus its own depth texture, sized with the surface in `saved_framebuffer.rs:126-149`. Must be a separate attachment from the visible one — do not reuse the shaded target.
- Clear to `0,0,0,0`: `decode_padic` of black is `0`, which the desktop path already treats as "nothing hit" (`pick_info.py:82`).
- Render it **only on demand** (on a click), not per frame — an extra pass per click is free; per frame it would be ~30 % more draw calls.
- Shader: pass `item_data.color` straight to the fragment output, **no lighting, no alpha blend, no depth bias**, `cull_mode: Back`, depth `Less` with write enabled. Bias (`shaded_stage.rs:332-336`) would shift which element wins a pixel — do not copy it in.

### A3 — Rust: readback + decode
`copy_texture_to_buffer` the 1×1 texel under the cursor into a `MAP_READ | COPY_DST` buffer, `map_async`, decode base-256 exactly as `pick_info.py:7-12`:
```rust
let idx = rgb[0] as u32 + 256 * rgb[1] as u32 + 65536 * rgb[2] as u32;
```
Mind two traps: `bytes_per_row` must be padded to 256 (`COPY_BYTES_PER_ROW_ALIGNMENT`) even for one texel; and the texture is **not** sRGB — pick the surface's non-sRGB sibling (`wgpu_renderer.rs:366-371` already prefers non-sRGB) or the round-trip corrupts the low bits.

**Risk to spike first (30 min, decides A vs B):** buffer mapping and `copy_texture_to_buffer` on wgpu's **GL backend under WebGL2**. `downlevel_webgl2_defaults()` (`wgpu_renderer.rs:322`) is restrictive and wgpu emulates mapping there. If readback is unavailable, fall back to a `readPixels`-shaped path or go to Design B. Do not write A2–A4 before this spike passes.

### A4 — Rust→JS: the round trip that doesn't exist yet
Add to `web_app.rs` alongside the existing five callbacks (`:71-75`, setters `:92-120`):
- `set_on_pick(cb)` — fires `{element_id, x, y}`; JS resolves it against `pick_map.json`, which **JS fetches and owns** (keep the map out of wasm — it is host data, and this avoids a second copy in linear memory).
- `pick_at(canvas_id, x, y)` — or better, hook the existing left-button path. Left is currently reserved for the triad (`graphics_window.rs:242-264`); route "triad miss → scene pick" so the gizmo keeps priority.
- `set_selection(canvas_id, element_ids: Vec<u32>)` — inbound highlight.

### A5 — Selection highlight, client-side
Do **not** use the server's `add_selection_and_highlight_items` (`render_list.py:200+`) — it requires a re-export per click, which is fine on the desktop and absurd over HTTP.

The audit's "items aren't addressable" is only true of the baked bundle: `render_map` **retains** `Vec<RenderItem>` (`render_list.rs:127`, pushed at `:585`). So add one index in `RenderList::new`: `element_id → (RenderStage, ItemKey, vertices_id, indices_id, index_range)`, where `element_id` is `decode_padic(color)` for pick items. Then draw the selected element's index range immediate-mode with `SELECTION_COLOR` (0.86, 1.0, 0.15, 0.5 — `render_list.py:89`) in a small overlay stage, using `depth_compare: Always` like `sensor_stage.rs:124-132` so it reads as a highlight. No bundle rebuild, no re-fetch, no `HighlightRenderStage` revival needed.

### A6 — Query / aggregate / dashboards (plan steps 3–4, 16)
Pure host-side TS over `pick_map.json` — no renderer work. Visual feedback for a query result reuses two things that already exist:
- **filter → highlight**: `set_selection` with the matching ids (A4).
- **colour by property**: the scalar-field path already has a discrete `is_enumerating` branch (`scalar_field_stage.rs:53-70`). Write a per-vertex `<property>.bin` whose values are category indices, set `ColorBarConfig` bins, call the existing `update_scalar_field` (`web_app.rs:137`). **No shader work for categorical BIM colouring.**

## 3. Design B (fallback / later): `element_id` in `ItemData` + MRT

Add `element_id: u32` to `ItemData` (`wgpu_renderer.rs:229-234`) **and to `ItemKey`** (`render_list.rs:434-437`, or dedup will merge distinct elements again — this is the literal "identity destroyed" fix), add the field to the Avro `RenderItem` (`remote_render_list.py:62-78` + `render_list.rs:45-58`), and write it to a second colour attachment from the existing three stages.

- Pros: no extra pass, no duplicate `RenderItem`s, every drawn element is pickable (not just `should_draw(pick=True)` ones), and the id becomes available for future GPU work (compute-based culling).
- Cons: schema change on both sides, WGSL edits in three stages, MRT on the GL backend, and it makes the server's `PickRenderStage` items dead weight (they should then be filtered out at export).
- Choose B only if the A3 readback spike fails, or once the WebGPU migration (§4) lands.

## 4. The BIM plan, re-cut for this renderer

**Verdict on the stack:** keep the *ideas*, drop the *implementation stack*. web-ifc + three.js is a parallel renderer — adopting it means abandoning `wgpu_renderer`, not extending it. You cannot have both.

| Plan item | Fate | Why |
|---|---|---|
| 1 "render an IFC (web-ifc + three.js)" | **DROP as written → replace** with an **IFC → Avro importer**: IfcOpenShell/web-ifc server-side, emitting `graphics_api.GraphicsArray` + `pick_ref`s so the entire existing `RemoteRenderList` → chunk → wasm path is reused unchanged. IFC's own `GlobalId` becomes the `pick_ref`, which incidentally fixes the random-id instability in A1. | three.js is a *renderer*; we have one. web-ifc/IfcOpenShell are *parsers* — keep those. |
| 2 semantic tree + click-to-data | **DO NOW.** §2 — mostly wiring, all upstream pieces exist. | — |
| 3–4 query / dashboards | **DO NOW**, host-side TS + `set_selection` + the categorical colour path. | Zero renderer work. |
| 5 instancing | **BLOCKED on WebGPU.** Instancing at scale means per-instance `ItemData` in a **storage buffer indexed by instance** — WebGL2 downlevel limits have no vertex-stage storage buffers, and the current design is one uniform + one bind group per item (`render_list.rs:506-534`). | Steps 5 and 17 are the same decision, not two. |
| 6 frustum culling | **DO after §2.** Cheapest unlock in the codebase: `get_bounding_box_in_model` (`render_list.rs:747-776`) already computes a per-`(model_from_local_id, vertices_id)` box and **discards the map** at `:751`. Retain it → culling *and* pick broad-phase from one change. Then bundles must be rebuilt on camera change (or split per spatial cell) — that is the real work, not the maths. | — |
| 7 occlusion culling | **BLOCKED on WebGPU** — `occlusion_query_set` is unsupported on the GL backend (all 7 passes pass `None` today). | — |
| 8–9 LOD + SSE | Compatible, but **server-side first**: a decimated LOD chain per body in `worker.py`, extra `ArrayDescriptor`s + a detail tier on `RenderItem`. meshoptimizer operates on exactly the index/vertex arrays `GraphicsArray` already holds. | Plan's own conclusion: LOD is baked offline. |
| 10 server-side tessellation | **ALREADY DONE** — `helper_functions.py:20-80` + `worker.py:168-217`. | — |
| 11 streaming + LRU | **Extend the existing chunk manifest into spatial tiles**; do **not** adopt 3D Tiles / Cesium (a whole second format + runtime alongside Avro/`ArrayDescriptor`). Needs incremental `RenderList` + bundle rebuild + eviction — the largest item on the list. | `finalize_chunks` (`web_app.rs:705-713`) currently demands every chunk before anything renders. |
| 12 RTC / f64 | **Downgrade, and solve at import.** Ortho projection + per-frame shrink-wrapped near/far (`transformations.rs:25-26`) already blunt the classic jitter, and HUI geometry is component-local with a `model_from_local`. For IFC with survey offsets, subtract a global origin **in the importer** — that is RTC, at zero renderer cost. Only if that proves insufficient: eye-relative vertices (not f64 — `Dtype` can't express it, `render_list.rs:27-32`). | — |
| 13 decoupled loader | **DO — highest-value non-semantic item.** Today avro parse + per-8-MiB MD5 + full memcpy + whole-blob `create_buffer_init` run in one `spawn_local` (`web_app.rs:293-318`): the tab freezes and the progress bar reads 100 % while it does (`loadRenderData.util.ts:81-84`). Move decode to a Worker, slice uploads into budgeted `write_buffer` calls. | The research calls this the one rule and the one painful retrofit. |
| 14 local cache | Cheap win, unchanged from plan: OPFS/IndexedDB in the JS loader, plus caching scalar-field buffers (the TODO at `render_list.rs:663-667`). | — |
| 15 benchmark harness | **Pull earlier — do it before 5/6/7.** No numbers exist today (`canvas_id_to_loading_progress` is written once and never read, `web_app.rs:43,281`). Without it, "instancing helped" is unfalsifiable. | — |
| 16 NL query | Unchanged, host-side, after 3. | — |
| 17 WebGPU | **Not a flag flip, not a rewrite.** `let use_webgl = true;` is a hardcoded local (`wgpu_renderer.rs:297-306`) → `Backends::GL` + `downlevel_webgl2_defaults()`; the `webgl` feature is unconditional (`Cargo.toml:14`). Right move: **try a WebGPU adapter, fall back to GL**, and gate 5/7 behind it. The GL-shaped buffer split (`render_list.rs:174-182`) stays valid on WebGPU, just unnecessary. | wgpu is the abstraction — this is why the crate is the right base. |
| stack: xeokit | Reference reading only, not a dependency. | — |
| stack: Draco | Defer. Chunked + gzip transport is likely enough; a wasm decoder in the loader is a later optimisation. meshoptimizer (for 8–9) stays. | — |

**Order:** benchmark harness (15) → semantic layer (§2: 2, 3, 4) → decoupled loader (13) → frustum culling + retained bboxes (6) → WebGPU adapter fallback (17) → instancing (5) → LOD (8, 9) → streaming/eviction (11).

## 5. Open questions for the user (per orchestrator's ~20 % milestone gate)

1. **Design A or B?** A is recommended and gated on the A3 readback spike. Say the word and I run the spike first.
2. **Do the ids need to survive a re-export?** If yes, A1 keys the map on `pick_ref` content instead of the random idx — decide now, it is cheap now and invasive later.
3. **Is the IFC path real, or is this a HUI-model viewer?** §4 row 1 (an IFC → Avro importer) is a substantial piece of work; everything else in §2 is useful either way.
4. Ticket number for the `AKS-<id> (Tien): …` comment convention.
