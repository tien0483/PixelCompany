---
name: smr_orchestrator
description: "smr_outlet_pigtail applet work orchestrator. Handles feature/fix/debug/refactor/review requests for tools/applet_scripts/smr_outlet_pigtail — the live creep analysis and what-if entry points, pre/post-processing, workspace, sensor data, BigQuery/Pub-Sub upload, applet-call-applet, and the dashboard argument JSONs. Also for follow-up 'rerun/update/extend previous result' requests. Simple questions can be answered directly."
---

# smr_orchestrator — smr_outlet_pigtail Harness Orchestrator

Coordinates the smr_outlet_pigtail agent team (explore→implement→verify, fan-out
where independent). Defines **who collaborates in what order**; each agent file
defines who+how.

**Execution mode:** Agent team (default). 4 specialists + this orchestrator as leader.
Spawn sub-agents with the `Agent` tool, always `model: "opus"`, using the runtime in
each agent file's frontmatter.

## Team (definitions in `.agent/agents/`)
| Member | runtime | role | output |
|--------|---------|------|--------|
| smr-explorer | Explore | map applet scripts + dashboard JSON + tests, build boundary map | `_workspace/{phase}_explorer_*.md` |
| smr-applet | general-purpose | run_* entry points, pre/post-processing, workspace, sensor data | edited src + `_workspace/{phase}_applet_*.md` |
| smr-cloud | general-purpose | BigQuery/Pub-Sub upload, applet-call-applet, dashboard JSON | edited src + `_workspace/{phase}_cloud_*.md` |
| smr-qa | general-purpose | pytest + ruff + ty + forwarded-arg/gate boundary check | `_workspace/{phase}_qa_*.md` |

## Phase 0: Context check (init vs follow-up)
1. `.agent/_workspace/` exists + user asks partial revision → **partial re-run**
   (re-invoke only the affected agent, pass prior `_workspace/` file).
2. `_workspace/` exists + new input → **new run** (move old to `_workspace_prev/`).
3. No `_workspace/` → **initial run**.

## Workflow

**Phase 1 — Map (smr-explorer).**
Spawn smr-explorer with the request. It reads the applet source + dashboard JSON +
tests, writes a boundary map to `_workspace/01_explorer_*.md`. Block until the map
names every arg/function/CSV/cloud interface the change touches.
> Milestone: after the map, confirm direction with the user before implementing.

**Phase 2 — Implement (smr-applet and/or smr-cloud).**
Route by domain:
- pipeline / pre-post processing / workspace / sensor data / info defs → **smr-applet**
- BigQuery/Pub-Sub upload / applet-call-applet / dashboard JSON → **smr-cloud**
- change spans both (e.g. a run_* entry point that submits a child applet) → both,
  coordinating via SendMessage.
Independent edits run in parallel; dependent edits sequence. Implementers hand each
completed change to smr-qa immediately (incremental).

**Phase 3 — Verify (smr-qa), incremental.**
On each "ready for QA", smr-qa runs ruff/ty + the targeted pytest and the
forwarded-arg / gate boundary cross-check. Fail → SendMessage back to the
implementer with reproduction; loop (one retry per check, then report). QA blocks
final sign-off until green.

**Phase 4 — Synthesize.**
Leader reads all `_workspace/` outputs, summarizes changed files + verified
boundaries + any unresolved conflicts (sources cited, never deleted).

## Data-passing protocol
- **Task-based** (TaskCreate/TaskUpdate) for coordination + dependencies.
- **File-based** (`.agent/_workspace/{phase}_{agent}_{artifact}.md`) for artifacts.
- **Message-based** (SendMessage) for real-time hand-offs (ready-for-QA, fail reports).

## Error handling
- One retry, then proceed without that result and note the gap in the synthesis.
- Conflicting sources → report both with file:line; never silently pick or delete.
- Toolchain missing for QA → report verbatim; do not fabricate a pass.
- `scrbe/` in scope → HALT, refuse (proprietary, off-limits).

## Team size
4 members — medium task band. Keep it focused; do not spawn redundant agents.

## Test scenarios
- **Normal:** "after the live creep run succeeds, auto-launch the what-if applet for
  all units/types" → explorer maps run_creep_analysis gate + run_applet + what-if
  parser/JSON boundaries → smr-cloud adds the forwarded submit at the full-success
  gate → smr-qa asserts the captured payload + no-fire-on-partial → green → synthesis.
- **Error:** qa finds a forwarded flag name absent from the child parser → reports
  both file:lines → smr-cloud fixes the flag → qa re-verifies → green.
