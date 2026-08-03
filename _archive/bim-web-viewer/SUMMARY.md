# Web-Based BIM Viewer — Findings & Wrap-Up

_Research summary. Goal: build our own web-based BIM viewer / BI app (like VCAD and bimframe.co / "Frame")._

## What we set out to understand
1. What makes BIM software different from a 3D game engine and a 3D modeling app.
2. Where OpenGL / WebGL / WebGPU sit in that picture.
3. How web viewers (VCAD, Frame) load huge models so smoothly.
4. How to handle memory limits (the "2 GB" question).
5. How the load/render pipeline actually works (LOD, coarse proxies, streaming).

## The core conclusions

**1. BIM = a queryable information model that happens to have 3D.**
A modeling app stores what a building *looks like*; a game engine stores how a scene *behaves in real time*; BIM stores what a building *is*. Geometry is the least important part — the value is the semantic data.

**2. Three independent axes (don't confuse them).**
- *Semantic maturity*: modeling app -> game engine -> BIM (how much meaning the model carries).
- *Rendering stack*: Hardware -> Driver -> Graphics API -> Engine -> App.
- *API generation*: OpenGL (1992) -> WebGL (2011) -> WebGPU (2023+).
OpenGL/WebGL/WebGPU are the **Graphics API layer** — the shared substrate EVERYTHING renders through. They are NOT alternatives to BIM/engine software.

**3. The litmus test for "is it BIM or just 3D?"**
Can you ask the model a question and get a *data* answer, and does clicking geometry reveal structured attributes? Yes -> BIM. Only renders form -> 3D.

**4. Viewer/BI class vs authoring class.**
We are building the viewer/BI class (VCAD, Frame) = 3D + queryable semantic graph. NOT the authoring class (Revit) = a parametric/constraint engine (company-scale effort).

**5. Smoothness comes from loading LESS, not packing MORE.**
Web viewers are smooth because they never hold the whole model. Model size and VRAM usage are DECOUPLED via streaming + LOD + culling + instancing + eviction. The resident working set stays ~1-2 GB regardless of total model size.

**6. The one architectural rule.**
Two worlds on two clocks: a render/input loop that NEVER stalls, and an async loader (fetch -> worker-decode -> time-budgeted upload -> evict) feeding it through a queue.

**7. The "2 GB" limit is mostly a non-issue.**
- Source file size != GPU footprint (instancing + quantization + compression shrink it a lot).
- You don't hold the whole model resident anyway (streaming).
- The 2 GB cap is per single GPUBuffer, not per device or per VRAM. Use many small per-batch buffers and you never hit it.

## Architecture in one paragraph
A web BIM viewer is a 3D scene acting as a visual index into a queryable semantic graph. A server pre-tessellates, instances, compresses, and tiles the model; the browser runs two decoupled worlds (never-stalling render loop + async loader) and uses instancing, culling, LOD, and coarse proxies (all gated by screen-space error) to draw only the visible slice. What makes it BIM rather than 3D is the semantic layer: every element carries a stable ID, type, property sets, and relationships you can filter, aggregate, and chart.

## Recommended open-source stack
- **web-ifc / That Open Engine** — parse IFC, get geometry + semantic graph (+ Fragments streaming).
- **xeokit-sdk** — reference implementation for large BIM models (study its code).
- **three.js + WebGPU** — renderer (WebGPU for low draw-call overhead).
- **3D Tiles / CesiumJS** — streaming standard.
- **meshoptimizer / Draco / glTF** — compression + LOD generation.
- **IfcOpenShell** — server-side pre-processing.
- **buildingSMART IFC spec** — the data model.

## Key gotcha to handle early
Real-world survey coordinates cause float32 jitter/wobble -> use double-precision / relative-to-center (RTC) rendering (see how xeokit/Cesium do it).

## Next step
Build the foundation: web-ifc + three.js rendering a small IFC with a semantic tree + click-to-data. Then add the query/dashboard layer (the thing that makes it BIM), then performance (instancing -> culling -> LOD -> streaming).
