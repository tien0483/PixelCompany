# Office theme, neutral paths, staffing shelves — notes (2026-07-31)

Follow-up to `07_claude-only-multi-account_notes.md`. Three asks: drop `cline` from worktree paths,
retheme the Jacked surface as an office, and bring back the old dashboard's skills/workflow picker.

Decisions taken with the user: theme **Manager** (Seats / Staff / Playbooks / Training / Handbook),
rename **labels only**, new runtime root with **config copied and legacy worktrees left in place**,
skills UI as **sidebar routes**.

## 1. `~/.cline` → `~/.agent`

Constants centralised in `workspace/task-worktree-path.ts` (`RUNTIME_HOME_PARENT_DIR_NAME` +
`LEGACY_*` twins); `runtime-config.ts`, `workspace-state.ts`, `runtime-api.ts` and the sidebar prompt
derive from them. `cline-sdk/cline-mcp-settings-service.ts` untouched — that path is Cline's own.

`state/runtime-home-migration.ts` copies `~/.cline/kanban` → `~/.agent/kanban` when the new home is
empty, called from `cli.ts` **before** `createWorkspaceRegistry` (first reader of boards). Copy, not
move; partial copies are deleted so the next start retries; never throws.

Worktrees deliberately stay put — `getWorktreesRootPath` prefers whichever root already has the task's
directory, and `claude-workspace-trust.ts` treats both roots as trusted. Without the second change,
auto-trust would silently start prompting inside pre-existing worktrees.

Test literals (`join(tempHome, ".cline", ...)`, and the board card's display path) now derive from the
exported constants, so the next rename needs no test sweep.

## 2. Manager theme

`src/jacked/manager-labels.ts` holds every visible string. `manager-labels.test.ts` walks the source
tree and fails if any non-test file renders `Jacked` in a string literal or JSX text — it caught two
strings the manual pass missed ("Installations require the Jacked companion", "Jacked unreachable
(cached)").

Internals keep `jacked` (dirs, `RuntimeJacked*`, tRPC namespace, test ids, `JACKED_URL`) by the user's
choice, so the e2e selectors from the previous run still apply.

## 3. Staffing shelves

`feature-shelf-view.tsx` is one filterable list + toggle, parameterised by a predicate
(`FEATURE_SHELF_SELECTORS`). No new fetch: the snapshot already carries all ~75 features, and skills
arrive inside `knowledge` prefixed `skill_` — Training keys off that prefix, Handbook takes the rest.
Fuzzy filtering reuses `Fzf` with `selector`, matching `git-refs-panel.tsx`.

Packs were the only missing bridge: `fetchPacks`/`setPackEnabled` → `jacked.packs`/
`jacked.setPackEnabled`, with `runtimeJackedPackSchema`. Install state is `installedCount/skillCount`
rather than a boolean, because a pack is a set and lands partially; `npxAvailable` is surfaced since
pack installs shell out to npx.

The office e2e harness now mounts the **real** `HomeSidebarJackedTab`/`HomeSidebarJackedPanel` instead
of a static mock sidebar, and its fixture spans all four categories — otherwise the shelves had one
item each and could not exercise sorting or filtering.

## Fixed along the way (found by using the app)

- **Sidebar Agent tab could not launch on Windows.** The home-agent prompt is 14,168 chars; inlined as
  `--append-system-prompt` it produced a 16,821-char cmd.exe command line against an 8,191 limit, so
  cmd printed "The command line is too long." and the PTY closed. Now written to a file and passed via
  `--append-system-prompt-file` (verified the flag exists in the installed CLI), with cleanup on
  session end. Exposed by the Claude-only gate: the previous default agent was the in-process Cline
  SDK, which has no command line.
- **Paste-code OAuth trapped the pane.** `busyId` stayed `"oauth"` for the whole wait (up to 10
  minutes) and there was no dismiss control. Busy is now released once the flow is merely waiting, and
  the panel has X/Cancel that bumps the poll generation.

## Results

| Suite | Result |
|-------|--------|
| runtime `tsc --noEmit` | clean |
| runtime vitest (jacked, config, state, terminal) | 125 passed, 2 pre-existing Codex/Windows failures |
| web vitest | 532 passed / 78 files |
| web `tsc --noEmit` | 4 pre-existing files only (2 office port tests, semantics fixture, vite.config.ts) |
| e2e solo | 16 passed, 2 skipped (need a registered project) |
| e2e office | 6 passed |

Deviations worth knowing: the office canvas overlay stays titled "Library" (office furniture, and its
test ids are load-bearing); `hooks` features stay under Installations rather than getting a shelf.
