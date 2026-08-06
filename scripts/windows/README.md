# PixelOffice Windows install (private / bundled source)

Per-user install under `%LOCALAPPDATA%\PixelOffice` (no admin / Program Files).

Legacy PowerShell scripts (`Build-SetupExe.ps1`, `Install-PixelOffice.ps1`, shortcut `.ps1`) remain in this folder for older flows.

---

## Offline one-file installer (recommended)

Fully offline: no winget, pnpm, uv, or network access needed on the target machine.

### Build (maintainers)

Requires Node >= 22, pnpm, uv, and Inno Setup 6 (`winget install -e --id JRSoftware.InnoSetup`):

```bat
node scripts\windows\installer\build-installer.mjs
```

On long worktree paths (Windows MAX_PATH), stage via a short path:

```bat
node scripts\windows\installer\build-installer.mjs --stage-dir C:\po-stage
```

Output: `scripts\windows\dist\PixelOffice-Setup.exe` (single file, several hundred MB — bundles Node, Python, and the built UI).

### Install (end users)

Double-click `PixelOffice-Setup.exe`. Welcome → Install Location → Install → Finish. No terminal, no prerequisites, no network. Creates Desktop/Start Menu shortcuts and a Programs & Features uninstall entry.

---

## Full setup — Node bundle (fallback, requires network)

### Build (maintainers)

Requires **Node ≥ 22** only:

```bat
cd scripts\windows
node build-setup.mjs
```

Output is `scripts\windows\dist\`:

| File | Role |
|------|------|
| `PixelOffice-windows.zip` | Allowlisted source (no `node_modules`, no `_archive`) |
| `PixelOffice-Setup.cmd` | Double-click installer entry |
| `install.mjs` / `launch.mjs` / `stop.mjs` / … | Installer + helpers |

**Ship the entire `dist\` folder** (zip + Setup.cmd + `.mjs` files).

Allowlist includes: root lockfiles/`package.json`, `frontends/pixel_office`, `backends/runtime`, `backends/manager`, `scripts/solo.mjs` + `start-stack.mjs` + `pm.mjs`, `AGENT.md`, `.agent/AGENT.md`, `.agent/manager`, `.agent/skills`, `.agent/workflows`, `.claude`.

Bundle only (no installer copy):

```bat
node bundle-source.mjs
```

### Run setup (end users)

1. Copy the whole `dist\` folder to the target machine.
2. Double-click `PixelOffice-Setup.cmd`, or:

```bat
node install.mjs
```

What it does:

1. Ensures **Node ≥ 22** and **uv** via **winget** when missing
2. Extracts sibling `PixelOffice-windows.zip` → `%LOCALAPPDATA%\PixelOffice\app`
3. `corepack` → `pnpm install`, then `uv sync` in `backends\manager`
4. Creates **PixelOffice** / **PixelOffice Stop** Desktop and Start Menu shortcuts (`.cmd`)

Useful flags: `--skip-winget`, `--skip-deps`, `--launch`, `--zip <path>`.

Network is still needed for winget + npm/pnpm registry + uv packages unless already cached. Source itself does not come from GitHub.

---

## Shortcut-only install (legacy PowerShell)

Point at an existing clone (WSL or Windows):

```powershell
cd scripts\windows
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once, if needed
.\Install-PixelOfficeShortcut.ps1
```

Or scripted:

```powershell
.\Install-PixelOfficeShortcut.ps1 -Runtime windows -WindowsRepoPath C:\path\to\PixelOffice-v2
```

---

## Daily use

- **PixelOffice** — start stack if `:3484` is down, open UI
- **PixelOffice Stop** — stop listeners on 3484/8321

Config: `%LOCALAPPDATA%\PixelOffice\config.json`.

## Uninstall

```bat
%LOCALAPPDATA%\PixelOffice\PixelOffice-Uninstall.cmd
```

Or: `node uninstall.mjs` (optional `--keep-config`).

## Prerequisites

| Path | Need |
|------|------|
| Node full setup | `winget` (or Node/uv already installed); network for package installs |
| Shortcut — Windows | Node ≥ 22, deps already in the repo; Manager: `uv sync` |
| Shortcut — WSL | Same inside Linux; repo on **ext4**, not `/mnt/c/...` |
