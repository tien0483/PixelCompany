---
name: pixeloffice-jacked-ui
description: "Builds native Jacked Accounts main surface (upper-right) and lower-left config strip for PixelOffice using Kanban tRPC (refreshAllUsage, useAccount, pause/resume swap, settings). Use for Jacked accounts pane, sidebar config buttons, accounts meters chrome, or follow-up UI refinements — not for rewriting the Python jacked server."
---

# PixelOffice Jacked UI skill

## Surfaces

1. **Upper-right Accounts** — full `JackedAccountsView` (cards, meters, Use Account, Refresh All, Add Account → dashboard `#accounts`, auto-swap pause/resume, swap history) from `RuntimeJackedSnapshot` + tRPC.
2. **Lower-left config** — Refresh All, open Jacked Settings section, pause/resume auto-swap, optional external dashboard link (`VITE_JACKED_URL` or `http://127.0.0.1:8321`).

## Rules

- Kanban `surface-*` / `text-*` tokens.
- Offline: disabled buttons + short status text.
- Prefer native React; iframe only as labeled fallback elsewhere.
- Do **not** remount the compact `JackedUserWatch` — upper-right is the Accounts main surface.

## References

Reuse `jacked-accounts-view.tsx`, `jacked-settings-view.tsx`, `office-jacked-semantics.ts`.
