# PIXTiel Site Screenshot Checklist & Refresh Guide

This document defines the screenshot inventory for the PIXTiel marketing and documentation site (`frontends/pixtiel-site`), specifying capture conditions, viewport specifications, and privacy sanitization guidelines.

---

## Capture Environment & Prerequisites

- **Instance Source**: Running instance of PIXTiel via `pnpm start` in the root repository.
- **Port / URL**: `http://127.0.0.1:3484`
- **Theme**: Dark Mode (default PIXTiel palette).
- **Display Scale**: 2× device pixel ratio (`deviceScaleFactor: 2`).
- **Base Viewport**: 1440 × 900 px.
- **Image Format**: PNG, 24-bit RGB, uncompressed.
- **Destination Folder**: `frontends/pixtiel-site/public/screenshots/`

---

## Privacy & Sanitization Guidelines (PXT-6)

Prior to capturing screenshots:
1. **Email Redaction**: No personal or enterprise email addresses (`*@*.*` -> `agent-seat@pixtiel.local` or `dev@company.local`).
2. **Account Anonymization**: Replace real names with generic seat roles (`Seat Alpha [ACTIVE]`, `Seat Beta [STANDBY]`).
3. **Secret Redaction**: Replace all GitHub/GitLab PATs, Anthropic tokens, or OAuth codes with `••••••••••••••••`.
4. **Card Titles**: Ensure task cards depict realistic engineering features without proprietary customer data.

---

## Screenshot Inventory

| Target File | Slot ID / Location | View / Tab | Viewport | Purpose |
|---|---|---|---|---|
| `board-hero.png` | `#slot-hero-board` | Projects / Kanban Board | 1440×900 @ 2× | Hero section primary visual showing multi-agent columns and cards |
| `board-feature.png` | `#slot-feature-board` | Board / Active Card | 1440×900 @ 2× | Showcase 01: Worktree isolation, agent execution, and terminal stream |
| `plan-editor.png` | `#slot-feature-plan-editor` | Plans Tab | 1440×900 @ 2× | Showcase 02: Interactive HTML plan editor, version diffs, and live preview |
| `review-tab.png` | `#slot-feature-review-tab` | Review Tab | 1440×900 @ 2× | Showcase 03: GitLab-style MR diff viewer with inline line comment routing |
| `agent-studio.png` | `#slot-feature-agent-studio` | Agents Tab (Flowise) | 1440×900 @ 2× | Showcase 04: Visual drag-and-drop agent workflow canvas |
| `learning.png` | `#slot-feature-learning` | Learning / Classroom | 1440×900 @ 2× | Showcase 05: Multi-agent collaborative knowledge synthesis |

---

## How to Refresh Screenshots

Run Google Chrome in headless mode with CDP automation:

```bash
# 1. Ensure solo instance is running:
pnpm start

# 2. Capture and sanitize views:
node -e '
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const outDir = path.resolve("frontends/pixtiel-site/public/screenshots");
const chrome = cp.spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--remote-debugging-port=9222",
  "--window-size=1440,900"
]);

// Connect via CDP, navigate tabs, sanitize DOM, and save PNGs to outDir
'
```
