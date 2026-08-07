# Revoked-seat launch gate (Auto launches route around seats needing re-auth)

Status: implemented 2026-08-07. Scope: `backends/runtime`, `frontends/pixel_office`.

## Context

Symptom: with several healthy seats available but jacked's *active* Claude seat holding
dead credentials, starting a task opened Claude Code on

```
Please run /login · API Error: 401 OAuth access token has been revoked.
```

Why it happened:

- An unpinned ("Auto") Claude launch injects **no** `CLAUDE_CONFIG_DIR`
  (`src/manager/manager-account-pin.ts` → `UNPINNED`). The session therefore inherits
  whatever credential jacked has written globally — the revoked one.
- `resolveManagerAccountPin` gated launches on `isActive` (seat disabled in Manager) and
  the donate cap only. Credential health was never consulted, even though the snapshot
  already carries `validationStatus` and `ccNeedsAuth`
  (`src/core/api-contract.ts` `RuntimeManagerAccountSchema`).
- `toManagerDonateAccount` dropped both fields at the projection, so no downstream gate
  could see them (same failure mode that once lost `isActive`).
- Manager only learns a token died when something probes it
  (`backends/manager/manager/web/auth.py` refresh paths, `/validate`), so the seat could
  read `valid` while Claude Code was already being refused.

Intended outcome: a seat with dead credentials never silently runs a task. Auto launches
move to a healthy seat; explicit pins fail loudly on the card; Manager learns about the
revocation from the agent's own 401.

## Changes

### 1. Health predicate + projection — `src/manager/manager-account-pin.ts`

- `isManagerAccountAuthBroken(account)`: true when `ccNeedsAuth === true`, or
  `validationStatus` is `invalid` / `expired`. `unknown` / `checking` count as healthy —
  jacked's probe is best-effort and must not lock out an unvalidated seat.
- `ManagerDonateAccountLike` gains `validationStatus` and `ccNeedsAuth`;
  `toManagerDonateAccount` carries them.

### 2. Auto selection prefers healthy seats

`pickHealthyPool()` is shared by `pickDefaultClaudeAccountId` and
`pickDefaultCursorAccountId`: filter to auth-healthy, then to under-donate-cap, each step
falling back to the wider list so a fully broken/exhausted fleet still yields a target for
the hard-block gates to report on.

### 3. Unpinned Claude redirect — `resolveManagerAccountPin`

New optional dep `resolveLiveActiveClaudeAccountId` returns jacked's **live** active seat
(`snapshot.activeAccountId`), unfiltered — distinct from `resolveActiveClaudeAccountId`,
which now returns the health-filtered pick.

- Live seat auth-broken **and** a healthy seat exists → pin the launch to the healthy seat
  (`CLAUDE_CONFIG_DIR`), warning: `The active seat (account N) needs re-auth; launched on
  account M instead.`
- No healthy seat → `blocked: true`, so the card shows the re-auth message instead of the
  agent dropping into a login screen.
- If the redirect target's credentials cannot be prepared, block rather than fall back —
  the "active account" fallback is exactly the revoked credential we are escaping.

### 4. Explicit pins hard-block

A pinned seat that is auth-broken returns `blocked` (same shape as the disabled-seat and
over-cap gates). No silent seat swap: an explicit pin names the seat the task must run on.

### 5. Feedback loop: agent 401 → Manager re-validate

- `src/terminal/session-manager.ts`: `setAgentAuthFailureReporter()` plus
  `AgentAuthFailureReport { taskId, agentId, managerAccountId, message }`. Fired once, on
  first detection, from both `detectAgentAuthFailure` call sites (streaming output and
  process exit). Wrapped in try/catch — reporting never takes down a session.
- `src/cli.ts`: reporter is attached to every terminal manager (`onTerminalManagerReady`
  plus the already-managed workspaces loop) through a mutable holder, because managers can
  exist before the Manager client does. Once wired, a Claude auth failure calls
  `ManagerClient.validateAccount(managerAccountId ?? monitor active seat)`. Manager flips
  the row to `invalid`, and the next launch routes around it.

### 6. Wiring + UI

- `src/server/runtime-server.ts`, `src/trpc/runtime-api.ts`: thread
  `resolveLiveActiveClaudemanagerAccountId` at both pin sites (task start, HTML one-shot).
- `frontends/pixel_office/src/manager/task-account-picker.tsx`: seats label
  `· needs re-auth`; the Auto preview uses the same healthy-first ordering as the runtime,
  so the dropdown and the launch agree on which seat Auto would use.

No Python change: jacked's auto-swap selection already skips
`validation_status == "invalid"` (`backends/manager/manager/web/auto_swap/selection.py`),
and `use_account` already refuses to switch onto an invalid seat
(`backends/manager/manager/api/routes/auth.py`).

## Verification

```bash
cd backends/runtime
npx vitest run src/manager test/runtime/terminal test/runtime/trpc/manager-api.test.ts   # 245 pass
npx tsc --noEmit -p tsconfig.json | grep '^src/'                                          # clean
cd ../../frontends/pixel_office
npx vitest run src/manager/task-account-picker.test.tsx                                   # 24 pass
```

Full runtime suite: 903 pass / 4 fail — `workspace-metadata-monitor.integration`,
`workspace-api`, `projects-api`. The same 4 fail on a stashed clean tree; pre-existing.

New unit coverage in `src/manager/manager-account-pin.test.ts`:

- `isManagerAccountAuthBroken` — broken vs unvalidated seats.
- `pickDefaultClaudeAccountId` — skips a broken active seat, falls back when all are
  broken, prefers a healthy seat over a lower-usage broken one.
- `resolveManagerAccountPin` — unpinned redirect onto a healthy seat, hard-block when every
  seat is broken, block (not fall back) when the redirect target cannot be prepared,
  hard-block on an explicit broken pin, and no-op for a healthy live seat.
- `toManagerDonateAccount` — the projection keeps a revoked seat detectable.

End-to-end check: revoke/expire the active Claude seat in Seats (or set its validation to
invalid), keep one healthy seat, then start a task on Auto. Expect the task to launch on
the healthy seat with the "needs re-auth" warning on the card, and no `/login` screen in
the terminal. With every seat broken, expect the task to refuse to start with the re-auth
message.
