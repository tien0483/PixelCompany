# 04 — AKS-18576 journey, AKS-18641 review, and the tickets to create

Read 2026-07-29 from Jira: epic **AKS-18576 "3D widget for Papps"** (all 34 children) and **AKS-18641 "Implement object picking (single pixel only)"** (all 4 comments). Revises [02_design_semantic_layer.md](02_design_semantic_layer.md) §1 — see §3, which is a correction to my own claim.

---

## 1. The journey (AKS-18576, 34 children)

Epic itself is still `TODO`, label `Papp`, reporter Trong Luong, opened 2025-10-31.

**Done (27):** foundation by Brian Sabbey (AKS-17772) → export script (18636) → fit-to-screen (18637) → color bar (18638, 19365, 20017) → shaded stage (18639) → triad (18640) → sensors (18932, 18933, 19224, 19225) → split geometry/field files (19130) → chunking (19283) → parallel chunk download (20016) → align view (19223) → TS user controls (19226) → deploy to Papp dashboards (19229, 19250, 20061) → CI build (19260) → solution-field UI (19457) → config refinement (20190) → error fixes (20110).

**In review (2):** AKS-19366 static clip plane, AKS-19367 unit tests for the 3D widget.

**On-hold (3):** AKS-18579 explore use cases, **AKS-18641 picking**, AKS-19262 minimize `array_data.bin` size.

**Open TODO (3):** AKS-20745 min/max locations, AKS-20746 visibility option box, AKS-20774 consolidate configs.

**What the epic has never contained:** a single ticket for draw-call/perf work (no instancing, culling, LOD, streaming-upload, benchmarking), and nothing for querying the model as data (no semantic tree, filter, aggregate, schedule). The nearest neighbours are AKS-19262 (payload *size*, on hold) and AKS-20746 (show/hide layers). So the BIM work is genuinely new scope, not a re-tread — with the one exception of picking, which is AKS-18641.

## 2. AKS-18641 review

Status On-Hold since 2026-02-06 (auto-transitioned after 4 weeks idle), assigned to Tien, priority Low. Description already carves out rectangular pick as a later separate ticket.

**The three decisions in the comments, and where they land now:**

1. **Thuc:** exclude highlighting and selection from this ticket, do them later. → The `pick_stage.rs` on branch `wgpu-pick-semantic` matches this exactly: pick only, no highlight. Highlight/selection therefore need their own ticket (§4 item S4).

2. **Brian Sabbey (who wrote the HUI picking code):** *"I'm not very worried about stalling the graphics pipeline. Much of the advice about graphics programming is intended for games trying to reach 120 Hz... We don't need so many frames per second."* → This settles the ticket's central worry. The long `map_async`/async-readback investigation in the first comment was solving a problem the author says we don't have. The implementation on branch uses a **synchronous** `poll(wait_indefinitely)` readback, which is both simpler and sanctioned. It stays valid as long as the renderer is on the GL backend, and only needs to become async if/when WebGPU is adopted (noted in the module doc comment).

3. **Brian:** suggests **compute-shader ray casting** instead of pixel picking, since wgpu has compute shaders and HUI's era did not. → **This path is currently blocked, and the ticket does not record why:** the renderer runs on WebGL2 (`use_webgl = true` hardcoded at `wgpu_renderer.rs:297-306`, `downlevel_webgl2_defaults()` at `:322`, `webgl` feature unconditional in `Cargo.toml:14`). **WebGL2 has no compute shaders.** So compute-shader picking requires the WebGPU migration first. Under today's configuration, pixel-based picking is the only option — which is what got built. Worth adding as a comment so the option isn't re-litigated.

4. **Brian:** *"`pipelines.rs` is not used... I asked AI to translate some of our pipeline code to Rust... I believe you should be able to delete that file and still compile."* → Confirms the audit finding independently, and explains the first comment's *"I'm still confusing on using this pipeline.rs file"*. It is dead. Note it still contains the only written-down design for the pick/highlight/selection pipelines, so mine it before deleting.

**One factual fix for the ticket's own comparison table:** it lists our Primary Backend as "WebGPU (via wgpu-rs)". It is **WebGL2** via wgpu's GL backend. Several conclusions in that table (and the whole compute-shader option) depend on the difference.

## 3. Correction to doc 02: pick geometry is NOT free, and solutions may have none

[02_design_semantic_layer.md](02_design_semantic_layer.md) §1 claimed pick items add "~zero geometry bytes" because `remember_array` dedups arrays with their display twin. **That holds only when one `GraphicsBody` carries both `draw_pick` and `draw_regular`.** It frequently does not:

- `should_draw` gates pick items on `graphics_body.draw_pick` (`gl_graphics/render_list.py:216-223`).
- The common model path builds a **separate** pick tree with its own geometry: `ga.GraphicsTree.create(pick_graphics_items, draw_pick=True, draw_regular=False)` (`akselos/ui/graphics_trees/graphics_group_node.py:251`), with the comment at `:249` noting it is skipped during pan/rotate/zoom for speed. Separate `GraphicsArray`s → separate `array_id`s → **real extra bytes** in `array_data.bin`. (Often simplified geometry, so cheaper than the display body, but not free.) This interacts directly with AKS-19262 (payload size).
- **Solution graphics are built with `draw_pick=False`** — `solution_graphics/nodeset_field_graphics.py:53`, `solution_mesh_graphics.py:127`, `solution_undeformed_model_graphics.py:514`, and `component_type_layer.py:125,138`. And `worker.py:182` exports only `graphics_layer_idxs = [0]`.

**Therefore: today's exports may contain no `PickRenderStage` items at all**, in which case the pick pass renders nothing and every click reports empty space. This is exactly what Brian meant by *"My original Rust graphics code only sent the first graphics layer... One possibility would be to send the pick layer as well."*

This makes "make the export actually carry pick items" a **blocking prerequisite**, not a detail — and it must be verified empirically by exporting a real `.aks` and an `.asl` and counting `PickRenderStage` render_items. I could not run that here (needs HUI under Xvfb plus a model). It is ticket **S2** below and should be done before S3.

## 4. Tickets to create

Reuse, don't duplicate:

| Existing | Action |
|---|---|
| **AKS-18641** | Reopen from On-Hold. The branch `wgpu-pick-semantic` implements it (single-pixel pick, `src/pick_stage.rs`, `set_on_pick`). Add a comment recording: compute-shader picking needs WebGPU (no compute on WebGL2); sync readback is per Brian's guidance; `pipelines.rs` confirmed dead. |
| **AKS-19262** (on hold) | Now has a concrete driver: separate pick geometry adds bytes (§3). Link to S2. |
| **AKS-20746** visibility box | Natural host UI for semantic filtering; link to Q2. |
| **AKS-19367** unit tests | The two `decode_padic` tests on the branch belong here or in 18641. |

New tickets. Suggested parent: keep the semantic ones under **AKS-18576**, and open a **second epic for performance/large models** — that track is big enough to deserve its own epic and has zero coverage today.

### Semantic track (this is what makes it BIM) — under AKS-18576

| ID | Ticket | Depends on | Size |
|---|---|---|---|
| **S1** | *Export pick id → entity map (`pick_map.json`) with graphics-tree key path.* Server side; `_write_pick_map` in `worker.py`, key-path capture in `RemoteRenderList`. Includes content-derived `stable_id` so selections survive a re-export (the colour idx is random per export). **Implemented on branch.** | — | S |
| **S2** | *Make exports carry pick items.* Export the pick-enabled graphics trees/layers (§3, Brian's comment), verify `PickRenderStage` item counts for a real `.aks` and `.asl`, and decide whether solution views get pick geometry at all. **Blocks S3.** | S1 | M |
| **S3** | *Click-to-data end to end.* Renderer part done (pick pass + `set_on_pick`); remaining is the React side: fetch `pick_map.json`, resolve the id, show a properties panel. | S2 | M |
| **S4** | *Highlight + selection.* The feature Thuc deferred out of AKS-18641. Client-side overlay driven by a retained `element_id → RenderItem` index, plus an inbound `set_selection(ids)`; mine `pipelines.rs:386-408` for the blend pipelines before deleting it. | S3 | M |
| **S5** | *Semantic tree UI.* Project→Group→Body tree from `key_path`, two-way linked with selection. | S3 | M |
| **S6** | *Query / filter / aggregate layer.* Host-side over `pick_map.json`: filter by property, count/sum/group-by. This is the actual BIM litmus test — ask a question, get a data answer. | S5 | M |
| **S7** | *Dashboards & schedules from model data.* Charts/quantity tables driven by S6. | S6 | M |
| **S8** | *Colour by property (categorical).* Reuses the existing `is_enumerating` discrete branch in the scalar-field shader — host writes a category-index array and calls the existing `update_scalar_field`. **No shader work.** | S6 | S |
| **S9** | *Rectangular / multi-pick.* Already carved out in AKS-18641's description and needed for the overlapping-sensor-label work. | S3 | M |

### Performance / large-model track — new epic

| ID | Ticket | Depends on | Size |
|---|---|---|---|
| **P1** | *Benchmark harness* — draw calls, RenderItem count, frame-time 1 % lows, parse/upload ms, buffer bytes. Zero numbers exist today. **Do first; everything else is unfalsifiable without it.** | — | S |
| **P2** | *Streaming GPU upload.* Pre-allocate buffers from `array_descriptors`, `write_buffer` each chunk on arrival. Removes the **~3× geometry peak in wasm32 linear memory (4 GB cap)** and the load freeze. Biggest single win; it is a memory-ceiling fix, not just speed. | P1 | L |
| **P3** | *Free draw-call wins.* Merge adjacent index ranges in a group; hoist `set_vertex_buffer` out of the per-item loop; `BTreeMap` for deterministic order. | P1 | S–M |
| **P4** | *Frustum culling* with the per-element bboxes `get_bounding_box_in_model` already computes and discards. Bundles can be dropped — they don't save driver calls (wgpu replays them command-by-command). | P3 | M |
| **P5** | *Instancing via instance-step vertex attributes.* Works on WebGL2 — `overlay_pass.rs` already does it. | P4 | M–L |
| **P6** | *Per-frame CPU cleanup.* O(n²) label-merge fixpoint, ~9 `Vec` + 3 `String` allocs/frame, per-frame label-rect `create_buffer`, 2.7 KB `Globals` rebuilt from unchanged inputs. | P1 | S |
| **P7** | *Server-side LOD chain + screen-space-error selection.* | P1, P4 | L |
| **P8** | *Spatial tiling + LRU eviction*, extending the existing chunk manifest (not 3D Tiles). | P2, P7 | L |
| **P9** | *WebGPU adapter with GL fallback.* Unlocks occlusion queries, storage-buffer instancing, and Brian's compute-shader picking. Requires `pick_at` to go async. | P1 | M |

### Bugs found by the audit — file as defects, not features

| ID | Defect |
|---|---|
| **B1** | Depth ordering is wrong: translucent draws *before* opaque, then the shaded pass **clears depth** mid-frame (`shaded_stage.rs:130-136`), so shaded geometry never depth-tests against scalar-field/translucent output. Compounded by `HashMap`-order draws, so transparency varies run to run. |
| **B2** | Loading progress reaches 100 % *before* `finalize_chunks` + upload, so the UI reads "done" precisely while the main thread is frozen. |
| **B3** | `has_rendered` is initialised `true` and never reassigned → the pre-first-frame input gate at `web_app.rs:557-568` never fires. |
| **B4** | Panic trap: `_get_buffer_slice` unwraps, so a `ShadedRenderStage` item with `normals_id == -1` panics even though `validate_arrays` permits it. |
| **B5** | Stale artifacts: committed `pkg/` exports four functions that no longer exist and lacks `RenderDataLoader`; `tools/wgpu_renderer/README.md` has the wrong out-dir and path; `TARGET_VERSION_FILE` is declared but never written, so the deployed wasm's source revision is unknowable. |
| **B6** | Delete `pipelines.rs` (per Brian) — after mining its pick/highlight/selection pipeline designs for S4. |

**Minimum set to claim "it is BIM":** S1 → S2 → S3 → S5 → S6. S4/S8 make it feel like a product; S7 is the BI layer. P1+P2 are what make it survive a large model at all.
