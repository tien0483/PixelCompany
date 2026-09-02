# Antigravity Pre-Tool Hook Denial Runbook

This runbook documents the failure mode where Antigravity shows:

`tool call denied by pre-tool hook`

## Symptom

- Tool calls fail before execution.
- Antigravity logs show hook failures around `PreToolUse`.
- Hook errors may include `command failed: signal: killed`.
- Hook errors may include `WaitDelay expired before I/O complete` (for example `jsonhook__kanban-pre-tool-use_PreToolUse_0_0`).

## Root Cause

Antigravity can load generated workspace hooks from `.agents/hooks.json`.  
If the `PreToolUse` hook command exits non-zero (or is killed), Antigravity treats the tool call as denied.

agy pipes JSON to hook stdin and waits for stdout within a `WaitDelay` budget. A wrapper that reads stdin (`cat`) before writing the required `{}` ack deadlocks: the hook blocks on stdin while agy blocks on stdout. The generated PreToolUse wrapper must print `{}` first, then background any stdin consumption.

In this repository, the agy hook wiring is runtime-generated and currently routed through:

- `backends/runtime/src/terminal/agy-hooks-config.ts`
- `backends/runtime/src/commands/hooks.ts`

## Commit Provenance

- `7b77d78072184d75707042d523eb37df15ab2346` introduced agy-native `.agents/hooks.json` delivery.
- `6b755df4758500862b7681848395af33183caf0a` added agy/gemini event mapping improvements.

## Recovery Checklist

1. Confirm hook file exists at `.agents/hooks.json` in the affected workspace.
2. Confirm hook command paths point to valid runtime/node executables.
3. Confirm the PreToolUse wrapper prints `{}` before any `cat` (ack-before-stdin).
4. Confirm hook subprocess no longer hard-fails `PreToolUse`.
5. Restart the affected Antigravity task (or delete `.agents/hooks.json` and relaunch) so the runtime regenerates hooks.
6. Re-run a simple tool operation and verify it executes instead of being denied.

## Publish-Safe Backup Policy

For packaging/publishing PixelCompany, keep portable templates and docs in-repo:

- `backends/runtime/docs/templates/antigravity-settings.example.json`
- `backends/runtime/docs/templates/agy-hooks.example.json`

Do not commit:

- real user config from `~/.gemini/antigravity-cli/settings.json`
- generated per-workspace `.agents/hooks.json`
- any token-bearing credentials or machine-specific absolute paths
