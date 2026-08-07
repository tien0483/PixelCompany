# Persist task pause + terminal scrollback across app restart

## Context

Pausing a task in **In Progress**, then closing the app (runtime on port 3484), loses everything:
the card comes back unpaused, the terminal pane is blank, and the only way to get the agent going
again is dragging the card **Done → Review**. That roundtrip deletes/recreates the worktree and is
not an acceptable recovery path.

Root cause (confirmed by reading the code):

1. `pauseTaskSession` (`backends/runtime/src/terminal/session-manager.ts:956`) writes Esc into the
   live node-pty and sets `pausedAt`/`pauseReason` on an **in-memory** summary. No disk write on any
   pause/resume path (same for `resumeTaskSession:979`, `markUsagePaused:319`).
2. The only writer of `sessions.json` is the client `workspace.saveState`
   (`backends/runtime/src/trpc/workspace-api.ts:799`). Its effect
   (`frontends/pixel_office/src/runtime/use-workspace-persistence.ts:89-95,155-167`) dedupes and
   keys its deps on `board`, not `sessions` — so a pause-only change never triggers a save.
3. PTYs are children of the runtime with no `detached` (`terminal/pty-session.ts:93-103`), and
   scrollback lives only in an in-RAM xterm mirror (`terminal/terminal-state-mirror.ts`). Both die
   with the app.
4. On boot `hydrateFromRecord` (`session-manager.ts:287`) restores summaries verbatim with
   `active: null`, `terminalStateMirror: null` and no liveness reconcile. The control-WS handshake
   then sends `restore` with `snapshot: ""` (`terminal/ws-server.ts:498-515`), and the client does
   `terminal.reset()` and early-returns (`terminal/persistent-terminal-manager.ts:312-326`) → blank
   pane, no error banner.
5. The client reconciler (`hooks/use-board-interactions.ts:455-530`) handles
   `awaiting_review`/`running`/`interrupted` only; an `idle` card is stranded. The one in-place
   restart handler that already exists (`handleRestartTaskWithCurrentAccount:620-645` →
   `startTaskSession({resumeFromPersistence:true})` → `--continue`) is UI-gated on a manager-account
   pin mismatch (`components/card-detail-view.tsx:1094-1120`).

**Constraint:** pause is a keystroke into a live PTY. The process cannot survive app close. So
"restored pause" means: durable paused flag + replayed scrollback + a one-click **Resume** that
relaunches with `--continue` in the same worktree. No detached/tmux PTYs.

**Outcome:** a paused In Progress card stays in In Progress with a "Paused — session ended" badge,
its terminal shows the last output marked as replayed, and one Resume button continues the agent.

---

## Design decisions

- **Server owns session durability.** New persister subscribes to the existing
  `TerminalSessionManager.onSummary` (`session-manager.ts:280`) — that choke point already covers
  pause, resume, usage-pause, exit and every transition, so the pause methods need no edits.
- **Write `sessions.json` only, never `meta.json`.** `saveWorkspaceState`/`mutateWorkspaceState`
  (`state/workspace-state.ts:737,791`) unconditionally do `revision + 1`. The client holds
  `workspaceRevision` and sends it as `expectedRevision`; any server write through those functions
  would make every client save throw `WorkspaceStateConflictError` and refetch. **This is the load-
  bearing invariant of the whole change.**
- **No clobber risk.** `workspace-api.ts:805-807` already overlays `terminalManager.listSummaries()`
  onto the client's `input.sessions` before saving, and `hydrateFromRecord` loads every persisted
  task into the manager — so a client save can never revert a server-written `pausedAt`.
- **No new session state.** "Paused with no process" = `state:"idle"` + `pausedAt != null` +
  `pid: null`. Adding an enum member would ripple through `session-state-machine.ts` and the
  persisted schema for no gain.
- **`lastOutputAt` is the churn trap.** It ticks on every PTY chunk (`session-manager.ts:514,767`).
  The persister must diff on durable fields only.

---

## Implementation

### 1. Contract — `backends/runtime/src/core/api-contract.ts`
Extend `runtimeTerminalWsRestoreMessageSchema` (~`:2250`) with
`stale: z.boolean().default(false)` and `capturedAt: z.number().nullable().default(null)`.
Defaults keep old clients compatible. Frontend types propagate via `runtime/types.ts` re-export.

### 2. Session persistence (server)

**`state/workspace-state.ts`** — add:
```ts
export async function saveWorkspaceSessionSummaries(
  workspaceId: string,
  summaries: readonly RuntimeTaskSessionSummary[],
): Promise<void>
```
Uses the existing module-private `getWorkspaceSessionsPath(:219)`,
`getWorkspaceDirectoryLockRequest(:238)`, `readWorkspaceSessions(:345)` and
`lockedFileSystem.writeJsonFileAtomic`. Read → merge by `taskId` → write.
**Load-bearing comment:** never touches `meta.json`, never bumps `revision`, and why.

**`state/session-summary-persister.ts` (new)** — `createSessionSummaryPersister({ workspaceId,
writeSummaries?, debounceMs? })` returning `{ handleSummary, flush, dispose }`.
`durableSummaryFingerprint()` covers `state`, `pausedAt`, `pauseReason`, `reviewReason`, `agentId`,
`workspacePath`, `pid`, `startedAt`, `activeRunMs`, `runningSince`, `managerAccountId`, `resumeAt`,
`autoResumeOnUsageLimit`, `exitCode`, `latestTurnCheckpoint?.commit` — **excludes** `updatedAt`,
`lastOutputAt`, `lastHookAt`, `latestHookActivity`, `warningMessage`. Trailing debounce ~400ms,
serialized writes, errors warned not thrown. Inject `writeSummaries` for tests.

**`terminal/session-hydration.ts` (new, pure)** —
`reconcileHydratedSessionSummary(summary, nowTs)`:

| incoming | result |
|---|---|
| `pausedAt != null`, state `running`/`awaiting_review`/`interrupted` | `state:"idle"`, `reviewReason:null`, `pid:null`, `runningSince:null`, `exitCode:null`; **`pausedAt`/`pauseReason`/`workspacePath` preserved** |
| `running`, unpaused | `state:"interrupted"`, `reviewReason:"interrupted"`, `pid:null` (unchanged crash semantics) |
| `awaiting_review`, unpaused | unchanged except `pid:null`, `runningSince:null` |
| other, unpaused | `pid:null`, `runningSince:null` |

Always apply `freezeRunTimingPatch` (`terminal/session-run-timing.ts`) so `activeRunMs` isn't
inflated by the hours the app was closed. Also export `toParkedSessionSummary(summary, nowTs)` (the
paused branch) for reuse by the shutdown coordinator.

**`terminal/session-manager.ts`** — `hydrateFromRecord(:287)` stores
`reconcileHydratedSessionSummary(summary, now())`. Harden `recoverStaleSession(:862)` to explicitly
carry `pausedAt`/`pauseReason` through its patch (it is the second, WS-triggered entry point).
Constructor gains optional `TerminalSessionManagerOptions { snapshotStore?: TerminalSnapshotStore | null }`
so existing call sites/tests compile unchanged.

**`server/workspace-registry.ts`** — in `ensureTerminalManagerForWorkspace(:236-253)`, after
hydrate: create the persister, `manager.onSummary(persister.handleSummary)`, and do one immediate
`saveWorkspaceSessionSummaries(workspaceId, manager.listSummaries())` so disk matches the reconciled
memory state. Track persisters in a `Map<workspaceId, …>`; `disposeWorkspace(:270)` flushes+disposes;
add `flushSessionPersistence(): Promise<void>` to the `WorkspaceRegistry` interface (`:51-92`).
(Registry over `runtime-state-hub.trackTerminalManager` — it owns creation/hydration and knows the
`workspaceId`, and is testable without booting the hub.)

### 3. Terminal scrollback on disk

**`terminal/terminal-snapshot-store.ts` (new)** — file per task at
`~/.agent/kanban/workspaces/<workspaceId>/terminal-snapshots/<taskId>.json`
(one shared file would rewrite everything on every tick and serialize all tasks behind one lock).
Payload `{ version: 1, taskId, capturedAt, cols, rows, snapshot, truncated }`, zod-validated on read
with `null` on corruption so a bad file never breaks boot. Interface-first
(`TerminalSnapshotStore { load, save, delete }`) so tests inject a fake — no `any`.
`MAX_SNAPSHOT_BYTES = 512_000`; writes via `lockedFileSystem.writeJsonFileAtomic` (already skips
identical content).

**`terminal/terminal-state-mirror.ts`** — `getSnapshot(options?: { maxScrollbackLines?: number })`
forwarding `{ scrollback: n }` to `serializeAddon.serialize()` — escape-safe truncation instead of
slicing a string mid-sequence.

**`terminal/session-manager.ts` (snapshot half)** — `SessionEntry` gains `restoredSnapshot` and
`pendingSnapshotWrite`. New private `scheduleSnapshotPersist(taskId)` called from both `onData`
handlers right after `applyOutput` (`:451`, `:757`): trailing debounce 5s plus a 30s max-latency
force-write. Body serializes at 2000 scrollback lines, retries at 500 if over the cap, else persists
`{ snapshot: "", truncated: true }`. Also write a final snapshot in both `onExit` handlers and in
`stopTaskSession`. `getRestoreSnapshot(:359)` becomes: live mirror → `stale:false`; else memoized
`snapshotStore.load(taskId)` → `stale:true`; else `null`. `startTaskSession(:390)` clears
`restoredSnapshot` when the mirror is recreated. New public `flushTerminalSnapshots()`.
Cleanup: `snapshotStore.delete(taskId)` from `workspace-api.ts` `deleteWorktree` and from
`cleanupInterruptedTaskWorktrees`; project removal is already covered by `removeWorkspaceStateFiles`.

**`terminal/ws-server.ts` (`:498-515`)** — forward `stale`/`capturedAt` on both the success and
catch paths.

### 4. Shutdown — `server/shutdown-coordinator.ts`
Add `isParkedOnShutdown(summary) => summary?.pausedAt != null`. **Paused ⇒ parked; everything else
keeps today's interrupted→trash + worktree-delete behaviour.**
Where `collectWorkColumnTaskIds` folds into `interruptedTaskIds` (`:186-188` managed, `:208`
indexed-only), partition instead — resolve via `terminalManager.getSummary(taskId)` first, else
`workspaceState.sessions[taskId]`.
`persistInterruptedSessions(:56)` takes `{ interruptedTaskIds, parkedTaskIds }`; parked tasks skip
`moveTaskToTrash`, get `toParkedSessionSummary(...)`, and are **excluded from
`worktreeTaskIdsToCleanup`** so `cleanupInterruptedTaskWorktrees(:96)` leaves the worktree intact
(Resume relaunches `--continue` there). Its `saveWorkspaceState(:89)` passes no `expectedRevision`,
so it stays conflict-free.
Before `closeRuntimeServer()(:237)`: `await registry.flushSessionPersistence()` then
`await Promise.all(managers.map(m => m.flushTerminalSnapshots()))` — after
`markInterruptedAndStopAll` so final exit output is captured. `skipSessionCleanup` unchanged;
SIGKILL loses at most one debounce window.

### 5. Client

**`runtime/session-status.ts` (new)** — `isSessionPausedOffline(s)` (`pausedAt != null && pid == null`),
`isSessionPausedLive(s)`, `pausedOfflineBadgeLabel()`. Single source of truth for board-card,
detail view and terminal panel.

**`hooks/use-board-interactions.ts` (`:455-530`)** — first check inside the summary loop:
`if (summary.pausedAt != null && summary.state !== "running") continue;`
Keeps a paused card put whether persisted as `idle` or a stray `interrupted`, and stops the
`:490` interrupted→trash branch. Comment that unhandled `idle` is now intentional.

**`terminal/persistent-terminal-manager.ts` (`:312-326`, `:422-446`)** — `applyRestore` gains
`stale`/`capturedAt`; after writing a stale snapshot append a dim banner
`── replayed from the previous session (ended <relative>) — Resume to continue ──`. Keep the
`!snapshot` early return but set `restoreWasEmpty = true`. Expose `staleRestore`/`restoreWasEmpty`
to subscribers; **do not** change `connectionReady` semantics.

**`components/detail-panels/agent-terminal-panel.tsx` (~`:293-304`)** — when the session has no live
process, render a thin bar above the xterm (`PauseCircle` lucide, `text-status-orange` when paused)
reading "Session ended — showing the last output", with a primary **Resume agent** button
(`onResumeEndedSession`). When there is additionally no snapshot, replace the black box with a
centred `bg-surface-1` empty state carrying the same button.

**`components/card-detail-view.tsx`** — rename prop `onRestartTaskWithAccount` → `onRestartTaskSession`
(keep the existing account-mismatch button and its `data-testid`). Add a strip rendered whenever
`isSessionPausedOffline(sessionSummary)` (not gated on account pins): copy "Paused — session ended
when the app closed. Resume to continue with full history." plus
`<Button variant="primary" size="sm" icon={<Play size={14}/>} data-testid="resume-ended-session">`
→ `onRestartTaskSession(card.id)`, spinner from `restartTaskLoadingById`.
No new logic needed: `handleRestartTaskWithCurrentAccount` already does `stopTaskSession` →
`startTaskSession({resumeFromPersistence:true})` → `--continue`
(`terminal/agent-session-adapters.ts:691`), the route re-ensures the worktree
(`trpc/runtime-api.ts:241`), and `startTaskSession` clears `pausedAt` server-side.

**`components/board-card.tsx` (`:440-448`, `:911-922`)** — derive `isPausedOffline` from the shared
selector; status line shows the offline badge in `text-status-orange`. The play button must branch:
live-paused → `onResumeTask` (writes `continue` to the PTY); offline-paused → `onResumeEndedSession`.
Otherwise the click hits a dead PTY and returns `ok:false` silently.

**`App.tsx` (`:1364`, `:1501`, `:1607`)** — thread `onResumeEndedSession` (=
`handleRestartTaskWithCurrentAccount`) into board-card, card-detail-view and the terminal panel;
apply the prop rename.

---

## Verification

**New backend tests**
- `test/runtime/terminal/session-hydration.test.ts` — full reconcile matrix incl.
  `interrupted + pausedAt` → idle+paused; `activeRunMs` not inflated by the offline gap.
- `test/runtime/terminal/terminal-snapshot-store.test.ts` — round-trip under temp `HOME`, size cap →
  `truncated`, `delete`, corrupt JSON → `null` not throw.
- `test/runtime/terminal/session-manager-snapshot-restore.test.ts` — fake store: live mirror ⇒
  `stale:false`; hydrated-only ⇒ persisted snapshot `stale:true`; `startTaskSession` drops it.
- `test/runtime/state/session-summary-persister.test.ts` — debounce coalescing; `lastOutputAt`-only
  change writes nothing; `pausedAt` change writes; `flush()` awaits.
- `test/runtime/state/workspace-session-summaries.test.ts` — **anti-regression for the conflict
  storm**: `saveWorkspaceSessionSummaries` merges into `sessions.json`, leaves `meta.revision`
  untouched, and a later client `saveWorkspaceState` with the pre-write `expectedRevision` succeeds.

**Changed backend tests** — `session-manager.test.ts` (recoverStaleSession preserves pause; hydrate
reconciles), `ws-server.test.ts` (`restore` carries `stale`/`capturedAt`),
`test/integration/shutdown-coordinator.integration.test.ts` (paused in_progress card stays in
`in_progress` as `idle`+`pausedAt` with its worktree alive; non-paused in_progress still trashed +
worktree deleted; `skipSessionCleanup` unchanged), `workspace-api.test.ts` (saveState still overlays
live summaries).

**Frontend tests** — `use-board-interactions.test.tsx` (paused+idle doesn't move; unpaused
`interrupted` still → trash), `card-detail-view.test.tsx` (Resume strip only for paused-offline),
`board-card.test.tsx` (badge + play routes to restart when offline), new
`persistent-terminal-manager.test.ts` (stale restore writes snapshot + banner; empty stale restore
flags the empty state).

**Manual end-to-end** — `pnpm run solo`, open :3484, start a task into In Progress, pause it, kill
the app, reopen. Expect: card still In Progress with "Paused — session ended"; terminal shows prior
output with the replay banner; **Resume agent** continues the same worktree via `--continue`. Repeat
with `kill -9` on the runtime (no graceful shutdown) — same result, minus at most one debounce
window of output. Then verify a *non-paused* running task still lands in Done on app close.

---

## Risks

1. **Revision coupling is the whole ballgame.** If anyone later routes the persister through
   `saveWorkspaceState`/`mutateWorkspaceState` "for consistency", every client save conflicts.
2. **The client persist effect's stale-`board` early return stays as-is on purpose.** Adding
   `sessions` to its deps would fire a full save per PTY chunk (`lastOutputAt`). Comment at
   `use-workspace-persistence.ts:105` that the server now owns session durability.
3. **`interrupted` + `pausedAt` at shutdown** — the boot reconcile and the client guard are both
   required; either alone leaves a window where a paused card gets trashed.
4. **Snapshot fidelity.** `SerializeAddon` restores cells, not TUI application state — alternate-
   screen agents replay as a frozen frame. UI copy must say "showing the last output", never
   "resume where you left off".
5. **Worktree retention.** Paused cards keep worktrees across shutdown; bounded by paused-card count,
   normal delete/trash path still cleans up.
6. **Cline SDK asymmetry (pre-existing, out of scope).** `cline-sdk/cline-session-state.ts:137-138`
   hardcodes `pausedAt: null` and `trpc/runtime-api.ts:452` routes pause only to the terminal
   manager, so a Cline card can never be paused. Keying all UI off `pausedAt` makes this a no-op.
7. **`markUsagePaused` now persists for free** — verify separately that the usage-resume scheduler
   re-arms from a persisted `resumeAt` after restart. Pre-existing gap this change makes visible.
