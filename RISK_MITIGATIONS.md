# Risk mitigations — three-pane merge

> **Historical note, 2026-07.** Written during the merge that produced today's layout. Paths such
> as `web-ui/` predate the flatten (the UI now lives at `frontends/pixel_office/`) and the seat
> service is now `backends/manager/`. Kept for the policies, not the paths.

## 1. Vendored Kanban merge cost — partial

**Policy:** small edits in `App.tsx`, `top-bar.tsx`, `api-contract.ts` (+ thin wiring); logic in new modules.

| Allowed / extracted | Notes |
|---------------------|--------|
| `web-ui/src/office/**`, `src/jacked/**` | Bulk of office + bridge |
| `use-office-view-state.ts` | Office toggle/persistence out of App |
| `home-sidebar-jacked.tsx` | Jacked tab/panel out of nav panel |
| `api-contract.ts`, `runtime-state-hub.ts` | Schemas + thin fan-out |

**Still invasive (accept until next vendored merge):** `cli.ts` / `runtime-server.ts` bootstrap, `use-runtime-state-stream.ts` jacked slice, `app-router.ts` `jacked:` routes, `biome.json` office overrides, `use-app-hotkeys.ts` `mod+o`. Prefer additive hooks over rewriting those.

## 2. Lint boundaries — mitigated

Office tree has no `@clinebot/*` imports. `createWorkspaceTrpcClient` stays in runtime query helpers only (`biome` restricted-import rule).

## 3. Windows — partial / accepted debt

`start-stack.mjs` spawns `node` against JS entrypoints (`shell: false`). Folder picker is async `spawn` (not `spawnSync`). node-pty Windows fragility and unrelated pixel-agents test failures remain known debt — do not block office on them.

## 4. Provider probes — mitigated

`jacked-monitor` keeps last-known-good on probe failure and sets `stale: true`. Office shows a **cached** chip; library/mutations treat jacked as offline while stale. Board/office never require jacked for core render.

## 5. Cursor `state.vscdb` — mitigated (+ hardened)

`can_auto_swap=False` in `providers.py`; reads `mode=ro&immutable=1`; manual swap backs up then writes; refuse if Cursor running. Process probe is **fail-closed** (probe error → treat as running) and matches Helper processes on Windows.

## 6. Antigravity token file — mitigated (verified)

`write_oauth_creds` merges via caller-owned full dict, preserves `st_mode`, atomic replace. `refresh_access_token` copies unknown fields. Windows `chmod` is best-effort NTFS.

## 7. Capability registry — mitigated

`jacked/providers.py` is source of truth; selection + Cursor switch consult it. Kanban `parseAccount` prefers API `can_auto_swap` / `can_track_usage`. Dashboard Use Account confirms `manual_switch_warning`.

## 8. Overlay Tailwind — mitigated (prep)

`web-ui/src/office/theme-tokens.ts` maps pixel-agents overlay classes → Kanban `surface-*` / `text-text-*`. Port ToolOverlay/SpeechOverlay later using `mapOfficeOverlayClass`; do not import webview-ui CSS.
