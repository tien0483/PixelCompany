# Flatten notes — 2026-07-30

## Done

- `claude-jacked-master/claude-jacked-master` → `backends/jacked/`
- `kanban/` → `backends/runtime/`; `web-ui/` → `frontends/pixel_office/`
- Root `scripts/start-stack.mjs` + `package.json` workspaces
- Vite/tsconfig/vitest aliases + `file:../../backends/runtime`
- Donor folders removed from repo root
- Docs: TECH_STACK, WRAP_UP, CLAUDE.md; harness paths updated

## Verify

- Frontend office tests: 8/8 pass
- Runtime jacked-client: run with Node ≥22 (Cursor helper)
