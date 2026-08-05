# PixelOffice Windows shortcuts (WSL or native Windows)

Per-user desktop icon that starts `npm run solo` in **WSL** or on **Windows**, then opens Edge/Chrome as an app window. No admin / Program Files.

## Install (interactive)

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

Config lives at `%LOCALAPPDATA%\PixelOffice\config.json`. Re-run the installer to switch modes.

## Uninstall

```powershell
.\Uninstall-PixelOfficeShortcut.ps1
```

## Prerequisites

| Mode | Need |
|------|------|
| Windows | Node ≥ 22, npm, deps installed in the repo; Manager: `cd backends\manager && uv sync` for Accounts |
| WSL | Same inside Linux; repo on **ext4** (`~/...`), not `/mnt/c/...` |
