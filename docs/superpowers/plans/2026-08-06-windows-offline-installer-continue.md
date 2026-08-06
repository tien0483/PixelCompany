# Continue Windows Offline Installer (handoff)

> Copied from Cursor local plan `Continue Offline Installer-ad558a95.plan.md` so work can resume on another machine. Parent plan: [`2026-08-05-windows-offline-installer.md`](./2026-08-05-windows-offline-installer.md). Design: [`../specs/2026-08-05-windows-offline-installer-design.md`](../specs/2026-08-05-windows-offline-installer-design.md).

**Goal:** Finish remaining verification for the offline one-file installer after code landed on `main`.

**Branch / integrate status (2026-08-06):** `worktree-windows-offline-installer` was merged into `main` as `7a11e85`. Source for Tasks 1–7 is on `main`. Uninstall interactive smoke and offline Manager smoke were **not** fully finished before merge.

## Done on `main`

| Task | Status | Notes |
|------|--------|-------|
| 1 Allowlist extract | Done | `scripts/windows/source-allowlist.mjs` |
| 2 Stage app | Done + de-symlink fix | `stage-app.mjs` flattens `.pnpm` symlinks |
| 3 Stage runtime | Done | Node 22.22.1 + CPython 3.10.20 |
| 4 Launcher | Done | `Launcher.cs` |
| 5 Inno script | Done (committed) | `PixelOffice.iss`, AppId `{14563699-69D4-4F84-B774-9FF1CAC8F116}` — **never change** |
| 6 Orchestrator | Done (committed) | `build-installer.mjs` resolves ISCC + `/DStageDir=` |
| 7 Docs | Done (committed) | `scripts/windows/README.md` offline section |

## Remaining verification (do not skip)

1. **Silent install path checks** (already passed once on build machine):
   - `%LOCALAPPDATA%\PixelOffice\app\package.json`
   - `runtime\node\node.exe`, `PixelOffice.exe`, `config.json`
   - Desktop `PixelOffice.lnk` → `PixelOffice.exe`
2. **Uninstall** via `unins000.exe`: answer **No** to remove-config (config survives), reinstall, answer **Yes** (dir fully gone).
3. **Offline smoke:** disconnect network, run Setup, splash → chromeless app, Manager log line `Starting Manager with interpreter: ...\runtime\python\python.exe`, Stop shortcut clears `:3484`.
4. **`--skip-stage` fast path:** `node scripts\windows\installer\build-installer.mjs --skip-stage` after a staged tree exists.
5. **Long path / StageDir:** if repo path is long, build with `--stage-dir C:\po-stage` (or junction). ISCC often lives at `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`, not Program Files.

## Build (maintainers)

```bat
winget install -e --id JRSoftware.InnoSetup
node scripts\windows\installer\build-installer.mjs
rem or:
node scripts\windows\installer\build-installer.mjs --stage-dir C:\po-stage
```

Output: `scripts\windows\dist\PixelOffice-Setup.exe`

## Critical constraints (carry forward)

- Fully offline install: installer only copies files; network only at stage time.
- `PrivilegesRequired=lowest`, install under `%LOCALAPPDATA%\PixelOffice`.
- Keep de-symlink step in `stage-app.mjs` — hoisted top-level still leaves absolute `.pnpm` symlinks.
- No AI attribution trailers in commits.
