# Fan-out mode — subagent mechanics

Read this only when the user chose fan-out. The rest of the protocol (scope, cross-stack
seams, ask-once, output format) is in SKILL.md and still applies — this file covers only
the subagent layer.

## Spawning

Spawn domain subagents **in parallel (one message, multiple Agent calls)** — one per
domain; for a very large diff split further by feature/page/resource so each subagent
owns a coherent slice. While they run, do the cross-stack pass from SKILL.md yourself.

## Subagent briefs

Each subagent prompt must contain, explicitly:

- The exact file list / diff slice it owns (paste the list, don't say "the diff").
- The absolute path of its checklist
  (`.claude/skills/review-papp/checklists/{frontend|backend}-review.md`) and of the
  shared standards file, with the instruction to read both **first**.
- Read-only: report findings, never edit files.
- The return format — raw material, not a polished review:
  ```
  For each finding: severity guess (blocker/major/minor/question) | file:line |
  one-line defect | concrete failure scenario | suggested fix | which standard/checklist
  rule it violates.
  Then: contract-changes list (API paths/schemas/types added or changed — for
  cross-stack checking), praise notes, deferred/legacy-drift notes, open questions
  for the author, and verification commands run + results (or "not run" + why).
  ```
- Which verify commands it may run (frontend: tsc/vitest/eslint from
  `dashboard/papps/frontends/`; backend: ruff/ty from repo root; nothing that starts
  servers or touches DBs).

## Synthesis

- **Verify before reporting:** subagent findings are raw material. Re-read the cited
  lines for every Blocker/Major (and anything that smells off) and confirm the failure
  scenario is real — a plausible-but-wrong finding costs the author more than a missed
  nit. Drop or downgrade what doesn't hold.
- **Dedup:** the same root cause flagged from both sides (e.g. a renamed schema field)
  becomes ONE cross-stack finding, not two.
- Merge everything — both domains + your cross-stack findings — into the single report
  format from SKILL.md.
