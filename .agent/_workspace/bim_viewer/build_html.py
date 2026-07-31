# Copyright (C) 2026 Akselos
"""Bundles the bim_viewer workspace docs into one self-contained, offline HTML page.

The markdown is embedded rather than fetched, because `fetch()` on a `file://` page is blocked
by CORS — so the output is a single file you can double-click. Re-run after editing any doc:

    python build_html.py
"""
import json
from pathlib import Path

HERE = Path(__file__).parent

DOCS = [
    ('00_overview', 'Overview & research', None),
    ('01_explorer_wgpu_bim_gap', 'Audit: crate vs BIM plan', '01_explorer_wgpu_bim_gap.md'),
    ('02_design_semantic_layer', 'Design: semantic layer', '02_design_semantic_layer.md'),
    ('03_design_large_model', 'Design: large models', '03_design_large_model.md'),
    ('04_jira_journey_and_tickets', 'Jira journey & tickets', '04_jira_journey_and_tickets.md'),
    ('05_benchmark_and_limits', 'Benchmark & limits', '05_benchmark_and_limits.md'),
    ('06_instancing_and_merging', 'Instancing & merging (code)', '06_instancing_and_merging.md'),
    ('SUMMARY', 'Research: summary', 'SUMMARY.md'),
    ('MISCONCEPTIONS_AND_FAQ', 'Research: misconceptions', 'MISCONCEPTIONS_AND_FAQ.md'),
]

OVERVIEW = """# Web BIM viewer / `wgpu_renderer` — working set

Everything produced in the 2026-07-29 session, in reading order. Diagrams are under
**Diagrams** in the sidebar.

| Doc | What it answers |
| --- | --- |
| Audit | What `tools/wgpu_renderer` actually is, and where it stands against the BIM plan. Every claim has a `file:line`. |
| Semantic layer | How click-to-data gets built, and why most of it already exists one layer up in Python. |
| Large models | What actually limits big models. Two corrections to the audit. |
| Jira journey | Epic AKS-18576's 34 children, the AKS-18641 picking decisions, and the ticket list. |
| Benchmark & limits | The synthetic benchmark design, and the 100 GB maths. |
| Instancing & merging | Plan step 5 unpacked, with the proposed code. Not applied. |
| Research | The original conclusions, plan and misconceptions list. |

## The short version

1. The crate is a **FEA result viewer**, not a scene graph. It solves the pre-tessellation and
   transport half of the BIM plan and none of the semantic or "load less" halves.
2. It runs **WebGL2**, not WebGPU — `use_webgl = true` is a hardcoded local, not a cfg.
3. Per-element **identity already exists** upstream: `pick_ref` → `pick_color_map` →
   `PickRenderStage` items whose colour *is* the id. Two lines throw it away. But today's
   exports may carry no pick items at all, which is a blocking prerequisite.
4. The wall for large models is the **load path**, not the renderer: peak residency is ~3x the
   geometry in wasm32 linear memory against a 4 GB cap.
5. A **100 GB model is ~100x past three independent walls** (network time, residency, draw
   calls). It needs the resident set decoupled from model size. The benchmark's job is to
   measure each wall so the tiling budget follows from data.
"""

SEQUENCE_SVG = """
<svg viewBox="0 0 980 640" xmlns="http://www.w3.org/2000/svg" class="diagram">
  <style>
    .lane { fill: #f4f6f8; stroke: #c9d1d9; }
    .lane-label { font: 600 12px system-ui; fill: #24292f; }
    .lifeline { stroke: #c9d1d9; stroke-dasharray: 4 4; }
    .msg { stroke: #24292f; fill: none; marker-end: url(#arrow); }
    .msg-blocked { stroke: #b42318; }
    .lbl { font: 11px ui-monospace, monospace; fill: #24292f; }
    .lbl-bad { font: 11px ui-monospace, monospace; fill: #b42318; }
    .note { font: 11px system-ui; fill: #57606a; }
    .freeze { fill: #fdecea; stroke: #b42318; }
    .ok { fill: #e6f4ea; stroke: #1a7f37; }
  </style>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#24292f"/>
    </marker>
  </defs>

  <text x="10" y="18" class="lane-label">Load path today — one blocking task (web_app.rs:293-318)</text>

  <g>
    <rect class="lane" x="20"  y="34" width="120" height="26" rx="4"/><text x="34" y="51" class="lane-label">React / JS</text>
    <rect class="lane" x="200" y="34" width="120" height="26" rx="4"/><text x="222" y="51" class="lane-label">HTTP / CDN</text>
    <rect class="lane" x="380" y="34" width="140" height="26" rx="4"/><text x="396" y="51" class="lane-label">wasm (Rust)</text>
    <rect class="lane" x="580" y="34" width="140" height="26" rx="4"/><text x="600" y="51" class="lane-label">wasm memory</text>
    <rect class="lane" x="780" y="34" width="140" height="26" rx="4"/><text x="806" y="51" class="lane-label">GPU (WebGL2)</text>
  </g>
  <line class="lifeline" x1="80"  y1="60" x2="80"  y2="600"/>
  <line class="lifeline" x1="260" y1="60" x2="260" y2="600"/>
  <line class="lifeline" x1="450" y1="60" x2="450" y2="600"/>
  <line class="lifeline" x1="650" y1="60" x2="650" y2="600"/>
  <line class="lifeline" x1="850" y1="60" x2="850" y2="600"/>

  <path class="msg" d="M80,90 L255,90"/>
  <text x="90" y="84" class="lbl">fetch render_group.avro</text>
  <path class="msg" d="M260,120 L445,120"/>
  <text x="270" y="114" class="lbl">new RenderDataLoader(bytes)</text>
  <path class="msg" d="M80,150 L255,150"/>
  <text x="90" y="144" class="lbl">fetch .partNNN x N (6-way parallel)</text>

  <rect class="freeze" x="400" y="180" width="100" height="300" rx="4" opacity="0.35"/>
  <text x="404" y="196" class="lbl-bad">main thread</text>
  <text x="404" y="209" class="lbl-bad">FROZEN</text>

  <path class="msg msg-blocked" d="M450,230 L645,230"/>
  <text x="460" y="224" class="lbl-bad">push_chunk + md5 (8 MiB each)</text>
  <text x="660" y="234" class="note">copy 1: unmerged_chunks</text>

  <path class="msg msg-blocked" d="M450,275 L645,275"/>
  <text x="460" y="269" class="lbl-bad">finalize_chunks (needs ALL)</text>
  <text x="660" y="279" class="note">copy 2: concatenated blob</text>

  <path class="msg msg-blocked" d="M450,320 L645,320"/>
  <text x="460" y="314" class="lbl-bad">avro parse -> descriptors</text>

  <path class="msg msg-blocked" d="M650,365 L845,365"/>
  <text x="660" y="359" class="lbl-bad">create_buffer_init(whole blob)</text>
  <text x="600" y="392" class="note">copy 3: staging  =&gt;  peak ~3x geometry</text>

  <path class="msg msg-blocked" d="M450,430 L845,430"/>
  <text x="460" y="424" class="lbl-bad">first frame forced (web_app.rs:312)</text>

  <path class="msg" d="M80,470 L255,470" opacity="0.35"/>
  <text x="90" y="464" class="note">progress reported 100% here — BEFORE finalize+upload (B2)</text>

  <text x="10" y="520" class="lane-label">After P2 — pre-allocate from array_descriptors, write_buffer per chunk</text>
  <rect class="ok" x="400" y="536" width="100" height="46" rx="4" opacity="0.35"/>
  <text x="404" y="552" class="lbl">peak =</text>
  <text x="404" y="565" class="lbl">1 chunk</text>
  <path class="msg" d="M450,556 L845,556"/>
  <text x="460" y="550" class="lbl">write_buffer(offset, chunk) as each lands</text>
  <text x="500" y="596" class="note">sizes+offsets are known up front from array_descriptors, so no concat and no staging copy</text>
</svg>
"""

PICK_SEQUENCE_SVG = """
<svg viewBox="0 0 980 470" xmlns="http://www.w3.org/2000/svg" class="diagram">
  <style>
    .lane { fill: #f4f6f8; stroke: #c9d1d9; }
    .lane-label { font: 600 12px system-ui; fill: #24292f; }
    .lifeline { stroke: #c9d1d9; stroke-dasharray: 4 4; }
    .msg { stroke: #24292f; fill: none; marker-end: url(#arrow2); }
    .lbl { font: 11px ui-monospace, monospace; fill: #24292f; }
    .note { font: 11px system-ui; fill: #57606a; }
    .done { fill: #e6f4ea; stroke: #1a7f37; }
    .todo { fill: #fff8e1; stroke: #9a6700; }
  </style>
  <defs>
    <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#24292f"/>
    </marker>
  </defs>
  <text x="10" y="18" class="lane-label">Click-to-data — green = built on branch wgpu-pick-semantic, amber = remaining</text>

  <rect class="lane" x="20"  y="34" width="130" height="26" rx="4"/><text x="34" y="51" class="lane-label">HUI export (py)</text>
  <rect class="lane" x="220" y="34" width="130" height="26" rx="4"/><text x="243" y="51" class="lane-label">React host</text>
  <rect class="lane" x="420" y="34" width="150" height="26" rx="4"/><text x="440" y="51" class="lane-label">wasm renderer</text>
  <rect class="lane" x="640" y="34" width="150" height="26" rx="4"/><text x="660" y="51" class="lane-label">pick texture</text>
  <rect class="lane" x="840" y="34" width="120" height="26" rx="4"/><text x="856" y="51" class="lane-label">properties UI</text>

  <line class="lifeline" x1="85"  y1="60" x2="85"  y2="440"/>
  <line class="lifeline" x1="285" y1="60" x2="285" y2="440"/>
  <line class="lifeline" x1="495" y1="60" x2="495" y2="440"/>
  <line class="lifeline" x1="715" y1="60" x2="715" y2="440"/>
  <line class="lifeline" x1="900" y1="60" x2="900" y2="440"/>

  <rect class="done" x="30" y="80" width="110" height="34" rx="4"/>
  <text x="38" y="95" class="lbl">pick_ref -&gt;</text>
  <text x="38" y="108" class="lbl">encode_padic</text>
  <path class="msg" d="M85,140 L490,140"/>
  <text x="95" y="134" class="lbl">PickRenderStage items (colour = id)  [S2: may be EMPTY today]</text>
  <path class="msg" d="M85,175 L280,175"/>
  <text x="95" y="169" class="lbl">pick_map.json {id: stable_id, pick, key_path}</text>

  <path class="msg" d="M285,215 L490,215"/>
  <text x="295" y="209" class="lbl">left click (x, y)</text>
  <text x="300" y="231" class="note">triad picked first; only a miss falls through to the scene</text>

  <path class="msg" d="M495,260 L710,260"/>
  <text x="505" y="254" class="lbl">render pick bundle (on click only)</text>
  <path class="msg" d="M715,295 L500,295"/>
  <text x="520" y="289" class="lbl">copy_texture_to_buffer + map_async -&gt; 1 texel</text>
  <text x="505" y="315" class="note">WebGL2: read_pixels into PIXEL_PACK_BUFFER, then getBufferSubData</text>

  <path class="msg" d="M490,350 L290,350"/>
  <text x="300" y="344" class="lbl">on_pick(element_id | null)</text>
  <rect class="todo" x="840" y="372" width="115" height="34" rx="4"/>
  <text x="848" y="387" class="lbl">S3: resolve id</text>
  <text x="848" y="400" class="lbl">-&gt; panel</text>
  <path class="msg" d="M285,389 L835,389"/>
  <text x="295" y="383" class="lbl">look up id in pick_map.json (host owns the map)</text>
</svg>
"""

ERD_SVG = """
<svg viewBox="0 0 980 620" xmlns="http://www.w3.org/2000/svg" class="diagram">
  <style>
    .ent { fill: #ffffff; stroke: #24292f; }
    .hdr { fill: #eaeef2; stroke: #24292f; }
    .ent-name { font: 600 12px system-ui; fill: #24292f; }
    .fld { font: 11px ui-monospace, monospace; fill: #24292f; }
    .pk { font: 700 11px ui-monospace, monospace; fill: #0969da; }
    .rel { stroke: #57606a; fill: none; marker-end: url(#crow); }
    .rel-lbl { font: 10px system-ui; fill: #57606a; }
    .note { font: 11px system-ui; fill: #57606a; }
    .gap { fill: #fff8e1; stroke: #9a6700; stroke-dasharray: 4 3; }
  </style>
  <defs>
    <marker id="crow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10" fill="none" stroke="#57606a"/>
    </marker>
  </defs>
  <text x="10" y="18" class="ent-name">Wire format (render_group.avro) and where identity is lost</text>

  <!-- RenderGroup -->
  <g>
    <rect class="hdr" x="20" y="40" width="200" height="22" rx="3"/>
    <text x="28" y="56" class="ent-name">RenderGroup</text>
    <rect class="ent" x="20" y="62" width="200" height="58"/>
    <text x="28" y="78" class="fld">render_items[]</text>
    <text x="28" y="94" class="fld">array_descriptors[]</text>
    <text x="28" y="110" class="fld">array_chunks[]?</text>
  </g>

  <!-- RenderItem -->
  <g>
    <rect class="hdr" x="300" y="40" width="240" height="22" rx="3"/>
    <text x="308" y="56" class="ent-name">RenderItem</text>
    <rect class="ent" x="300" y="62" width="240" height="140"/>
    <text x="308" y="78" class="fld">render_stage (8 variants, 5 dead)</text>
    <text x="308" y="94" class="fld">vertices_id / indices_id  -&gt; array</text>
    <text x="308" y="110" class="fld">normals_id / scalar_values_id</text>
    <text x="308" y="126" class="fld">model_from_local_id -&gt; array</text>
    <text x="308" y="142" class="fld">color[4]</text>
    <text x="308" y="158" class="fld">indices_start_row / end_row</text>
    <text x="308" y="174" class="fld">primitive_size, should_clip</text>
    <text x="308" y="192" class="note">no id, no name, no type, no parent</text>
  </g>

  <!-- ArrayDescriptor -->
  <g>
    <rect class="hdr" x="620" y="40" width="230" height="22" rx="3"/>
    <text x="628" y="56" class="ent-name">ArrayDescriptor</text>
    <rect class="ent" x="620" y="62" width="230" height="90"/>
    <text x="628" y="78" class="pk">array_id  (PK)</text>
    <text x="628" y="94" class="fld">dtype: Float32|Uint16|Uint32</text>
    <text x="628" y="110" class="fld">shape[]</text>
    <text x="628" y="126" class="fld">buffer_type: Vertex|Index|</text>
    <text x="628" y="142" class="fld">              Scalar|Other</text>
  </g>
  <text x="620" y="172" class="note">list ORDER is load-bearing: offsets</text>
  <text x="620" y="186" class="note">accumulate in list order</text>

  <!-- ArrayChunk -->
  <g>
    <rect class="hdr" x="620" y="215" width="230" height="22" rx="3"/>
    <text x="628" y="231" class="ent-name">ArrayChunk</text>
    <rect class="ent" x="620" y="237" width="230" height="58"/>
    <text x="628" y="253" class="fld">name (.partNNN)</text>
    <text x="628" y="269" class="fld">size</text>
    <text x="628" y="285" class="fld">checksum (md5)</text>
  </g>

  <!-- ItemKey -->
  <g>
    <rect class="hdr" x="300" y="250" width="240" height="22" rx="3"/>
    <text x="308" y="266" class="ent-name">ItemKey  (GPU-side, render_list.rs)</text>
    <rect class="ent" x="300" y="272" width="240" height="58"/>
    <text x="308" y="288" class="fld">model_from_local_id</text>
    <text x="308" y="304" class="fld">color</text>
    <text x="308" y="322" class="note">DEDUPES items -&gt; identity destroyed</text>
  </g>

  <!-- pick side -->
  <g>
    <rect class="hdr" x="20" y="380" width="250" height="22" rx="3"/>
    <text x="28" y="396" class="ent-name">graphics_face (HUI, python)</text>
    <rect class="ent" x="20" y="402" width="250" height="58"/>
    <text x="28" y="418" class="pk">pick_ref  (the real identity)</text>
    <text x="28" y="434" class="fld">color, primitive_size, render_type</text>
    <text x="28" y="450" class="fld">start_idx / end_idx</text>
  </g>

  <g>
    <rect class="hdr" x="330" y="380" width="230" height="22" rx="3"/>
    <text x="338" y="396" class="ent-name">pick_color_map</text>
    <rect class="ent" x="330" y="402" width="230" height="42"/>
    <text x="338" y="418" class="pk">idx (random per export)</text>
    <text x="338" y="434" class="fld">-&gt; Pick</text>
  </g>

  <g>
    <rect class="hdr" x="620" y="380" width="230" height="22" rx="3"/>
    <text x="628" y="396" class="ent-name">pick_map.json  (NEW)</text>
    <rect class="ent" x="620" y="402" width="230" height="74"/>
    <text x="628" y="418" class="pk">id  (= decoded pick colour)</text>
    <text x="628" y="434" class="fld">stable_id  (survives re-export)</text>
    <text x="628" y="450" class="fld">pick {code, component_id, ...}</text>
    <text x="628" y="466" class="fld">key_path[]  (the hierarchy)</text>
  </g>

  <g>
    <rect class="gap" x="330" y="505" width="520" height="70" rx="4"/>
    <text x="342" y="527" class="ent-name">Still missing for "it is BIM"</text>
    <text x="342" y="547" class="fld">element_id on RenderItem  |  parent/child tree  |  property sets</text>
    <text x="342" y="565" class="fld">id -&gt; item index for highlight  |  query/aggregate layer</text>
  </g>

  <path class="rel" d="M220,80 L295,80"/><text x="228" y="74" class="rel-lbl">1..N</text>
  <path class="rel" d="M220,96 L615,96" opacity="0.5"/><text x="440" y="90" class="rel-lbl">1..N</text>
  <path class="rel" d="M220,112 L615,240" opacity="0.5"/>
  <path class="rel" d="M540,110 L615,100"/><text x="548" y="122" class="rel-lbl">FK array_id</text>
  <path class="rel" d="M420,205 L420,245"/><text x="428" y="228" class="rel-lbl">grouped by</text>
  <path class="rel" d="M270,425 L325,425"/><text x="276" y="419" class="rel-lbl">1..1</text>
  <path class="rel" d="M560,420 L615,420"/><text x="566" y="414" class="rel-lbl">serialised</text>
  <path class="rel" d="M420,378 L420,340" opacity="0.6"/>
  <text x="428" y="360" class="rel-lbl">colour carries idx</text>
</svg>
"""

KNOBS_SVG = """
<svg viewBox="0 0 980 420" xmlns="http://www.w3.org/2000/svg" class="diagram">
  <style>
    .box { fill: #ffffff; stroke: #24292f; }
    .hd { font: 600 12px system-ui; fill: #24292f; }
    .fld { font: 11px ui-monospace, monospace; fill: #24292f; }
    .note { font: 11px system-ui; fill: #57606a; }
    .b1 { fill: #e7f0fd; stroke: #0969da; }
    .b2 { fill: #fdecea; stroke: #b42318; }
    .b3 { fill: #e6f4ea; stroke: #1a7f37; }
    .axis { stroke: #57606a; marker-end: url(#a3); }
  </style>
  <defs>
    <marker id="a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#57606a"/>
    </marker>
  </defs>
  <text x="10" y="18" class="hd">synth_bench.py — three orthogonal knobs, so you learn which wall binds first</text>

  <rect class="b1" x="20" y="40" width="300" height="150" rx="5"/>
  <text x="32" y="60" class="hd">--ballast N</text>
  <text x="32" y="80" class="fld">bytes UP, draw calls FLAT</text>
  <text x="32" y="100" class="note">duplicate arrays referenced by no item;</text>
  <text x="32" y="116" class="note">ArrayBundle uploads every descriptor,</text>
  <text x="32" y="132" class="note">only items reach a draw_indexed</text>
  <text x="32" y="158" class="fld">tests: wasm cap, upload, VRAM</text>
  <text x="32" y="176" class="fld">verified: 200x -&gt; 252 MiB, 8 draws</text>

  <rect class="b2" x="340" y="40" width="300" height="150" rx="5"/>
  <text x="352" y="60" class="hd">--instances N</text>
  <text x="352" y="80" class="fld">draw calls UP, bytes ~FLAT</text>
  <text x="352" y="100" class="note">clone items with fresh transforms</text>
  <text x="352" y="116" class="note">(+64 B each), on a cubic lattice</text>
  <text x="352" y="158" class="fld">tests: draws + bind-group churn</text>
  <text x="352" y="176" class="fld">verified: 50x -&gt; 400 draws, +25 KB</text>

  <rect class="b3" x="660" y="40" width="300" height="150" rx="5"/>
  <text x="672" y="60" class="hd">--split-items K</text>
  <text x="672" y="80" class="fld">draw calls UP, bytes IDENTICAL</text>
  <text x="672" y="100" class="note">cut each item's index-row range into</text>
  <text x="672" y="116" class="note">K items — same pixels, K x the draws</text>
  <text x="672" y="158" class="fld">tests: PURE draw-call overhead</text>
  <text x="672" y="176" class="fld">verified: 4x -&gt; 32 draws, same bytes</text>

  <line class="axis" x1="60" y1="380" x2="900" y2="380"/>
  <text x="60" y="400" class="note">1.3 MiB (seed)</text>
  <text x="420" y="400" class="note">~1 GB — expected wasm death zone (3x peak vs 4 GB cap)</text>
  <text x="800" y="400" class="note">100 GB target</text>
  <line x1="470" y1="360" x2="470" y2="386" stroke="#b42318" stroke-width="2"/>
  <line x1="880" y1="360" x2="880" y2="386" stroke="#9a6700" stroke-width="2"/>
  <text x="60" y="250" class="hd">Three walls to 100 GB, each ~2 orders of magnitude out</text>
  <text x="60" y="274" class="fld">1. network  — 100 GB @ 100 Mbps = ~2.2 h, and the loader needs EVERY chunk before drawing</text>
  <text x="60" y="294" class="fld">2. residency — peak ~3x geometry in wasm32 (4 GB cap) =&gt; ~0.7-1.0 GB today; fixing it moves the wall to VRAM (8-24 GB)</text>
  <text x="60" y="314" class="fld">3. draw calls — ~1e5-1e6 elements at 1 draw each, no instancing, no culling</text>
  <text x="60" y="340" class="note">=&gt; 100 GB is not a tuning problem. Resident set must be decoupled from model size (tiling + LOD + eviction).</text>
</svg>
"""

DIAGRAMS = [
    ('diag_load', 'Load path (sequence)', SEQUENCE_SVG),
    ('diag_pick', 'Click-to-data (sequence)', PICK_SEQUENCE_SVG),
    ('diag_erd', 'Wire format (ERD)', ERD_SVG),
    ('diag_knobs', 'Benchmark knobs & walls', KNOBS_SVG),
]

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wgpu_renderer / BIM viewer — working set</title>
<style>
  :root { --bg:#ffffff; --fg:#1f2328; --muted:#57606a; --line:#d0d7de; --accent:#0969da; --code:#f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#30363d; --accent:#4493f8; --code:#161b22; }
    .diagram { background:#e9eef3; border-radius:6px; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  #layout { display:flex; min-height:100vh; }
  nav { width:290px; flex:0 0 290px; border-right:1px solid var(--line); padding:20px 0; position:sticky; top:0; height:100vh; overflow-y:auto; }
  nav h2 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:20px 20px 8px; }
  nav a { display:block; padding:7px 20px; color:var(--fg); text-decoration:none; font-size:14px; border-left:3px solid transparent; }
  nav a:hover { background:var(--code); }
  nav a.active { border-left-color:var(--accent); color:var(--accent); font-weight:600; background:var(--code); }
  main { flex:1; min-width:0; padding:36px 48px 120px; max-width:1100px; }
  h1 { font-size:26px; margin:0 0 18px; padding-bottom:10px; border-bottom:1px solid var(--line); }
  h2 { font-size:20px; margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  h3 { font-size:16px; margin:24px 0 8px; }
  table { border-collapse:collapse; width:100%; margin:16px 0; font-size:13.5px; display:block; overflow-x:auto; }
  th,td { border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top; }
  th { background:var(--code); font-weight:600; }
  code { background:var(--code); padding:.15em .4em; border-radius:4px; font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace; }
  pre { background:var(--code); padding:14px; border-radius:6px; overflow-x:auto; }
  pre code { background:none; padding:0; }
  a { color:var(--accent); }
  blockquote { margin:16px 0; padding:0 16px; border-left:3px solid var(--line); color:var(--muted); }
  .diagram { width:100%; height:auto; margin:18px 0; }
  .doc { display:none; }
  .doc.active { display:block; }
  hr { border:0; border-top:1px solid var(--line); margin:28px 0; }
  ul,ol { padding-left:24px; }
  .meta { color:var(--muted); font-size:13px; margin-bottom:24px; }
</style>
</head>
<body>
<div id="layout">
  <nav>
    <h2>Documents</h2>
    <div id="doc-nav"></div>
    <h2>Diagrams</h2>
    <div id="diag-nav"></div>
  </nav>
  <main id="content"></main>
</div>

<script id="payload" type="application/json">__PAYLOAD__</script>
<script>
// Minimal markdown renderer: enough for these docs (headings, tables, code, lists, links,
// bold/italic/inline code, blockquotes, hr). Deliberately dependency-free so the page works
// offline from file://.
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function inline(s){
  return esc(s)
    .replace(/`([^`]+)`/g, (m,c)=>'<code>'+c+'</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/(^|[\\s(])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');
}
function splitRow(line){
  return line.replace(/^\\||\\|$/g,'').split('|').map(c=>c.trim());
}
function render(md){
  const lines = md.split(/\\r?\\n/);
  let out=[], i=0;
  while(i<lines.length){
    const line = lines[i];
    if(/^```/.test(line)){
      let buf=[]; i++;
      while(i<lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push('<pre><code>'+esc(buf.join('\\n'))+'</code></pre>');
      continue;
    }
    if(/^\\s*\\|.*\\|\\s*$/.test(line) && i+1<lines.length && /^\\s*\\|[\\s:|-]+\\|\\s*$/.test(lines[i+1])){
      const head = splitRow(line); i+=2;
      let rows=[];
      while(i<lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
      out.push('<table><thead><tr>'+head.map(h=>'<th>'+inline(h)+'</th>').join('')+'</tr></thead><tbody>'
        + rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');
      continue;
    }
    let m;
    if((m = line.match(/^(#{1,6})\\s+(.*)$/))){
      const lvl = m[1].length;
      out.push('<h'+lvl+'>'+inline(m[2])+'</h'+lvl+'>'); i++; continue;
    }
    if(/^\\s*([-*_])\\1{2,}\\s*$/.test(line)){ out.push('<hr>'); i++; continue; }
    if(/^\\s*[-*]\\s+/.test(line)){
      let items=[];
      while(i<lines.length && /^\\s*[-*]\\s+/.test(lines[i])) items.push(lines[i++].replace(/^\\s*[-*]\\s+/,''));
      out.push('<ul>'+items.map(t=>'<li>'+inline(t)+'</li>').join('')+'</ul>');
      continue;
    }
    if(/^\\s*\\d+\\.\\s+/.test(line)){
      let items=[];
      while(i<lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])) items.push(lines[i++].replace(/^\\s*\\d+\\.\\s+/,''));
      out.push('<ol>'+items.map(t=>'<li>'+inline(t)+'</li>').join('')+'</ol>');
      continue;
    }
    if(/^\\s*>\\s?/.test(line)){
      let buf=[];
      while(i<lines.length && /^\\s*>\\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\\s*>\\s?/,''));
      out.push('<blockquote>'+inline(buf.join(' '))+'</blockquote>');
      continue;
    }
    if(!line.trim()){ i++; continue; }
    let buf=[];
    while(i<lines.length && lines[i].trim() && !/^(#{1,6}\\s|```|\\s*[-*]\\s|\\s*\\d+\\.\\s|\\s*>|\\s*\\|)/.test(lines[i])) buf.push(lines[i++]);
    out.push('<p>'+inline(buf.join(' '))+'</p>');
  }
  return out.join('\\n');
}

const payload = JSON.parse(document.getElementById('payload').textContent);
const content = document.getElementById('content');
const panes = {};

function addPane(id, htmlBody){
  const div = document.createElement('div');
  div.className = 'doc'; div.id = 'pane-'+id;
  div.innerHTML = htmlBody;
  content.appendChild(div);
  panes[id] = div;
}
payload.docs.forEach(d => addPane(d.id, render(d.md)));
payload.diagrams.forEach(d => addPane(d.id, '<h1>'+d.title+'</h1>'+d.svg));

function buildNav(target, entries){
  const box = document.getElementById(target);
  entries.forEach(e => {
    const a = document.createElement('a');
    a.href = '#'+e.id; a.textContent = e.title; a.dataset.id = e.id;
    box.appendChild(a);
  });
}
buildNav('doc-nav', payload.docs);
buildNav('diag-nav', payload.diagrams);

function show(id){
  Object.values(panes).forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.id === id));
  (panes[id] || panes[payload.docs[0].id]).classList.add('active');
  content.scrollTop = 0; window.scrollTo(0,0);
}
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1) || payload.docs[0].id);
</script>
</body>
</html>
"""


def main() -> None:
    docs = []
    for doc_id, title, filename in DOCS:
        if filename is None:
            md = OVERVIEW
        else:
            path = HERE / filename
            if not path.exists():
                print(f'skip (missing): {filename}')
                continue
            md = path.read_text(encoding='utf-8')
        docs.append({'id': doc_id, 'title': title, 'md': md})

    diagrams = [{'id': d_id, 'title': title, 'svg': svg} for d_id, title, svg in DIAGRAMS]
    payload = json.dumps({'docs': docs, 'diagrams': diagrams})
    # Keep the JSON from terminating the <script> block early. `\/` is a legal JSON escape and
    # parses back to `/`; do NOT try to escape `<!--` the same way, because `\!` is not a legal
    # JSON escape and breaks JSON.parse for the whole payload.
    payload = payload.replace('</script>', '<\\/script>')

    out_path = HERE / 'index.html'
    out_path.write_text(PAGE.replace('__PAYLOAD__', payload), encoding='utf-8')
    total_kb = round(out_path.stat().st_size / 1024, 1)
    print(f'wrote {out_path} ({total_kb} KB, {len(docs)} docs, {len(diagrams)} diagrams)')


if __name__ == '__main__':
    main()
