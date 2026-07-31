---
name: pixeloffice-layout
description: "Defines PixelOffice three-pane home layout contracts (sidebar + board + right Watch|Office), resize keys, and TopBar Office semantics. Use whenever designing or changing PixelOffice/Kanban home composition, split panes, office docking, or right-column layout — including follow-ups, re-runs, refinements, or updates based on previous layout results."
---

# PixelOffice layout skill

## When to use

Any change to home pane composition, right-column split, or office show/hide.

## Contract (locked)

```text
Left sidebar | Center (~3/4) Kanban board | Right (~1/4)
                                 upper: Jacked user watch
                                 lower: Pixel Office
```

- Card detail: full-bleed overlay.
- Git History: center alternate only.
- Office TopBar: toggles right column visibility (default open), not exclusive main swap.

## Storage keys

- `kanban.home-right-column-width` — right column width px
- `kanban.home-right-split-ratio` — watch fraction 0–1 (office gets remainder)
- `kanban.home-right-column-open` / per-project — right column open

## Deliverable

Write `_workspace/pixeloffice-merge/01_layout-architect_contract.md`.
