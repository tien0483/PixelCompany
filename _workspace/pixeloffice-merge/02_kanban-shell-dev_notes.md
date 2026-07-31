# Notes — shell / jacked / office dock

## Done

- `HomeTriplePane` hosts center board + right Watch|Office
- `App.tsx` no longer exclusive `OfficeView` vs `KanbanBoard`
- TopBar Office toggles right column; defaults open
- `JackedSidebarConfig` on expanded sidebar footer
- Upper-right: `JackedAccountsView` (full Accounts; replaced compact `JackedUserWatch`)
- `OfficeView` docked lower-right; Jacked iframe panel removed
- E2E harness mirrors three-pane; iframe test replaced

## Verify

- Prefer `npm run typecheck` / `npm run test` / `npm run e2e -- tests/office.spec.ts` from `kanban/web-ui` after `npm install`
- Pre-existing: missing vitest/globals types / biome if deps incomplete
