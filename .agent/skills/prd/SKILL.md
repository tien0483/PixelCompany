---
name: prd
description: "Generates a Product Requirements Document (PRD) that an engineer fills out and hands to a developer, so the developer clearly understands what is being requested and can build it without back-and-forth. Use it when the user says 'create a PRD', 'write a PRD for <feature/task>', 'I have a new task for <project>, make a PRD', 'spec out this feature for the dev', or reviews a project and then asks for a requirements doc for new work. Asks 3–5 clarifying questions first (lettered A/B/C/D options), reads the project's SPEC (from the project-harness skill) for context, then writes a developer-facing PRD. Defaults to a software-feature PRD for code projects; switches to the mechanical-engineering PRD structure for hardware/CAD/FEA components. Saves the PRD beside the project spec so the two travel together as one shareable bundle."
---

# PRD — Engineer's Request → Developer-Ready Spec

An engineer (the requester) describes a new task or feature; this skill turns it into a **PRD the developer reads to understand the request**. The goal is a clear, actionable requirements handoff: the developer should be able to design and implement from the PRD without chasing the engineer for missing details.

**Core principles:**
1. **Audience is the developer who will build it.** Write for the implementer. Requirements must be explicit, unambiguous, and verifiable.
2. **Clarify before writing.** Ask only the most essential questions (3–5) to close the critical gaps, with lettered A/B/C/D options for easy answering. Do not ask what is already answerable from the prompt or the project spec.
3. **Ground the PRD in the project.** If a spec exists for the project (from `project-harness`), read it first and reuse its facts (API, data shapes, workflow) instead of re-deriving them. Reference the spec; don't duplicate it.
4. **Do not start building.** No code, no CAD. The output is the PRD document only.

## Choosing the PRD Type

Detect the project domain and pick the structure:

- **Software / code project** (default — e.g. anything under `tools/`, `dashboard/`, `hui/`, papp components, an applet script like `smr_outlet_pigtail`): use the **software PRD** structure below and `assets/prd-software-template.md`.
- **Mechanical / hardware component** (CAD, enclosure, structural part, mechanism, FEA-validated hardware): use the mechanical PRD structure in `references/prd-mechanical.md` and `assets/prd-mechanical-template.md`.
- **Unsure:** ask as one of the clarifying questions.

## Workflow

### Phase 0: Load Context

1. Identify the target project and the requested task from the user's prompt.
2. Look for an existing spec at `.agent/skills/project-harness/spec/<project-name>/SPEC.md`.
   - **Found** → read it. It gives you the current API, data models, and workflow, so your clarifying questions can be sharp and the PRD can reference real files.
   - **Not found** → suggest running the `project-harness` skill first to generate a spec (the PRD is much stronger with one). If the user declines, proceed but explore the project folder enough to ground the PRD.
3. Decide the PRD type (software vs mechanical) per the section above.

### Phase 1: Ask Clarifying Questions

Ask **3–5** questions covering only the critical unknowns. Present options as lettered lists (`A`, `B`, `C`, `D`) so the engineer can answer fast. Do not ask what the prompt or spec already answers.

**Software PRD — key areas to clarify** (pick the gaps that matter):
- **Scope & trigger:** what exactly should happen, and what invokes it (new script, new arg on an existing run, UI action, scheduled job)?
- **Inputs & outputs:** what data comes in, what must come out (files, tables, notifications, return values)?
- **Integration points:** which existing modules/APIs/schemas does it touch or extend (reference the spec)?
- **Constraints:** performance, backward compatibility, cloud/BigQuery/pub-sub effects, must-not-break behaviors.
- **Acceptance:** how will the engineer know it's correct (expected numbers, a test case, a comparison run)?

**Mechanical PRD — key areas:** see `references/prd-mechanical.md` (manufacturing volume/process, operating environment & IP rating, loads & kinematics, envelope & mass, mating parts & fasteners).

**Example format:**
```
1. What triggers this feature?
   A. A new standalone applet script (run_*.py)
   B. A new argument/mode on an existing run script
   C. A dashboard/UI action
   D. A scheduled / pub-sub-driven job

2. What is the primary output?
   A. A results CSV + BigQuery upload
   B. A modified/new report table
   C. A notification / status update only
   D. Return values consumed by another module
```

Wait for answers before writing.

### Phase 2: Write the PRD

Copy the matching template from `assets/` and fill every section using the prompt, the answers, and the spec.

**Software PRD structure:**
1. **Summary & Context** — what's requested and why, in one short section. Link the project spec.
2. **Goals & Success Criteria** — what "done" looks like, measurably.
3. **Functional Requirements** — numbered `REQ-01`, `REQ-02`, … Each one testable. Cover behavior, inputs/outputs, and edge cases.
4. **Interfaces & Data** — the concrete touchpoints: functions/modules to add or change (reference spec's API section), input/output data shapes, schema/table changes, config.
5. **Non-Goals (Out of Scope)** — what this task explicitly does not cover.
6. **Constraints & Compatibility** — performance, backward-compat, cloud side effects, banned APIs, restricted dirs.
7. **Acceptance & Verification** — how the developer proves it works: test cases, expected values, comparison runs, the relevant `tests/src/` location.
8. **Open Questions & Risks** — unresolved decisions, dependencies, long-lead risks.

Keep every requirement explicit and verifiable. Use metric units and concrete numbers where relevant. Reference real files as `path:line` (pull them from the spec).

### Phase 3: Save & Hand Off

1. Save the PRD next to the project spec so they bundle together:
   `.agent/skills/project-harness/spec/<project-name>/prd-<feature-or-task>.md`
   (Filename: kebab-case the task, e.g. `prd-batch-what-if-runs.md`.)
   If no spec folder exists for the project, create `spec/<project-name>/` and save there.
2. Tell the user the file path and that the spec + PRD together are now a shareable bundle the developer can pick up.
3. Surface any Open Questions to the engineer for a final pass.

## Output Specifications

- **Format:** Markdown (`.md`)
- **Location:** `.agent/skills/project-harness/spec/<project-name>/`
- **Filename:** `prd-<feature-or-task>.md`

## Deliverable Checklist

- [ ] Loaded the project spec (or explored the project) before writing
- [ ] Asked 3–5 clarifying questions with A/B/C/D options; waited for answers
- [ ] Chose the correct PRD type (software vs mechanical)
- [ ] Requirements numbered (`REQ-…`) and individually verifiable
- [ ] Interfaces/data reference real files and the spec, not guesses
- [ ] Non-goals and acceptance/verification sections filled
- [ ] Saved to `spec/<project-name>/prd-<task>.md`; path reported to the user
- [ ] No code/CAD produced — PRD only
