---
name: pixeloffice-review
description: "Code review for PixelOffice/Kanban three-pane merge — frontend React/Vite and Jacked bridge — adapted from review-papp with _shared standards. Use whenever reviewing PixelOffice layout diffs, Jacked UI, office dock, PR/branch/working-tree for this merge, including re-reviews and follow-ups."
---

# PixelOffice review skill

Adapted from `.agent/skills/review-papp/`. Cite failure scenarios. Severity by observable cost.

## Standards map

| Source | Apply as |
|--------|----------|
| `.agent/skills/review-papp/checklists/frontend-review.md` | Defects, duplication, verify commands |
| `.agent/skills/_shared/papp-standards/frontend-standards.md` | Aliases over deep `../../`, query-key completeness ideas, token chrome |
| `.agent/skills/_shared/papp-standards/backend-standards.md` | Only when touching Jacked Python API: typed responses, no raw 500s |

## Local overrides

- Kanban TS: tabs.
- Ported office engine: 2-space where existing.
- Jacked Python: 4-space, aligned `=`; prefer `if len(x) > 0` over `if x:` for lists.
- No trailing whitespace.

## Output format

```markdown
# Review: <scope>
**Verdict:** …
## Findings
### Blocker / Major / Minor / Question
## Praise
## Deferred / legacy drift
## Verification
```

## Cross-boundary checks

- `RuntimeJackedSnapshot` fields ↔ watch/config UI
- Board cards/sessions ↔ `board-to-office`
- Right column open state ↔ TopBar Office button
- No duplicate Jacked iframe + native watch both claiming primary UX
