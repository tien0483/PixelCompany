---
name: project-harness
description: "Harnesses a project, module, or ticket scope into a shareable SPEC document — a durable 'second memory' that captures the project's purpose, architecture, public API surface, data models, and end-to-end workflow so another engineer or developer can get productive without re-reading the whole codebase. Use it when the user says 'harness this project', 'create a spec for <project>', 'document the <project> API/workflow', 'onboard me / a teammate onto <project>', 'review the <project> project' (as a precursor to a task), or wants a shareable knowledge doc for a folder like tools/applet_scripts/<name>. Also use to update/refresh an existing spec when the project changed. The generated spec is stored under this skill's spec/ folder and points back at the real project folder."
---

# Project Harness — Project → Shareable SPEC

Turn a real project folder (or a ticket/task scope) into a **SPEC**: a self-contained, shareable document that records everything a teammate needs to understand the project — its purpose, architecture, public API, data shapes, and workflow. Think of the spec as a **second memory** that lives outside any single chat session and can be handed to another engineer, or fed to the `prd` skill as context for a new task.

**Core principles:**
1. **The spec is shareable and self-contained.** A developer who has never opened the code should be able to read the spec and know what the project does, how it is wired, and where to start.
2. **The spec points at the real project.** Every spec records the absolute-in-repo path of the project folder it describes and links to concrete files with `path:line`. The spec is a map, not a copy — it references source, it does not duplicate it.
3. **The spec is durable and updatable.** It lives on disk under `spec/<project-name>/`, survives sessions, and is refreshed (not rewritten from scratch) when the project changes.
4. **Ground every claim in the code.** Do not guess the API or workflow. Read the source. If something is uncertain, mark it in the Open Questions section rather than stating it as fact.

## Output Location

```
.agent/skills/project-harness/spec/
└── <project-name>/
    ├── SPEC.md          ← the main shareable document
    └── (optional) api.md, workflow.md, data-model.md   ← split out when SPEC.md nears 500 lines
```

- `<project-name>` is the project's folder name (e.g. `smr_outlet_pigtail`).
- The `spec/` folder is the shared knowledge store. Multiple project specs live side by side.
- `assets/spec-template.md` in this skill is the starting template.

## Workflow

### Phase 0: Scope & Existing-Spec Check

1. Identify the target project. Accept any of: a folder path (e.g. `tools/applet_scripts/smr_outlet_pigtail`), a module import path, or a ticket/task that names a project area. If ambiguous, ask the user for the folder.
2. Check whether `spec/<project-name>/SPEC.md` already exists:
   - **Exists** → this is a **refresh**. Read the current spec first, then re-explore only what may have changed, and update in place (preserve the change log at the bottom).
   - **Absent** → this is a **fresh harness**. Run Phase 1 onward.
3. Confirm the scope with the user in one line before deep exploration (e.g. "Harnessing `tools/applet_scripts/smr_outlet_pigtail` → will write `spec/smr_outlet_pigtail/SPEC.md`. Proceed?"). Skip the confirmation if the user already named the exact folder.

### Phase 1: Explore the Project

Explore breadth-first, then depth on the important parts. For a larger project, spawn parallel `Explore`/`general-purpose` agents (see Parallelization below).

Gather, in this order:
1. **Entry points** — the files meant to be *run* or *imported by outsiders* (e.g. `run_*.py`, `__init__.py` exports, CLI mains, applet scripts). These anchor the whole spec.
2. **Purpose** — what problem the project solves, in domain terms (read module docstrings, README-like files, the top of entry points).
3. **Architecture** — the internal modules and how they depend on each other. Group files by responsibility (pre-processing, calculation, post-processing, upload, utils, etc.).
4. **Public API surface** — the functions/classes/constants an outside caller uses: signatures, key parameters, return shapes. Distinguish public (meant to be called) from internal helpers.
5. **Data models & schemas** — the shapes of the data flowing through: dataclasses, dicts, DB/BigQuery schemas, file formats (CSV columns, exodus, JSON payloads), pub/sub message shapes.
6. **Workflow / pipeline** — the end-to-end sequence: what runs first, what it produces, what consumes it, what the outputs and side effects are (files written, cloud uploads, notifications).
7. **External dependencies & integrations** — SDK modules used (`import akselos as ak`, etc.), cloud services (BigQuery, pub/sub, storage), servers, and other projects it couples to.
8. **Gotchas** — non-obvious constraints: banned APIs, ordering requirements, environment/secret needs, `*_old.py` deprecated paths, restricted directories (never read `scrbe/`), known fragile spots.

### Phase 2: Write the SPEC

Copy `assets/spec-template.md` to `spec/<project-name>/SPEC.md` and fill every section. Follow the template's structure. Key rules:

- **Point, don't copy.** Reference source as `tools/applet_scripts/smr_outlet_pigtail/run_creep_analysis.py:42`. Reproduce only short, load-bearing signatures — not whole functions.
- **API entries are tabular and precise.** For each public entry: name, signature, what it does, key params, return shape, defined-at path.
- **The workflow is a numbered, followable sequence** with inputs → step → outputs at each stage. A reader should be able to trace one run start to finish.
- **Data shapes are explicit.** Give field names and types, not "a dict of stuff."
- **Stay lean.** Target under 500 lines for `SPEC.md`. If a section (usually API or data-model) grows large, split it into `api.md` / `data-model.md` / `workflow.md` alongside `SPEC.md` and link to it from the main file.
- **Header points back.** The spec's front-matter/header records the project folder path, the date, and the source revision (if determinable) so a reader knows how current it is.

### Phase 3: Verify & Hand Off

1. **Self-check accuracy** — re-open 2–3 of the files you cited and confirm the signatures/paths in the spec actually match. A spec with wrong paths is worse than no spec.
2. **Completeness check** — could a new developer, reading only this spec, name the entry point, describe the workflow, and find where to make a change? If not, fill the gap.
3. **Record open questions** — anything you could not determine with confidence goes in Open Questions, not into the body as a guess.
4. **Offer next step** — tell the user the spec is ready, its path, and that it can be shared with a teammate or passed to the `prd` skill to draft a PRD for a new task on this project.

## Parallelization

For a project with many files, use the harness pattern (agent team / sub-agents). Split exploration by concern so agents don't overlap:
- Agent A: entry points + workflow/pipeline
- Agent B: public API surface + internal architecture
- Agent C: data models/schemas + external integrations + gotchas

Each returns structured notes; the main synthesizes them into one `SPEC.md`. Use `general-purpose` or `Explore` agents (read-only exploration). Never read `scrbe/` (proprietary, off-limits per AGENTS.md).

## Refresh (updating an existing spec)

When `SPEC.md` exists:
1. Read it and note its recorded date/revision.
2. Re-explore areas likely to have changed (or the specific area the user names).
3. Update the affected sections in place; do not rewrite untouched sections.
4. Append a row to the spec's **Change log** table (date, what changed, why).

## Relationship to Other Skills

- **`harness`** builds agents+skills for a domain (the meta agent-architect). **`project-harness`** documents one existing project into a shareable spec. Different jobs.
- **`prd`** consumes a project spec: when the user wants to add a task/feature to a project, `prd` reads `spec/<project-name>/SPEC.md` for context and writes the PRD next to it, so the spec (what exists) and the PRD (what's requested) travel together as one shareable bundle.

## Deliverable Checklist

- [ ] `spec/<project-name>/SPEC.md` created (or refreshed) from the template
- [ ] Header records the project folder path + date (+ revision if known)
- [ ] Every section filled; no placeholder left blank
- [ ] Entry points, public API, data shapes, and end-to-end workflow all covered
- [ ] Claims reference real source as `path:line`; cited paths re-verified
- [ ] Uncertainties captured in Open Questions, not stated as fact
- [ ] `SPEC.md` under ~500 lines; large sections split into `api.md`/`workflow.md`/`data-model.md`
- [ ] `scrbe/` never read
- [ ] Change log present (initial row on fresh build)
