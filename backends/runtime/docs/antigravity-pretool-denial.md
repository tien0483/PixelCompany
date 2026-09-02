# Antigravity Pre-Tool Hook Denial Runbook

This runbook documents the failure mode where Antigravity shows:

`tool call denied by pre-tool hook`

## Symptom

- Tool calls fail before execution.
- Antigravity logs show hook failures around `PreToolUse`.
- Hook errors may include `command failed: signal: killed`.

## Root Cause

Antigravity can load generated workspace hooks from `.agents/hooks.json`.  
If the `PreToolUse` hook command exits non-zero (or is killed), Antigravity treats the tool call as denied.

In this repository, the agy hook wiring is runtime-generated and currently routed through:

- `backends/runtime/src/terminal/agy-hooks-config.ts`
- `backends/runtime/src/commands/hooks.ts`

## Commit Provenance

- `7b77d78072184d75707042d523eb37df15ab2346` introduced agy-native `.agents/hooks.json` delivery.
- `6b755df4758500862b7681848395af33183caf0a` added agy/gemini event mapping improvements.

## Recovery Checklist

1. Confirm hook file exists at `.agents/hooks.json` in the affected workspace.
2. Confirm hook command paths point to valid runtime/node executables.
3. Confirm hook subprocess no longer hard-fails `PreToolUse`.
4. Re-run a simple tool operation and verify it executes instead of being denied.

## Publish-Safe Backup Policy

For packaging/publishing PixelCompany, keep portable templates and docs in-repo:

- `backends/runtime/docs/templates/antigravity-settings.example.json`
- `backends/runtime/docs/templates/agy-hooks.example.json`

Do not commit:

- real user config from `~/.gemini/antigravity-cli/settings.json`
- generated per-workspace `.agents/hooks.json`
- any token-bearing credentials or machine-specific absolute paths
