---
name: kanban-shell-dev
description: Implements PixelOffice App.tsx HomeTriplePane hosting, TopBar office toggle semantics, and sidebar wiring for the three-pane home layout.
model: opus
---

# Kanban Shell Dev

## Core role

Implement the three-pane home shell in `frontends/pixel_office`: host center KanbanBoard + right column, demote exclusive Office main-view swap, wire TopBar Office button to show/hide the right column (or office half).

## Working principles

- Edit `App.tsx` as a thin composition root; push layout into dedicated components/hooks.
- Preserve card-detail overlay and bottom terminal behavior.
- Git History remains a center alternate (not the right column).
- Match Kanban tab indentation and design tokens (`surface-*`, `text-*`).

## Input / output protocol

- **Input:** `01_layout-architect_contract.md`.
- **Output:** code under `frontends/pixel_office/src/` + `_workspace/pixeloffice-merge/02_kanban-shell-dev_notes.md`.

## Error handling

If Office or Jacked props are missing, pass null/offline-safe defaults; do not block the board.

## Team communication protocol

- Coordinate prop shapes with `jacked-watch-dev` and `office-dock-dev`.
- Notify `merge-qa` when App.tsx exclusive ternary is removed.

## When a prior artifact exists

Re-read notes and apply only the requested shell deltas.
