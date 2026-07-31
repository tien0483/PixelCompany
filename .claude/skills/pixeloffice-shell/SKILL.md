---
name: pixeloffice-shell
description: "Implements PixelOffice App shell HomeTriplePane wiring in frontends/pixel_office — center board plus right column host, demote exclusive Office view. Use for App.tsx home layout changes, TopBar office toggle rewiring, or shell composition follow-ups/re-runs/refinements."
---

# PixelOffice shell skill

## Steps

1. Read layout contract.
2. Add `HomeTriplePane` (or equivalent) under `frontends/pixel_office/src/components/` or `office/`.
3. In `App.tsx`, when not git-history: render board center + right column; stop `isOfficeOpen ? OfficeView : KanbanBoard`.
4. Reuse `useOfficeViewState` (or rename semantics) so TopBar Office controls right-column open.
5. Preserve bottom terminal under the home column stack.

## Done when

Board and docked office can appear together; git history still replaces center only.
