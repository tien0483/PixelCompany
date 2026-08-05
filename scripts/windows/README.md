# PixelOffice Windows install (private / bundled source)

Per-user install under `%LOCALAPPDATA%\PixelOffice` (no admin / Program Files).

**Recommended path (private repos):** Node.js build packs an **allowlisted** source zip beside a `.cmd` setup. No public GitHub download. No PowerShell execution-policy for the maintainer build.

Legacy PowerShell scripts (`Build-SetupExe.ps1`, `Install-PixelOffice.ps1`, shortcut `.ps1`) remain in this folder for older flows.

---

## Full setup — Node bundle (recommended)

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
