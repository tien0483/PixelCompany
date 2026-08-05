# Windows offline GUI installer — design

## Problem

`scripts/windows/build-setup.mjs` today produces a `dist/` folder (`PixelOffice-Setup.cmd` +
`PixelOffice-windows.zip` + `.mjs` helpers) that end users double-click. It runs in a raw console:
`winget install` (Node, uv) → `pnpm install` → `uv sync`, several minutes, requires network, and
fails in visible, unfriendly ways (corepack EPERM, missing PATH, etc). There's also a legacy
`Build-SetupExe.ps1` (ps2exe) path that wraps the same console script in an exe — still a console,
still needs companion `.ps1` files shipped alongside it.

Goal: a single double-click `PixelOffice-Setup.exe` with a real Windows wizard (Welcome / License /
Install Location / Progress / Finish), the project icon, a Programs & Features uninstall entry, and
**no network dependency and no prerequisite installs** (Node/pnpm/uv/Python) on the target machine.
Per-user install under `%LOCALAPPDATA%\PixelOffice`, no admin/UAC, matching the current install
location convention.

## Approach: Inno Setup, offline-staged payload

**Installer authoring tool: Inno Setup 6** (`ISCC.exe` compiles a `.iss` script into one exe).
Rejected alternatives:
- **NSIS** — equivalent capability, more boilerplate for an MUI2 wizard, no advantage here.
- **WiX/MSI** — only justified if IT needs GPO/Intune deployment; per-user MSI is awkward and a
  ~500 MB/40k-file payload is slow to author and slow to install as an MSI.

**Payload strategy: fully offline, self-contained.** Everything the app needs at runtime is staged
into the installer at build time: Node runtime, flat `node_modules`, prebuilt UI `dist/`, and a
relocatable Python + Manager deps. The installer copies files; it never calls winget, pnpm, uv, or
touches PATH/corepack. Trade-off accepted: the exe is large (several hundred MB) and pinned to
x64 + one Node major (native modules `node-pty`/`esbuild` ship prebuilt for that combination).

## Build pipeline

New `scripts/windows/installer/` directory, run only by maintainers (`node build-installer.mjs`):

```
scripts/windows/installer/
  PixelOffice.iss          # Inno Setup script (wizard pages, files, shortcuts, uninstall)
  Launcher.cs              # windowless splash + boot launcher, compiled with in-box csc.exe
  build-installer.mjs      # stage -> compile Launcher.cs -> ISCC.exe -> dist/PixelOffice-Setup.exe
```

Staging steps (`build-installer.mjs`, reusing `bundle-source.mjs`'s allowlist logic):

1. Copy the allowlisted repo source into `installer/stage/app/` (same allowlist as today's
   `bundle-source.mjs`: root lockfiles/`package.json`, `frontends/pixel_office`,
   `backends/runtime`, `backends/manager`, `scripts/solo.mjs` + `start-stack.mjs` + `pm.mjs`,
   `AGENT.md`, `.agent/*`, `.claude`).
2. Run `pnpm install --node-linker=hoisted` inside `stage/app` — a real flat tree (Inno copies
   files, not the symlinks pnpm's default linker produces).
3. Run the UI build (`vite build` in `frontends/pixel_office`) so `dist/` ships prebuilt; end users
   never need vite.
4. Download/unpack official Node 22 windows-x64 zip into `stage/runtime/node/`.
5. Stage a relocatable Python (python-build-standalone) into `stage/runtime/python/`, then
   `pip install --target stage/runtime/python/Lib/site-packages` the Manager's deps from
   `backends/manager/pyproject.toml`. No `.venv` is copied — a copied venv bakes absolute paths
   into `pyvenv.cfg`/`Scripts/*.exe` and breaks once moved to the install dir.
6. Compile `Launcher.cs` with the in-box
   `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`
   (`/target:winexe /win32icon:PixelOffice.ico`) → `stage/PixelOffice.exe`. No new build toolchain
   requirement.
7. `ISCC.exe PixelOffice.iss` compiles the whole staged tree into `dist/PixelOffice-Setup.exe`.

Net new build-machine requirement: Inno Setup 6 (`winget install JRSoftware.InnoSetup`). Node and
in-box `csc.exe` are already available.

## Install-time behavior (`PixelOffice.iss`)

- `PrivilegesRequired=lowest`, default dir `{localappdata}\PixelOffice` — no UAC prompt, matching
  the existing per-user convention in `install.mjs`/`PixelOffice.Common.ps1`.
- Standard wizard pages: Welcome → (License, if present) → Select Destination → Ready → Installing
  (progress bar copying the staged tree, no network activity) → Finish, with an optional "Launch
  PixelOffice" checkbox.
- Installs `stage/app`, `stage/runtime`, and `PixelOffice.exe` under the install dir; writes
  `config.json` (same shape as today: `Runtime`, `Url`, `Browser`, `WindowsRepoPath` pointing at the
  installed `app/` copy).
- Creates Desktop + Start Menu shortcuts pointing at `PixelOffice.exe` (not a `.cmd`), using
  `PixelOffice.ico`.
- Ships an uninstall entry in Programs & Features (Inno's `[UninstallDelete]`/generated
  uninstaller) removing the install dir; a "keep config" prompt mirrors today's
  `uninstall.mjs --keep-config`.
- A `[Code]` Pascal-script check runs before install: if `:3484`/PixelOffice is already running,
  offer to stop it first (reuses the existing stop logic's intent, invoked via the bundled
  `node.exe stop.mjs` rather than shelling to a system `node`).

## Launcher (`Launcher.cs`)

Replaces the `.cmd` shortcut target. A minimal WinExe (no console window):

1. On start, show a small splash/status window ("Starting services...").
2. Read `config.json`, check if `127.0.0.1:3484` is already open (same port-check logic as
   `launch.mjs`).
3. If not running: spawn the bundled `runtime\node\node.exe` running
   `scripts\solo.mjs --skip-build` (the UI is prebuilt, so `--skip-build` avoids any vite
   dependency), with `MANAGER_PYTHON` set to the staged `runtime\python\python.exe` — this reuses
   `resolveVenvPythonPath`'s existing `MANAGER_PYTHON`/`JACKED_PYTHON` env override in
   `backends/runtime/src/manager/manager-process.ts` with **no runtime code changes**. Hidden
   window, output to `solo.log` in the install dir (matching `launch.mjs` today).
4. Poll until the port opens (same timeout/backoff as `launch.mjs`'s `waitReady`).
5. Open the existing chromeless `--app=http://127.0.0.1:3484` window (Edge, falling back to Chrome,
   falling back to default `start`) — unchanged from `launch.mjs`'s `findBrowser`/`openUi`.
6. On any failure, show a message box with the error and the log path (same UX as `launch.mjs`'s
   catch-all today).

`stop.mjs` and `uninstall.mjs` continue to run via the bundled `node.exe` (small `.cmd` or a second
tiny `Stop.exe` sharing splash-less logic — reuse `Launcher.cs` with a `--stop` mode rather than a
new binary, to avoid duplicating the config/port-check code).

## Known trade-offs (explicitly accepted)

- **Size**: staged Node + node_modules + Python + deps + UI dist likely several hundred MB. Ship
  one exe anyway rather than optimize size; this is a peer-to-peer/manual-distribution installer,
  not a CDN download.
- **Platform pin**: x64 + the Node major baked in at stage time (native modules `node-pty`,
  `esbuild` ship prebuilt for that ABI). A future Node upgrade requires a re-stage/rebuild, not a
  code change.
- **Unsigned exe**: without a code-signing certificate, first run trips SmartScreen ("Windows
  protected your PC" → More info → Run anyway). Not fixable by packaging choice alone; out of scope
  for this design. If it becomes a problem, an OV/EV cert is a separate follow-up.
- **Browser dependency unchanged**: the app window still requires Edge or Chrome to be present for
  the chromeless `--app=` window (falls back to default browser via `start` otherwise) — this
  matches current `launch.mjs` behavior and is not changed by this design.

## Out of scope

- Native WebView2 host window (own taskbar identity/icon instead of a chromeless browser window) —
  considered and deferred; current chromeless `--app=` approach is kept as-is per this round.
- Code signing / SmartScreen reputation.
- Auto-update mechanism for the installed app.
