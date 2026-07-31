---
name: pixeloffice-merge-orchestrator
description: "Orchestrates the PixelOffice merge agent team for three-pane layout (sidebar + board + Jacked watch + docked office), Jacked config strip, and post-green cleanup. Use for PixelOffice merge, three-pane layout, dock office, Jacked watch, harness merge runs — and always for follow-ups: run again, re-run, update, modify, supplement, just the layout/watch/office again, based on the previous result, improve the result."
---

# PixelOffice merge orchestrator

## Execution mode: Hybrid

- Layout/architecture consensus: agent team
- Parallel UI ports: sub-agents
- QA: incremental sub-agent after each module

## Agent composition

| Member | Skill | Output |
|--------|-------|--------|
| layout-architect | pixeloffice-layout | `01_layout-architect_contract.md` |
| kanban-shell-dev | pixeloffice-shell | shell code + `02_…_notes.md` |
| jacked-watch-dev | pixeloffice-jacked-ui | watch/config + `03_…_notes.md` |
| office-dock-dev | pixeloffice-office-dock | dock + `04_…_notes.md` |
| merge-qa | pixeloffice-review | `05_merge-qa_review.md` |

All Agent calls: `model: "opus"`. Definitions in `.claude/agents/`.

## Phase 0: Context check

1. If `_workspace/pixeloffice-merge/` missing → initial run.
2. Exists + partial fix request → re-invoke only relevant agents.
3. Exists + new full input → move folder to `_workspace/pixeloffice-merge_YYYYMMDD_HHMMSS/`, then fresh run.

## Phase 1: Preparation

Create `_workspace/pixeloffice-merge/`. Save brief under `00_input/`.

## Phase 2–4: Layout → implement → QA

1. layout-architect writes contract.
2. shell + jacked-watch + office-dock implement (parallel where independent).
3. merge-qa reviews after each module and once at end.

## Data passing

File-based artifacts + task list. Large diffs stay in git working tree; notes only in `_workspace/`.

## Error handling

Retry once; on second failure proceed and note omission. Do not delete conflicting data.

## Cleanup phase (after green only)

Per flatten plan: tree is `frontends/pixel_office` + `backends/runtime` + `backends/jacked`. Do **not** reintroduce nested `kanban/` or `claude-jacked-master/` donor folders.

## Test scenarios

**Normal:** home shows board + watch + office; refresh usage; toggle right column via Office button.

**Error:** stop jacked → watch offline, board+office still usable.

## Follow-up

Partial re-runs must read prior notes and only overwrite targeted artifacts.
