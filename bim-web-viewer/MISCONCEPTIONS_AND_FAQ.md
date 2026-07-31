# BIM & Web 3D — Common Misconceptions and FAQ

A plain-language guide to the wrong ideas people (understandably) have about BIM software and web-based 3D, and what's actually true.

## Misconceptions (myth -> reality)

**Myth 1: "BIM is just 3D modeling software for buildings."**
Reality: BIM is a *queryable information database* that happens to have a 3D view. The 3D is an index into the data. Strip the data out and it collapses into an ordinary 3D viewer.

**Myth 2: "OpenGL / WebGL / WebGPU are alternatives to game engines or BIM software."**
Reality: They are a *lower layer* — the graphics API that draws pixels. Modeling apps, game engines, and BIM software ALL render through them. They carry zero semantic meaning.

**Myth 3: "A 3D viewer plus a structure tree automatically becomes BIM software."**
Reality: Only if the tree is *populated* with real, linked, queryable data (types, property sets, relationships) AND geometry<->data selection works both ways. A hollow tree with labels is still just 3D.

**Myth 4: "Building a BIM viewer means building Revit."**
Reality: Two different classes. A *viewer/BI tool* (VCAD, Frame) reads and analyzes BIM — a weeks-to-months project. An *authoring tool* (Revit) creates BIM and needs a parametric/constraint engine — a company-scale effort.

**Myth 5: "Web viewers are smooth because they load the whole model into VRAM."**
Reality: The opposite. They are smooth because they load as LITTLE as possible — streaming only the visible slice, using LOD, culling, and eviction. Model size and VRAM usage are decoupled.

**Myth 6: "The ~4 GB JavaScript heap limit caps how big a model I can load."**
Reality: Geometry lives in ArrayBuffers / WASM linear memory — a *separate* allocator from the V8 object heap. The JS heap limit is not your geometry ceiling.

**Myth 7: "The 2 GB WebGPU limit is a spec-wide / per-device / per-VRAM cap."**
Reality: It's the max size of a *single* GPUBuffer, and it's adapter-dependent (the spec DEFAULT is only 256 MB; you raise it via requiredLimits). You can allocate many buffers up to total VRAM. Use many small per-batch buffers and you never hit it.

**Myth 8: "A model bigger than 2 GB can't be stored or rendered in a browser."**
Reality: It can. Instancing + quantization + compression usually shrink a 2 GB source to a few hundred MB of GPU data, and streaming keeps the resident set small regardless of total size.

**Myth 9: "When I zoom out, it loads and renders the whole model at full detail."**
Reality: No. LOD swaps tiny elements for coarse proxies (or drops them below a pixel threshold), and occlusion culling hides the interior. Zoom-out is often SMOOTHER than a mid-distance view.

**Myth 10: "Triangle count / FPS is the right way to measure a BIM model's limits."**
Reality: Partly. The real BIM bottleneck is *element count -> draw calls* and *data volume*, not triangles. 8 M triangles as 400k draw calls is far harder than 20 M triangles as 500 draw calls.

**Myth 11: "I have to build the IFC parser and streaming engine myself."**
Reality: The whole stack is open source: web-ifc / That Open Engine (parsing), xeokit (large-model rendering), 3D Tiles / Cesium (streaming), meshoptimizer / Draco (compression).

**Myth 12: "Coarse proxies are computed live in the browser."**
Reality: Mostly generated once, offline, on the server as an LOD chain. The browser just downloads the level it needs. (Bounding boxes are cheap enough to do live; mesh decimation is not.)

**Myth 13: "DoF (degrees of freedom / depth of field) measures how much a 3D model is limited."**
Reality: Wrong metric. Capacity is measured by triangles/frame, draw calls, element count, VRAM, and frame-time percentiles (1% lows), not DoF.

## FAQ

**Q: What is the single most important thing to get right?**
A: Decouple the render/input loop from the loader so the frame NEVER stalls. It's structural and painful to retrofit — build it first.

**Q: What gives the biggest performance win in a BIM viewer?**
A: Instancing + geometry merging, because the bottleneck is draw-call count, not triangles.

**Q: How do these viewers appear to load instantly?**
A: Progressive loading — show coarse proxies (blocks) immediately, then stream in and swap for real geometry, prioritizing what's in view. Much of "fast" is "never made you stare at nothing."

**Q: What decides when to show a coarse proxy vs full detail?**
A: Screen-space error (SSE): roughly (geometricError * screenHeight) / (2 * distance * tan(fov/2)). If the visual error would be below a pixel threshold, use the coarse version.

**Q: What is a coarse proxy?**
A: A cheap low-detail stand-in for an element (bounding box, decimated mesh, merged blob) used when full detail isn't worth drawing — far away, tiny on screen, or still loading.

**Q: WebGL or WebGPU?**
A: WebGPU. Lower draw-call overhead, compute shaders, modern GPU features — and draw-call overhead is exactly the BIM bottleneck.

**Q: What is the BIM-specific rendering gotcha?**
A: Buildings placed at real-world survey coordinates cause float32 jitter. Fix it with double-precision / relative-to-center (RTC) rendering.

**Q: Full-load or streaming architecture?**
A: Full-load (whole model resident) is simpler and fine if models fit in memory. Streaming (view + LOD) scales to unbounded models but you build the tiling/eviction machinery. Choose based on your target model sizes.
