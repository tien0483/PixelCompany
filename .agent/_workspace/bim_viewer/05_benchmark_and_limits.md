# 05 — Benchmark design and the real limits (target: 100 GB model)

Scope change from the manager: **stop at 3D visualisation / rendering limits**, not full BIM features. Constraint from Tien: **do not depend on HUI exports** — inflate the sample data already shipped in `dashboard/papps/frontends/public/` instead.

References: [How to benchmark cloud-based BIM platforms](https://medium.com/transformosa-blog/how-to-benchmark-cloud-based-bim-platforms-168ce23f9c1b) (Transformosa) and [GPUScore](https://www.gpuscore.com/benchmarks/) (Basemark).

---

## 1. The generator: `tools/wgpu_renderer/wgpu_data_utils/synth_bench.py`

Written and verified this session. Reads a real export as a seed and inflates it. Imports only `fastavro` — no HUI, no `akselos`, no `graphics_api`. **Run it by file path, not `-m`**, because `wgpu_data_utils/__init__.py` pulls in `helper_functions` → `import akselos`:

```bash
python tools/wgpu_renderer/wgpu_data_utils/synth_bench.py --seed-dir dashboard/papps/frontends/public --out-dir /tmp/bench/2gb --ballast 1625
```

The schema is read back out of the seed file, so it cannot drift from `gl_graphics/remote_render_list.py`.

### Three orthogonal knobs — the design point

The audit's central finding is that **element/draw-call count, not triangle count or bytes, is the usual bottleneck**. A single "make it bigger" knob conflates the two and tells you nothing. So:

| Knob | What grows | What stays fixed | Isolates |
|---|---|---|---|
| `--ballast N` | bytes, GPU buffers, chunk count, transfer | draw calls (**unchanged**) | the load path: wasm memory ceiling, upload time, VRAM |
| `--instances N` | draw calls, per-item uniforms + bind groups | geometry bytes (+64 B/instance) | draw-call cost *with* bind-group churn |
| `--split-items K` | draw calls only | bytes, arrays, **and the rendered image is pixel-identical** | *pure* draw-call overhead, everything else held constant |

`--ballast` works because `ArrayBundle::new` (`render_list.rs:154-318`) uploads **every** descriptor, while only render items reach a `draw_indexed`. Ballast arrays are referenced by no item: they cost transfer, wasm memory and a GPU buffer, and are never drawn. `--split-items` works because `indices_start_row/end_row` are row indices into the index array (`render_list.rs:101-105`), so one item's range can be cut into K contiguous items covering exactly the same triangles.

Scalar arrays are never duplicated: a duplicated vertex array has the same vertex count, so items keep the seed's scalar id and the field `.bin` files stay untouched (and `validate_arrays`' `len == n_vertices` check still passes).

### Verified behaviour

| Run | Items → draws | Arrays | `array_data` | Chunks |
|---|---|---|---|---|
| seed | 8 | 28 | 1.3 MiB | — |
| `--split-items 4` | **32** | 28 | **1.3 MiB (byte-identical)** | — |
| `--instances 50` | **400** | 420 | 1.28 MiB (+25 KB) | — |
| `--ballast 200` | **8 (unchanged)** | 4804 | **252 MiB** | 32 |
| `--ballast 20 --instances 8 --split-items 2` | 128 | 540 | 25.2 MiB | 4 |

Round-trip validated on the output: descriptor bytes == chunk manifest bytes, every chunk's size + MD5 matches, no dangling array ids, ids unique, and the descriptor list order matches the byte order.

That last one caught a real bug during development: **the record's `array_descriptors` order is load-bearing.** `ArrayBundle::new` walks the list in order and accumulates byte offsets as it goes, so the list must be ordered exactly as the bytes were written — non-scalar sorted by `(buffer_type, array_id)`, then scalar sorted the same way, matching `_write_array_data`. An unsorted list silently yields garbage geometry rather than an error.

### Two incidental findings about the shipped sample

- **`public/render_group.avro` predates chunking.** Its `RenderGroup` record has only `render_items` + `array_descriptors`, with no `array_chunks` field (added by AKS-19283). The generator now upgrades the schema when asked for chunked output. The deployed demo asset is therefore an older format than the loader's chunk path expects.
- **The sample contains zero `PickRenderStage` items** — 4 `ScalarFieldRenderStage` + 4 `TranslucentRenderStage`, and no `ShadedRenderStage` either. Independent confirmation of doc 04 §3: exports as they exist today carry no pick geometry, so click-to-data has nothing to hit.

## 2. Metrics to capture

From the Transformosa article (its checklist, mapped to what we can instrument):

- ✓ **Upload / conversion time** → server-side export time (`worker.py`); for synthetic runs, generation time — not interesting, record for completeness.
- ✓ **Model load time in browser** → must be split into phases, because today they are one blocking task (`web_app.rs:293-318`): fetch → avro parse → MD5 → merge → `create_buffer_init` → first frame. Report each separately; the article's single "load time" would hide exactly the problem we have.
- ✓ **FPS during navigation** (orbit / zoom / pan / sectioning) → sectioning maps to the clip-plane feature (AKS-19366).
- ✓ **Downloaded size, compressed and uncompressed** → `array_data.bin` vs gzip-on-the-wire; relates to AKS-19262.
- ✓ **Network bandwidth** → record throughput and chunk concurrency (6-way today, `loadRenderData.util.ts:100`).
- ✓ **Documented hardware / browser / network** → the article pins CPU, GPU, RAM, OS, Chrome version, up/down Mbps. Do the same or numbers are not comparable across machines.

Add these, which the article omits and which matter more for this renderer:

- **Draw calls per frame** — the actual bottleneck. Equal to render-item count today (every stage draws with instance range `0..1`), so `expected_draw_calls` in the manifest is the ground truth to check instrumentation against.
- **Frame-time percentiles (1 % and 0.1 % lows)**, not just average FPS. GPUScore's *public* metrics are score + average + min/max FPS only; average FPS hides the stalls that make a viewer feel broken.
- **Peak wasm linear memory** — `WebAssembly.Memory.buffer.byteLength` sampled across load. This is the ceiling (§4), so it is the single most important number.
- **GPU buffer bytes allocated** — sum over `ArrayBundle`'s buffers.
- **Time to first frame** vs time to complete load — currently the same thing; the gap is the prize for streaming.
- **Input latency during load** — the tab is frozen today; measure it explicitly rather than describing it.

### Methodology, borrowed from GPUScore

GPUScore runs **frame-based rather than time-based** ("maximal comparability, repeatability and measurement quality", and it sidesteps frame-rate limiters). Do the same: drive a **fixed, scripted camera path over a fixed frame count** and report the frame-time distribution — not "orbit around for 10 seconds", which is unrepeatable and confounds the result with how fast the machine ran. A deterministic path also makes the culling/LOD work (P4/P7) measurable, since the same frames must be reproduced before and after.

Note the renderer paints **on demand**: `ControlFlow` is never set, so winit's default `Wait` applies and the web build only draws when something calls `request_redraw` (`about_to_wait` is empty on web, `web_app.rs:593`). A benchmark that just idles will record no frames at all — the harness must drive continuous `request_redraw` itself, or measure only during scripted input.

## 3. Instrumentation points

| Metric | Where |
|---|---|
| draw calls, items per stage | count in `set_render_bundle` of each stage; expose via a new wasm getter |
| GPU buffer bytes | sum in `ArrayBundle::new` (`render_list.rs:320-346`) |
| load phase timings | around each step of the `spawn_local` in `web_app.rs:293-318`, plus JS-side fetch timings in `loadRenderData.util.ts` |
| frame time | in `GraphicsWindow::render` (`graphics_window.rs:71`); accumulate a ring buffer, compute percentiles in JS |
| peak wasm memory | JS side, sampled during load |
| progress truthfulness | compare the existing progress callback against actual completion — B2 in doc 04 |

`canvas_id_to_loading_progress` (`web_app.rs:43`) is written once with `100.0` and never read; it can become the real progress channel.

## 4. The 100 GB question, with numbers

There are **three independent walls**, and all of them are roughly two orders of magnitude away. This is why the answer is architectural, not a tuning exercise.

**Wall 1 — network.** 100 GB at 100 Mbps ≈ 2.2 hours of transfer, and the loader today requires **every** chunk before anything renders (`finalize_chunks` hard-fails otherwise, `web_app.rs:705-713`). Full download is off the table on transfer time alone, independent of memory.

**Wall 2 — residency.** Peak load residency is **~3× the geometry in wasm32 linear memory**, which is capped at 4 GB and realistically lower: `unmerged_chunks` + the concatenated blob + the `create_buffer_init` staging copy. So today's practical ceiling is roughly **0.7–1.0 GB of geometry** — about 1 % of 100 GB. Fixing the load path (P2: pre-allocate from `array_descriptors`, `write_buffer` per chunk) drops peak wasm memory to one chunk and moves the ceiling to **VRAM**, i.e. ~8–24 GB on real hardware — still 4–12× short of 100 GB.

**Wall 3 — draw calls.** A 100 GB model implies ~10⁵–10⁶ elements. At one `draw_indexed` per element with no instancing and no culling, that is hopeless on WebGL2 regardless of memory.

**Conclusion:** a 100 GB model cannot be "loaded" in any form of the current architecture. It requires the resident set to be **decoupled from model size** — server-side spatial tiling + an LOD chain + streaming with eviction (P7, P8), so the browser only ever holds the visible slice. That is the same conclusion as the research doc's rule ("smoothness comes from loading LESS"), but now with the specific numbers for this codebase.

**So the benchmark's job is not "can it do 100 GB" (it cannot, by ~100×). It is to measure each wall on the target hardware so the tiling budget can be derived from data:**

1. **Byte sweep** (`--ballast`, geometric: 1× 10× 50× 100× 400× 800× 1625× ≈ 1.3 MiB → 2 GB) — find the exact size where load fails, and *how* it fails (wasm OOM / `RangeError` / device loss / tab crash). Record peak wasm memory and load-phase times at each step. **This directly yields the per-tile size budget.**
2. **Draw-call sweep** (`--split-items`, then `--instances`, geometric to 10⁵) — find the draws/frame at which the 1 % low crosses the interactivity threshold (~33 ms). **This yields the maximum elements visible per frame**, which sets the LOD/merging target. Running both knobs separately also quantifies how much of the cost is bind-group churn versus the draw itself.
3. **Chunk-size sweep** (`--chunk-size`) at fixed total bytes — find the transfer/parallelism sweet spot for the 6-way fetch.
4. Then, and only then, size the streaming design: required upload bytes/s, tile budget, eviction rate.

Expected outcomes worth writing down in advance so the runs can falsify them: byte scaling dies in **wasm memory well before VRAM**; draw-call scaling degrades roughly linearly with a knee where per-item bind-group rebinding dominates; and `--split-items` at constant bytes shows most of the per-item cost is *not* the geometry.

## 5. What this changes about the earlier plan

The semantic/BIM tickets in doc 04 (S1–S9) are not what the manager is asking for. Under the new scope, the priority list from doc 03 is exactly right, with the benchmark first — **P1 (harness) → P2 (streaming upload) → P3/P4 (draw calls, culling) → P5 (instancing) → P7/P8 (LOD, tiling)**. The pick work already on the `wgpu-pick-semantic` branch is complete and self-contained; it costs nothing per frame (it only renders on a click), so it can sit until the semantic scope returns.
