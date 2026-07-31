# Review: PixelOffice three-pane merge (working tree)

**Verdict:** approve — layout + Jacked product chrome match current AST (refreshed 2026-07-30).

## Current product shape (code)

- **Accounts:** `JackedAccountsView` mounts only in `App.tsx` upper-right `watch` slot (+ e2e harness). Left sidebar does **not** import it.
- **Sidebar routes:** Installations / Settings / Logs / Analytics (native only). No Accounts route, no Usage-panel iframe, no `:8321` embed.
- **Config strip:** Refresh / Pause|Resume / Settings (opens Jacked → Settings). No Dash.
- **Active semantics:** row **active** badge + status **1 active** = `activeAccountId`; **enabled** = `account.isActive`; Use disabled when selected or disabled.
- **OAuth:** Add Account (browser) + Paste code (`remote: true`); `submitOAuthCode` checks `response.ok`; `useAccount`/`refreshAccount` refuse non-Claude.
- **Bootstrap:** `scripts/start-stack.mjs` and `backends/runtime/scripts/dev-full.mjs` wait for `:8321` with pip/uv install hints.
- **Removed:** `office-jacked-side-panel.tsx`, `jacked-iframe-fallback.tsx`, `jacked-user-watch` compact.

## Findings

### Minor — Office still mounts when right column open
`App.tsx` HomeTriplePane always mounts `OfficeView` when `rightColumnOpen` — sprite decode cost on every home visit with column open. Acceptable for default-open UX; optional later lazy mount.

## Praise

- Clear separation: board center, Accounts upper-right, office lower-right
- Same-origin tRPC / jacked-proxy health; no product dashboard deep-links
- Claude-only filter in client + API guards

## Verification

- AST extract: `_workspace/pixeloffice-merge/ast-jacked-review.json` (re-run script after large edits)
- Unit: jacked-client + office-jacked-semantics + board-to-office
