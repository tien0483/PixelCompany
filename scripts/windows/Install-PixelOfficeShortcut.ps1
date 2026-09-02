#Requires -Version 5.1
<#
.SYNOPSIS
  Per-user PixelOffice desktop/Start Menu shortcuts (no admin). Choose WSL or Windows at install.

.EXAMPLE
  .\Install-PixelOfficeShortcut.ps1
  Interactive: pick WSL or Windows, then enter repo path.

.EXAMPLE
  .\Install-PixelOfficeShortcut.ps1 -Runtime windows -WindowsRepoPath C:\Users\you\work\PixelOffice-v2

.EXAMPLE
  .\Install-PixelOfficeShortcut.ps1 -Runtime wsl -WslRepoPath /home/you/work/PixelOffice-v2
#>
[CmdletBinding()]
param(
	[ValidateSet("", "wsl", "windows")]
	[string]$Runtime = "",
	[string]$WslRepoPath = "",
	[string]$WslDistro = "",
	[string]$WindowsRepoPath = "",
	[string]$Url = "http://127.0.0.1:3484",
	[ValidateSet("auto", "edge", "chrome")]
	[string]$Browser = "auto",
	[switch]$SkipDesktop,
	[switch]$SkipStartMenu
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "PixelOffice.Common.ps1")

function Read-Choice {
	param([string]$Prompt)
	Write-Host $Prompt -NoNewline
	return (Read-Host)
}

try {
	Write-Host ""
	Write-Host "PIXTiel shortcut install (user-scope, no admin)"
	Write-Host ""

	if ([string]::IsNullOrWhiteSpace($Runtime)) {
		Write-Host "  [1] WSL     — source and stack run in Linux"
		Write-Host "  [2] Windows — source and stack run on Windows"
		Write-Host ""
		$sel = Read-Choice "Select 1 or 2: "
		switch ($sel.Trim()) {
			"1" { $Runtime = "wsl" }
			"2" { $Runtime = "windows" }
			"wsl" { $Runtime = "wsl" }
			"windows" { $Runtime = "windows" }
			default { throw "Invalid selection '$sel'. Choose 1 (WSL) or 2 (Windows)." }
		}
	}

	if ($Runtime -eq "wsl") {
		if ([string]::IsNullOrWhiteSpace($WslRepoPath)) {
			$WslRepoPath = Read-Choice "WSL repo path (Linux, e.g. /home/you/work/PixelOffice-v2): "
		}
		$WslRepoPath = $WslRepoPath.Trim()
		if ([string]::IsNullOrWhiteSpace($WslRepoPath)) {
			throw "WslRepoPath is required for Runtime=wsl."
		}
		if ($WslRepoPath -match "^/mnt/") {
			Write-Warning "Repo under /mnt/... is slow/hang-prone. Prefer an ext4 path like ~/work/..."
		}
		if ([string]::IsNullOrWhiteSpace($WslDistro) -and [Environment]::UserInteractive) {
			$distroIn = Read-Choice "WSL distro name (blank = default): "
			$WslDistro = $distroIn.Trim()
		}
	}
	else {
		if ([string]::IsNullOrWhiteSpace($WindowsRepoPath)) {
			$defaultGuess = (Resolve-Path (Join-Path $here "..\..")).Path
			$WindowsRepoPath = Read-Choice "Windows repo path (blank = $defaultGuess): "
			if ([string]::IsNullOrWhiteSpace($WindowsRepoPath)) {
				$WindowsRepoPath = $defaultGuess
			}
		}
		$WindowsRepoPath = $WindowsRepoPath.Trim().Trim('"')
		if (-not (Test-Path -LiteralPath $WindowsRepoPath)) {
			throw "Windows repo path does not exist: $WindowsRepoPath"
		}
		$pkg = Join-Path $WindowsRepoPath "package.json"
		if (-not (Test-Path -LiteralPath $pkg)) {
			throw "Not a repo root (missing package.json): $WindowsRepoPath"
		}
	}

	$installDir = Get-PixelOfficeInstallDir
	if (-not (Test-Path -LiteralPath $installDir)) {
		New-Item -ItemType Directory -Path $installDir -Force | Out-Null
	}

	$filesToCopy = @(
		"PixelOffice.Common.ps1",
		"PixelOffice-Launch.ps1",
		"PixelOffice-Stop.ps1",
		"Install-PixelOfficeShortcut.ps1",
		"Uninstall-PixelOfficeShortcut.ps1",
		"config.example.json",
		"README.md"
	)
	foreach ($name in $filesToCopy) {
		$src = Join-Path $here $name
		if (Test-Path -LiteralPath $src) {
			Copy-Item -LiteralPath $src -Destination (Join-Path $installDir $name) -Force
		}
	}

	$iconSrc = Join-Path $here "PixelOffice.ico"
	$iconDst = Join-Path $installDir "PixelOffice.ico"
	if (Test-Path -LiteralPath $iconSrc) {
		Copy-Item -LiteralPath $iconSrc -Destination $iconDst -Force
	}

	$config = [ordered]@{
		Runtime         = $Runtime
		Url             = $Url
		Browser         = $Browser
		WslDistro       = $WslDistro
		WslRepoPath     = $(if ($Runtime -eq "wsl") { $WslRepoPath } else { "" })
		WindowsRepoPath = $(if ($Runtime -eq "windows") { $WindowsRepoPath } else { "" })
	}
	Write-PixelOfficeConfig -Config ([pscustomobject]$config) -ConfigPath (Get-PixelOfficeConfigPath -InstallDir $installDir)

	$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
	$launchPs1 = Join-Path $installDir "PixelOffice-Launch.ps1"
	$stopPs1 = Join-Path $installDir "PixelOffice-Stop.ps1"
	$launchArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launchPs1`""
	$stopArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$stopPs1`""
	$iconLoc = if (Test-Path -LiteralPath $iconDst) { "$iconDst,0" } else { "$psExe,0" }

	$desktop = [Environment]::GetFolderPath("Desktop")
	$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

	if (-not $SkipDesktop) {
		New-PixelOfficeShortcut -ShortcutPath (Join-Path $desktop "PIXTiel.lnk") `
			-TargetPath $psExe -Arguments $launchArgs -WorkingDirectory $installDir `
			-IconLocation $iconLoc -Description "Launch PIXTiel"
		New-PixelOfficeShortcut -ShortcutPath (Join-Path $desktop "PIXTiel Stop.lnk") `
			-TargetPath $psExe -Arguments $stopArgs -WorkingDirectory $installDir `
			-IconLocation $iconLoc -Description "Stop PIXTiel stack"
	}
	if (-not $SkipStartMenu) {
		New-PixelOfficeShortcut -ShortcutPath (Join-Path $startMenu "PIXTiel.lnk") `
			-TargetPath $psExe -Arguments $launchArgs -WorkingDirectory $installDir `
			-IconLocation $iconLoc -Description "Launch PIXTiel"
		New-PixelOfficeShortcut -ShortcutPath (Join-Path $startMenu "PIXTiel Stop.lnk") `
			-TargetPath $psExe -Arguments $stopArgs -WorkingDirectory $installDir `
			-IconLocation $iconLoc -Description "Stop PIXTiel stack"
	}

	Write-Host ""
	Write-Host "Installed to: $installDir"
	Write-Host "Runtime:      $Runtime"
	if ($Runtime -eq "wsl") {
		Write-Host "WSL repo:     $WslRepoPath"
		if ($WslDistro) { Write-Host "WSL distro:   $WslDistro" }
	}
	else {
		Write-Host "Windows repo: $WindowsRepoPath"
	}
	Write-Host "URL:          $Url"
	Write-Host ""
	Write-Host "Desktop shortcuts: PIXTiel / PIXTiel Stop"
	Write-Host "Double-click PIXTiel to start (if needed) and open the app window."
	Write-Host "Re-run this installer anytime to switch WSL vs Windows."
	exit 0
}
catch {
	Write-Error $_.Exception.Message
	exit 1
}
