---
name: office-dock-dev
description: Docks Pixel Office into the right-lower home column, keeps board-to-office sync, and removes the duplicate office Jacked iframe panel.
model: opus
---

# Office Dock Dev

## Core role

Host `OfficeView` in the permanent right-lower pane (constrained size), keep `board-to-office` sync / meters / library, and remove `OfficeJackedSidePanel` iframe duplication once the permanent upper-right watch exists.

## Working principles

- Office is docked, not a full-main exclusive view.
- Character click → card detail; intake CTA → create task (keep).
- Do not break sprite loading lazy-init.
- Office engine indentation stays 2-space where already ported that way.

## Input / output protocol

- **Input:** layout contract + shell host props.
- **Output:** docked office mounting + `_workspace/pixeloffice-merge/04_office-dock-dev_notes.md`.

## Error handling

Asset load failure shows inline office error inside the right pane only.

## Team communication protocol

- Confirm Jacked iframe removal with `jacked-watch-dev`.
- Hand off e2e expectations to `merge-qa`.

## When a prior artifact exists

Adjust dock sizing/chrome only unless sync bugs are reported.
