# Pixel Office — Wrap-up

Date: 2026-07-30 (Claude-only + multi-account)

## Layout

- Repo: `frontends/pixel_office` + `backends/runtime` + `backends/jacked`
- Home: board center; Claude Accounts upper-right; Pixel Office lower-right
- Start: `npm start` (dev, HMR) or `node scripts/solo.mjs` (single URL, no Vite)

See [TECH_STACK.md](./TECH_STACK.md).

## Status

Three-pane + Claude-only OAuth Add Account shipped. Donor folders `kanban/` and `claude-jacked-master/` removed after flatten.

Claude-only + multi-account (2026-07-30):

- Cline gated at the catalog (reversible), Claude Code is the default and only launchable agent.
- The runtime spawns/stops jacked itself, headless; `scripts/start-stack.mjs` no longer touches Python.
- `scripts/solo.mjs`: one Node process serves the built UI + board + PTY + Jacked bridge on `:3484`.
- Accounts pane gained re-auth / validate / enable-disable / delete / swap-priority / live sessions.
- Per-task account pinning through `CLAUDE_CONFIG_DIR` (new jacked `launch-dir` route), so several
  cards run Claude Code on different accounts at once.

## Run

```bash
# once, from the repo root — plain `npm install` fails on dedupe (root package.json has no version)
npm install --install-links

npm start        # dev: runtime + Vite (HMR) on :5173, jacked headless behind it
npm run solo     # single URL: runtime serves the built UI on :3484, jacked as its child
```

`npm run solo` flags pass through: `-- --restart`, `-- --build`, `-- --skip-build`, `-- --no-open`.
Port override: `PIXELOFFICE_PORT`.

## Test

```bash
npm run test:runtime      # runtime vitest (test:fast)
npm run test:web          # web vitest — 530 passing
npm run test:e2e          # Playwright against the Vite dev server
npm run test:e2e:solo     # Playwright against the single-URL solo stack
```

`npx playwright install` is needed once for the browsers.

Environment-dependent specs skip (with an explanatory message) instead of failing:

- Board/right-column specs need a project registered in the runtime. Open one in the app, or set
  `PIXELOFFICE_E2E_PROJECT`, to exercise them; they are skipped rather than writing a project into
  the user's real `~/.cline/kanban` config.
- `npm run test:e2e` only starts Vite, so its runtime-dependent specs skip unless `npm start` is
  running in another shell. `npm run test:e2e:solo` is self-contained.

Known red, unrelated to this work: 14 runtime unit tests under
`test/runtime/{workspace,trpc,terminal,cline-sdk}` assert POSIX paths and shell quoting and fail on
Windows (RISK_MITIGATIONS §3); `npx tsc --noEmit` in the web package reports pre-existing errors in
two office port tests, the jacked semantics fixture, and `vite.config.ts` (rollup types).

## Key paths

| Area | Path |
|------|------|
| App shell | `frontends/pixel_office/src/App.tsx` |
| Triple pane | `frontends/pixel_office/src/components/home-triple-pane.tsx` |
| Accounts / OAuth UI | `frontends/pixel_office/src/jacked/jacked-accounts-view.tsx` |
| Account actions / sessions | `frontends/pixel_office/src/jacked/jacked-account-actions.tsx`, `use-jacked-sessions.ts` |
| Task account pin | `frontends/pixel_office/src/jacked/task-account-picker.tsx`, `src/state/board-state.ts` |
| Office | `frontends/pixel_office/src/office/` |
| Runtime + Jacked bridge | `backends/runtime/src/jacked/` (`jacked-client`, `jacked-process`, `jacked-account-pin`) |
| Jacked Python | `backends/jacked/jacked/` (`api/routes/auth.py`, `launch.py`) |
| Launchers | `scripts/start-stack.mjs` (dev), `scripts/solo.mjs` (single URL) |
