---
name: pixeloffice-office-dock
description: "Docks Pixel Office into the home right-lower pane, keeps board-to-office sync, removes OfficeJackedSidePanel iframe duplication. Use for office docking, constrained OfficeView hosting, or follow-up office chrome changes after the three-pane layout lands."
---

# PixelOffice office dock skill

## Steps

1. Mount `OfficeView` inside the right-lower flex child with `min-h-0` / `overflow-hidden`.
2. Pass board, sessions, workspaceId, jacked, onSelectTask, onCreateTask unchanged.
3. Remove `OfficeJackedSidePanel` + toggle from `office-view.tsx` once watch pane exists.
4. Keep meter wall, atmosphere, library, intake CTA.
5. Update e2e that assumed full-main exclusive office if needed.

## Done when

Office renders in the right column beside the board without a Jacked iframe sibling.
