# PixelOffice Windows shortcuts + full Setup.exe

Per-user install under `%LOCALAPPDATA%\PixelOffice` (no admin / Program Files). Two paths:

1. **Full setup** — download release zip, winget Node/uv, install deps, create shortcuts
2. **Shortcut-only** — point at an existing repo (WSL or Windows) and create shortcuts

---

## Full setup (recommended for new machines)

### Build `PixelOffice-Setup.exe` (maintainers)

From PowerShell in this folder:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once, if needed
.\Build-SetupExe.ps1 -ReleaseUrl https://github.com/ORG/REPO/releases/download/vX.Y.Z/PixelOffice-windows.zip
```

Output is `dist\PixelOffice-Setup.exe` plus companion scripts. Ship the **whole `dist\` folder** (or at least the exe and the listed `.ps1` / `.ico` files).

Requires the [ps2exe](https://www.powershellgallery.com/packages/ps2exe) module (`Build-SetupExe.ps1` installs it for CurrentUser if missing).

### Run setup (end users)

Double-click `PixelOffice-Setup.exe`, or:

```powershell
.\Install-PixelOffice.ps1 -ReleaseUrl https://github.com/ORG/REPO/releases/download/vX.Y.Z/PixelOffice-windows.zip
```

GitHub latest asset (no direct URL):

```powershell
.\Install-PixelOffice.ps1 -GitHubRepo ORG/REPO -AssetName PixelOffice-windows.zip
```

Local zip (offline / dogfood):

```powershell
.\Install-PixelOffice.ps1 -ReleaseUrl C:\path\to\PixelOffice-windows.zip
```

What it does:

1. Ensures **Node ≥ 22** and **uv** via **winget** (when missing)
2. Downloads/extracts the zip to `%LOCALAPPDATA%\PixelOffice\app`
3. `corepack` → `pnpm install`, then `uv sync` in `backends\manager`
4. Creates **PixelOffice** / **PixelOffice Stop** Desktop and Start Menu shortcuts

Useful switches: `-SkipWinget`, `-SkipDeps`, `-SkipDownload`, `-LaunchAfterInstall`.

### Release zip

Attach a zip of the repo source (no need to include `node_modules`). The installer always runs `pnpm install` on the machine. Prefer a stable asset name such as `PixelOffice-windows.zip`.

---

## Shortcut-only install

From PowerShell in this folder (or from the repo root):

```powershell
cd scripts\windows
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # once, if needed
.\Install-PixelOfficeShortcut.ps1
```

Choose **[1] WSL** or **[2] Windows**, then enter the repo path.

### Scripted (Windows mode — good for testing)

```powershell
.\Install-PixelOfficeShortcut.ps1 -Runtime windows -WindowsRepoPath C:\path\to\PixelOffice-v2
```

### Scripted (WSL mode)

```powershell
.\Install-PixelOfficeShortcut.ps1 -Runtime wsl -WslRepoPath /home/you/work/PixelOffice-v2
```

## Daily use

- **PixelOffice** (Desktop / Start Menu) — start stack if `:3484` is down, open UI
- **PixelOffice Stop** — stop listeners on 3484/8321 (agents die with the stack)

Config lives at `%LOCALAPPDATA%\PixelOffice\config.json`. Re-run the shortcut installer to switch WSL vs Windows. Full setup always uses Windows-native runtime.

## Uninstall

```powershell
.\Uninstall-PixelOfficeShortcut.ps1
```

Removes shortcuts and `%LOCALAPPDATA%\PixelOffice\` (including `app\` from a full setup). Use `-KeepConfig` to retain `config.json`.

## Prerequisites

| Path | Need |
|------|------|
| Full setup | `winget`; network for download + package installs; Edge or Chrome for the app window |
| Shortcut — Windows | Node ≥ 22, npm/pnpm, deps installed in the repo; Manager: `cd backends\manager && uv sync` for Accounts |
| Shortcut — WSL | Same inside Linux; repo on **ext4** (`~/...`), not `/mnt/c/...` |
