# 06 — Plan step 5 "Instancing + merging": what it means and the code for it

Unpacks the `PARTIAL` verdict in [01_explorer_wgpu_bim_gap.md](01_explorer_wgpu_bim_gap.md) §2 row 5. **Nothing here is applied** — this is the proposed code, for review.

Two different techniques are bundled under one plan item. The crate did the cheap one and skipped the valuable one.

---

## 1. Two meanings of "merging"

**Merging, plan sense = fewer draw calls.** Concatenate geometry so one `draw_indexed` covers what used to be many.

**Merging, what the crate did = fewer GPU *buffer objects*.** `ArrayBundle::new` walks descriptors and only starts a new buffer when `buffer_type` changes (`render_list.rs:204-222`), so ~28 arrays become ~3 buffers: Vertex, Index, Scalar. That was driven by a WebGL constraint, not performance — *"mixing vertex and index data is not allowed with the WebGL backend"* (`render_list.rs:175`). The author says so on the next line: *"Not sure if reducing the number of buffers helps performance much, but it's not hard to do."*

Hence `PARTIAL`: the **data** is contiguous, but the **draws** were never collapsed. Contiguity is the precondition for the win; the win was left on the table.

## 2. What the draw loop costs today

`set_render_bundle` walks a 4-deep nest (`shaded_stage.rs:166-206`):

| Level | Key | State change emitted |
| --- | --- | --- |
| 1 | `RenderStage` | filter only |
| 2 | `n_vertices_per_elem` | `set_pipeline` (2 = lines, 3 = triangles) |
| 3 | `ItemKey` = (transform_id, colour) | `set_bind_group(2, …)` |
| 4 | `vertices_id` | `set_vertex_buffer(0, …)` |
| 5 | `indices_id` | `set_index_buffer` |
| 6 | **each `RenderItem`** | **`set_vertex_buffer(1, normals)` + `draw_indexed(range, 0, 0..1)`** |

The nesting exists to hoist state changes out of inner loops — the comment at `render_list.rs:115-118` says it mirrors HUI's Python loops. It works, except at the last level. Three gaps:

1. **Adjacent index ranges are never coalesced.** Every item in that innermost `Vec` already shares pipeline, bind group, vertex buffer *and* index buffer, and their `indices_start_row..end_row` are row ranges into the *same* index array. If item A ends where B starts, one `draw_indexed` over the union is byte-identical output. A body with 200 same-coloured faces is 200 draws that could be 1.
2. **`set_vertex_buffer(1, normals)` is re-issued per item** (`shaded_stage.rs:194-197`) even when every item in the bucket shares `normals_id` — it sits *below* the level that determines it. Same for the scalar slot at `scalar_field_stage.rs:352-355`.
3. **Zero 3D instancing** — every `draw_indexed(…, 0..1)` draws exactly one copy.

## 3. Instancing: the blocker, and one thing that is already solved

Instancing = one draw renders N copies of the same geometry, with per-copy data (transform, colour) from a separate buffer. It is the answer when a mesh repeats: bolts, brackets, identical component types, sensor spheres.

**Already solved:** `GraphicsArray.__hash__`/`__eq__` are **content-based** — `(data_hash, shape, dtype, buffer_type)` (`tools/graphics_api/graphics_array.py:70-80`) — so `remember_array` already collapses identical meshes to one `array_id`. Repeated components genuinely share arrays in the Avro today. No server-side dedup pass is needed first.

**The blocker is the map's nesting order.** `ItemKey` sits *above* `vertices_id` (`render_list.rs:119-131`). Instances differ precisely by transform and colour, so they get different `ItemKey`s and are scattered across sibling buckets — one bind group and one draw each. The data holds the instances; the traversal hides them. Fixing it means inverting the nest: group by geometry, collect the `(transform, colour)` set into a per-instance buffer, issue `0..N`.

Two ways to feed per-instance data:

- **Storage buffer indexed by `instance_index`** — the clean design, **unavailable on WebGL2** (no vertex-stage storage buffers under `downlevel_webgl2_defaults`).
- **Per-instance vertex attributes** — `VertexStepMode::Instance`, 4 × `vec4` for the matrix + 1 for colour = 5 of WebGL2's 16 guaranteed slots. **Works today**, and this repo proves it: `overlay_pass.rs:125` uses `step_mode: Instance` and ships (`:296` draws 6 verts × N rects in one call).

Cheapest wins outside the model stages: sensors are 2 draws + 2 uniform writes *per sensor* over one shared unit sphere (`sensor_stage.rs:349-352`) → 2 draws total; the triad's 10 parts already share one vertex/index buffer and differ only by colour → 1–2 draws.

## 4. Measure the payoff before writing any of it

`--split-items K` in `synth_bench.py` is the **exact inverse of range merging**: it cuts one item's row range into K items — same bytes, same pixels, K× the draws. The curve it produces *is* the merging payoff curve, read backwards.

Sweep `--split-items 1 → 2 → 4 → 16 → 64` at fixed bytes and plot frame time. The slope is the per-draw cost on the target hardware. If 64× the draws barely moves frame time, merging is not the bottleneck and P2 (streaming upload) should come first. If it is linear and steep, merging is the cheapest large win in the codebase. Adding `--instances N` layers bind-group churn on top; the gap between the two curves is how much of the cost is rebinding versus the draw itself. This is exactly the question P1 exists to answer — see [05_benchmark_and_limits.md](05_benchmark_and_limits.md).

---

## A. Range coalescing + hoisting the normals rebind

New helper in `render_list.rs`:

```rust
/// One `draw_indexed` covering a run of items that share everything a draw call depends on.
pub struct CoalescedDraw {
    pub normals_id: ArrayId,
    pub start_row: i64,
    pub end_row: i64,
}

impl CoalescedDraw {
    pub fn get_flat_index_range(&self, n_vertices_per_elem: u32) -> std::ops::Range<u32> {
        let start = n_vertices_per_elem * u32::try_from(self.start_row).unwrap();
        let end = n_vertices_per_elem * u32::try_from(self.end_row).unwrap();
        start..end
    }
}

/// Collapses items in one `render_map` bucket into the fewest possible draw calls.
///
/// Everything in a bucket already shares stage, pipeline, bind group, vertex buffer and index
/// buffer, so two items whose index-row ranges are *exactly* adjacent can be drawn as one:
/// the triangles and their order are unchanged, and they read the same `ItemData`.
///
/// Grouped by `normals_id` first because that feeds vertex slot 1, so it must be equal across a
/// merged draw. Only exactly-adjacent ranges are merged, never overlapping ones — drawing an
/// overlap once instead of twice would change the result under alpha blending.
pub fn coalesce_draws(render_items: &[RenderItem]) -> Vec<CoalescedDraw> {
    let mut rows_by_normals: std::collections::BTreeMap<ArrayId, Vec<(i64, i64)>> = Default::default();
    for render_item in render_items {
        rows_by_normals
            .entry(render_item.normals_id)
            .or_default()
            .push((render_item.indices_start_row, render_item.indices_end_row));
    }

    let mut draws = Vec::new();
    for (normals_id, mut ranges) in rows_by_normals {
        ranges.sort_unstable();
        let mut ranges = ranges.into_iter();
        let Some((mut start_row, mut end_row)) = ranges.next() else {
            continue;
        };
        for (next_start, next_end) in ranges {
            if next_start == end_row {
                end_row = next_end;
            } else {
                draws.push(CoalescedDraw { normals_id, start_row, end_row });
                start_row = next_start;
                end_row = next_end;
            }
        }
        draws.push(CoalescedDraw { normals_id, start_row, end_row });
    }
    draws
}
```

Innermost loop of `shaded_stage.rs::set_render_bundle` becomes:

```rust
                        for (indices_id, render_items) in indices_map {
                            let (n_vertices_per_elem, index_format) =
                                render_list.get_indices_format(indices_id);
                            render_bundle_encoder.set_index_buffer(
                                render_list.get_buffer_slice(indices_id),
                                index_format,
                            );

                            debug_assert!(render_items.iter().all(|item| {
                                item.render_stage == *render_stage
                                    && item.vertices_id == *vertices_id
                                    && item.indices_id == *indices_id
                            }));

                            let mut last_normals_id: Option<render_list::ArrayId> = None;
                            for draw in render_list::coalesce_draws(render_items) {
                                // Hoisted: slot 1 only needs rebinding when normals actually
                                // change, not once per item.
                                if last_normals_id != Some(draw.normals_id) {
                                    render_bundle_encoder.set_vertex_buffer(
                                        1,
                                        render_list.get_buffer_slice(&draw.normals_id),
                                    );
                                    last_normals_id = Some(draw.normals_id);
                                }
                                render_bundle_encoder.draw_indexed(
                                    draw.get_flat_index_range(n_vertices_per_elem),
                                    0,
                                    0..1,
                                );
                            }
                        }
```

`ArrayId` is currently a private `type` alias — needs `pub type ArrayId = i32;`. The same edit applies verbatim to `translucent_stage.rs` (no slot 1), `scalar_field_stage.rs` (group by `scalar_values_id` instead of `normals_id`), and `pick_stage.rs`.

## B. Deterministic draw order

`render_list.rs` — swap the map type and give `ItemKey` an ordering:

```rust
type RenderMap = std::collections::BTreeMap<
    RenderStage,
    std::collections::BTreeMap<
        u32,
        std::collections::BTreeMap<
            ItemKey,
            (
                std::rc::Rc<wgpu::BindGroup>,
                std::collections::BTreeMap<ArrayId, std::collections::BTreeMap<ArrayId, Vec<RenderItem>>>,
            ),
        >,
    >,
>;

// RenderStage needs Ord too:
#[derive(Eq, PartialEq, Ord, PartialOrd, Hash, Clone, Copy, Debug, serde::Deserialize)]
pub enum RenderStage { /* unchanged */ }

/// Ordering is by raw bytes — arbitrary but *stable*, which is the whole point. Hashing floats
/// is already done this way here (see `Hash`/`PartialEq`), so this stays consistent with it.
impl Ord for ItemKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        bytemuck::bytes_of(self).cmp(bytemuck::bytes_of(other))
    }
}

impl PartialOrd for ItemKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
```

Everything downstream is iteration and `entry().or_default()`, which `BTreeMap` supports identically, so the stage loops need no change beyond this. This is what makes before/after benchmark frames comparable, and it removes the run-to-run variation in translucent blending (defect B1).

## C. Instancing via per-instance vertex attributes

### C1. Build batches where `ArrayBundle` is in scope (`render_list.rs`)

```rust
/// Identifies geometry that can be drawn in one instanced call: everything except the
/// per-instance transform and colour.
#[derive(Eq, PartialEq, Ord, PartialOrd, Clone, Copy, Debug)]
pub struct GeometryKey {
    pub render_stage: RenderStage,
    pub n_vertices_per_elem: u32,
    pub vertices_id: ArrayId,
    pub indices_id: ArrayId,
    pub normals_id: ArrayId,
    pub start_row: i64,
    pub end_row: i64,
}

/// Per-instance data, laid out for a `VertexStepMode::Instance` buffer.
///
/// `model_from_local` is column-major (`glam::Mat4::to_cols_array`), so four consecutive
/// `vec4`s reconstruct it with `mat4x4<f32>(m0, m1, m2, m3)` in WGSL.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct InstanceRaw {
    pub model_from_local: [f32; 16],
    pub color: [f32; 4],
}

impl InstanceRaw {
    const ATTRS: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
        2 => Float32x4, 3 => Float32x4, 4 => Float32x4, 5 => Float32x4, 6 => Float32x4
    ];

    pub fn get_layout<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &Self::ATTRS,
        }
    }
}

pub struct InstancedBatch {
    pub instance_buffer: wgpu::Buffer,
    pub n_instances: u32,
}

pub type InstancedMap = std::collections::BTreeMap<GeometryKey, InstancedBatch>;
```

Built once, alongside `render_map`, inside `RenderList::new` — the only place `ArrayBundle::get_array_mat4` is reachable:

```rust
        // Repeated geometry already shares one array_id: GraphicsArray's Hash/Eq are
        // content-based (data_hash + shape + dtype + buffer_type), so `remember_array` on the
        // Python side dedups identical meshes. Items that differ only by transform/colour
        // therefore land on the same GeometryKey here.
        let mut key_to_instances: std::collections::BTreeMap<GeometryKey, Vec<InstanceRaw>> = Default::default();
        for render_item in &render_items {
            let indices_array = array_bundle.get_array(render_item.indices_id)?;
            let n_vertices_per_elem = u32::try_from(indices_array.array_descriptor.shape[1]).unwrap();
            let model_from_local = if render_item.model_from_local_id == -1 {
                glam::Mat4::IDENTITY
            } else {
                array_bundle.get_array_mat4(render_item.model_from_local_id)?
            };
            let color = match render_item.color.len() {
                4 => glam::Vec4::from_slice(&render_item.color),
                0 => glam::Vec4::new(1.0, 0.0, 0.0, 1.0),
                _ => return Err(anyhow::anyhow!("invalid color length")),
            };
            let key = GeometryKey {
                render_stage: render_item.render_stage,
                n_vertices_per_elem,
                vertices_id: render_item.vertices_id,
                indices_id: render_item.indices_id,
                normals_id: render_item.normals_id,
                start_row: render_item.indices_start_row,
                end_row: render_item.indices_end_row,
            };
            key_to_instances.entry(key).or_default().push(InstanceRaw {
                model_from_local: model_from_local.to_cols_array(),
                color: color.to_array(),
            });
        }

        let instanced_map: InstancedMap = key_to_instances
            .into_iter()
            .map(|(key, instances)| {
                let instance_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("instance_buffer"),
                    contents: bytemuck::cast_slice(&instances),
                    usage: wgpu::BufferUsages::VERTEX,
                });
                (key, InstancedBatch { instance_buffer, n_instances: instances.len() as u32 })
            })
            .collect();
```

Coalescing (A) still applies *before* this: merge adjacent rows within a `(transform, colour)` group first, then instance the merged geometry.

### C2. Shader

`FRAME_WGSL` must be split, because the instanced pipeline has no group 2, and a *declared* `item_data` binding absent from the pipeline layout is a pipeline-creation error:

```rust
/// FRAME_WGSL minus the `@group(2)` item_data binding — camera, globals and should_clip only.
pub const INSTANCED_FRAME_WGSL: &str = r#"
// ... camera @group(0) @binding(0), globals @group(0) @binding(1), fn should_clip(...) ...
"#;

pub const INSTANCED_FLAT_WGSL: &str = r#"
struct InstanceIn {
  @location(2) m0: vec4<f32>,
  @location(3) m1: vec4<f32>,
  @location(4) m2: vec4<f32>,
  @location(5) m3: vec4<f32>,
  @location(6) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) vertex_in_ndc: vec4<f32>,
  @location(0) vertex_in_model: vec4<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) vertex_in_local: vec3<f32>, instance: InstanceIn) -> VertexOut {
  let model_from_local = mat4x4<f32>(instance.m0, instance.m1, instance.m2, instance.m3);
  var vertex_out: VertexOut;
  vertex_out.vertex_in_model = model_from_local * vec4<f32>(vertex_in_local, 1.0);
  vertex_out.vertex_in_ndc = camera.ndc_from_model * vertex_out.vertex_in_model;
  vertex_out.color = instance.color;
  return vertex_out;
}

@fragment
fn fs_main(@location(0) vertex_in_model: vec4<f32>, @location(1) color: vec4<f32>) -> @location(0) vec4<f32> {
  if (should_clip(vertex_in_model)) {
    discard;
  }
  return color;
}
"#;
```

### C3. Pipeline layout and vertex buffers

```rust
        // Groups 0 and 1 only: per-item uniforms are gone, so there is no group 2 to bind.
        // Mirrors how TriadStage substitutes its own layout rather than reusing the shared one.
        let instanced_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("instanced_pipeline_layout"),
            bind_group_layouts: &[&frame_bind_group_layout, &empty_bind_group_layout],
            push_constant_ranges: &[],
        });
```

```rust
            vertex: wgpu::VertexState {
                module: &shader_module,
                entry_point: Some("vs_main"),
                buffers: &[
                    Vertex::get_layout(),                   // slot 0, per-vertex positions
                    Normal::get_layout(),                   // slot 1, per-vertex normals (shaded only)
                    render_list::InstanceRaw::get_layout(), // slot 2, per-instance
                ],
                compilation_options: Default::default(),
            },
```

### C4. Encode loop — flat, one draw per geometry

```rust
        render_bundle_encoder.set_bind_group(0, frame_bind_group, &[]);
        let mut last_n_vertices_per_elem = None;
        for (key, batch) in &render_list.instanced_map {
            if key.render_stage != render_list::RenderStage::ShadedRenderStage {
                continue;
            }
            if last_n_vertices_per_elem != Some(key.n_vertices_per_elem) {
                match key.n_vertices_per_elem {
                    2 => render_bundle_encoder.set_pipeline(&self.shaded_edge_pipeline),
                    3 => render_bundle_encoder.set_pipeline(&self.shaded_triangle_pipeline),
                    _ => return Err(anyhow::anyhow!("unsupported n_vertices_per_elem")),
                }
                last_n_vertices_per_elem = Some(key.n_vertices_per_elem);
            }
            render_bundle_encoder.set_vertex_buffer(0, render_list.get_buffer_slice(&key.vertices_id));
            render_bundle_encoder.set_vertex_buffer(1, render_list.get_buffer_slice(&key.normals_id));
            render_bundle_encoder.set_vertex_buffer(2, batch.instance_buffer.slice(..));
            let (n_vertices_per_elem, index_format) = render_list.get_indices_format(&key.indices_id);
            render_bundle_encoder.set_index_buffer(
                render_list.get_buffer_slice(&key.indices_id),
                index_format,
            );
            let start = n_vertices_per_elem * u32::try_from(key.start_row).unwrap();
            let end = n_vertices_per_elem * u32::try_from(key.end_row).unwrap();
            render_bundle_encoder.draw_indexed(start..end, 0, 0..batch.n_instances);
        }
```

Because `GeometryKey` sorts on `render_stage` and `n_vertices_per_elem` first, a `BTreeMap` walk groups pipeline switches naturally — no nesting needed.

## 5. Caveats on the above

- **5 of 16 attribute slots.** WebGL2 guarantees 16; this uses 0–1 for vertex data and 2–6 for instance data. Proven in-repo by `overlay_pass.rs`.
- **`_get_buffer_slice` unwraps**, so `normals_id == -1` panics (defect B4, `render_list.rs:842`). The instanced path makes it worse by hoisting the bind unconditionally — needs a real fix first, e.g. a zero-filled placeholder normals array.
- **`ItemKey`, `ItemBuffers` and the per-item uniform buffers become dead** for converted stages. `sensor_stage` and `triad_stage` keep using `ItemData`, so `ItemData` and group 2 stay.
- **The pick stage benefits for free** — its id lives in `color`, now a per-instance attribute, so one draw covers many distinct ids.
- **A and B are safe refactors; C changes the wire-to-GPU path and the shader.** Do A and B, measure with `--split-items`, then decide C.
