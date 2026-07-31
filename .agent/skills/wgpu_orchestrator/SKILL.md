---
name: wgpu_orchestrator
description: "wgpu_renderer 작업 오케스트레이터. tools/wgpu_renderer (Rust+wgpu+WGSL) crate의 기능 추가·수정·디버그·리팩터·리뷰 요청을 처리한다. render stage, WGSL shader, pipeline/bind-group, RenderList dispatch, web_app.rs WASM 경계, View/UserControls 카메라, ColorBar/config 관련 작업, 그리고 '다시 실행/재실행/업데이트/수정/보완/이전 결과 기반' 후속 요청 시 이 스킬을 사용하라. 단순 질문은 직접 응답 가능."
---

# wgpu_orchestrator — wgpu_renderer Harness Orchestrator

Coordinates the wgpu_renderer agent team (generate→verify, fan-out where independent). Defines **who collaborates in what order**; each agent file defines who+how.

**Execution mode:** Agent team (default). 4 specialists + this orchestrator as leader.
Spawn sub-agents with the `Agent` tool, always `model: "opus"`, using the runtime in each agent file's frontmatter.

## Team (definitions in `.agent/agents/`)
| Member | runtime | role | output |
|--------|---------|------|--------|
| wgpu-explorer | Explore | map crate + WARP graph, build boundary map | `_workspace/{phase}_explorer_*.md` |
| wgpu-systems | general-purpose | GPU/render stages, WGSL, pipelines, buffers | edited src + `_workspace/{phase}_systems_*.md` |
| wgpu-web | general-purpose | web_app.rs WASM boundary, View/UserControls camera | edited src + `_workspace/{phase}_web_*.md` |
| wgpu-qa | general-purpose | cargo build/clippy/test (native+wasm32) + boundary cross-check | `_workspace/{phase}_qa_*.md` |

## Phase 0: Context check (init vs follow-up)
1. `.agent/_workspace/` exists + user asks partial revision → **partial re-run** (re-invoke only the affected agent, pass prior `_workspace/` file).
2. `_workspace/` exists + new input → **new run** (move old `_workspace/` to `_workspace_prev/`).
3. No `_workspace/` → **initial run**.

## Workflow

**Phase 1 — Map (wgpu-explorer).**
Spawn wgpu-explorer with the request. It reads `graphify-out/GRAPH_REPORT.md` + source, writes a boundary map to `_workspace/01_explorer_*.md`. Block until the map names every interface the change touches.
> Milestone: at ~20% (after the map) confirm direction with the user before implementing.

**Phase 2 — Implement (wgpu-systems and/or wgpu-web).**
Route by domain:
- render stage / WGSL / pipeline / buffer / geometry → **wgpu-systems**
- web_app.rs / wasm-bindgen / canvas / camera / input → **wgpu-web**
- crosses native↔WASM (shared config, render entry) → both, coordinating via SendMessage.
Independent edits run in parallel; dependent edits sequence. Implementers hand each completed module to wgpu-qa immediately (incremental).

**Phase 3 — Verify (wgpu-qa), incremental.**
On each "ready for QA", wgpu-qa runs build/clippy/test (+wasm32 if web path touched) and the boundary cross-check. Fail → SendMessage back to the implementer with reproduction; loop (one retry per check, then report). QA blocks final sign-off until green.

**Phase 4 — Synthesize.**
Leader reads all `_workspace/` outputs, summarizes changed files + verified boundaries + any unresolved conflicts (sources cited, never deleted).

## Data-passing protocol
- **Task-based** (TaskCreate/TaskUpdate) for coordination + dependencies.
- **File-based** (`.agent/_workspace/{phase}_{agent}_{artifact}.md`) for artifacts — preserved for audit.
- **Message-based** (SendMessage) for real-time hand-offs (ready-for-QA, fail reports).

## Error handling
- One retry, then proceed without that result and note the gap in the synthesis.
- Conflicting sources → report both with file:line; never silently pick or delete.
- Toolchain missing for QA → report verbatim; do not fabricate a pass.
- `scrbe/` in scope → HALT, refuse (proprietary, off-limits).

## Team size
4 members — medium task band. Keep it focused; do not spawn redundant agents.

## Test scenarios
- **Normal:** "add a wireframe overlay render stage" → explorer maps RenderList/pipelines/lib.rs boundaries → systems implements stage+WGSL+enum+dispatch → qa builds/clippy/tests + boundary check → green → synthesis.
- **Error:** qa finds `@binding(2)` in WGSL but bind-group layout defines only 0–1 → reports both file:lines → systems fixes index → qa re-verifies → green.
