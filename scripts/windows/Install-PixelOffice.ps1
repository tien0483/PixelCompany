#Requires -Version 5.1
<#
.SYNOPSIS
  Full PixelOffice Windows setup: winget runtimes, download release zip, deps, shortcuts.

.DESCRIPTION
  Windows-native only. Installs Node >= 22 and uv via winget when missing, downloads a
  release zip into %LOCALAPPDATA%\PixelOffice\app, runs pnpm install + uv sync, then
  creates Desktop/Start Menu shortcuts via Install-PixelOfficeShortcut.ps1.

  Build PixelOffice-Setup.exe with Build-SetupExe.ps1 (ps2exe). That build can bake
  DEFAULT_RELEASE_URL below. Ship companion *.ps1 files beside the exe (Build-SetupExe
  copies them into dist/).

.EXAMPLE
  .\Install-PixelOffice.ps1 -ReleaseUrl https://github.com/org/repo/releases/download/v1.0.0/PixelOffice-windows.zip

.EXAMPLE
  .\Install-PixelOffice.ps1 -GitHubRepo org/repo -AssetName PixelOffice-windows.zip

.EXAMPLE
  .\Install-PixelOffice.ps1 -ReleaseUrl C:\path\to\PixelOffice-windows.zip -LaunchAfterInstall
#>
[CmdletBinding()]
param(
	[string]$ReleaseUrl = "",
	[string]$GitHubRepo = "",
	[string]$AssetName = "",
	[string]$ReleaseTag = "latest",
	[switch]$SkipWinget,
	[switch]$SkipDeps,
	[switch]$SkipDownload,
	[switch]$LaunchAfterInstall
)

$ErrorActionPreference = "Stop"

# Baked by Build-SetupExe.ps1 -ReleaseUrl ... when producing PixelOffice-Setup.exe.
$DEFAULT_RELEASE_URL = ""

$script:SetupInvocation = $MyInvocation
$script:SetupPSScriptRoot = $PSScriptRoot

function Get-PixelOfficeSetupScriptDir {
	$candidates = New-Object System.Collections.Generic.List[string]
	if (-not [string]::IsNullOrWhiteSpace($script:SetupPSScriptRoot)) {
		[void]$candidates.Add($script:SetupPSScriptRoot)
	}
	$cmd = $script:SetupInvocation.MyCommand
	if ($null -ne $cmd) {
		if (-not [string]::IsNullOrWhiteSpace($cmd.Path)) {
			[void]$candidates.Add((Split-Path -Parent $cmd.Path))
		}
		if (-not [string]::IsNullOrWhiteSpace($cmd.Definition)) {
			try {
				if (Test-Path -LiteralPath $cmd.Definition) {
					[void]$candidates.Add((Split-Path -Parent $cmd.Definition))
				}
			}
			catch { }
		}
	}
	$entry = [Environment]::GetCommandLineArgs()[0]
	if (-not [string]::IsNullOrWhiteSpace($entry)) {
		try {
			if (Test-Path -LiteralPath $entry) {
				[void]$candidates.Add((Split-Path -Parent (Resolve-Path -LiteralPath $entry).Path))
			}
		}
		catch { }
	}
	foreach ($c in $candidates) {
		if ([string]::IsNullOrWhiteSpace($c)) { continue }
		$common = Join-Path $c "PixelOffice.Common.ps1"
		if (Test-Path -LiteralPath $common) {
			return $c
		}
	}
	throw "Could not find PixelOffice.Common.ps1 next to Setup. Keep the scripts from scripts\windows beside PixelOffice-Setup.exe (Build-SetupExe.ps1 copies them into dist\)."
}

try {
	$here = Get-PixelOfficeSetupScriptDir
	. (Join-Path $here "PixelOffice.Common.ps1")

	Write-Host ""
	Write-Host "PIXTiel full setup (Windows-native, user-scope)"
	Write-Host ""

	$installDir = Get-PixelOfficeInstallDir
	$appDir = Get-PixelOfficeAppDir -InstallDir $installDir
	if (-not (Test-Path -LiteralPath $installDir)) {
		New-Item -ItemType Directory -Path $installDir -Force | Out-Null
	}

	if (-not $SkipWinget) {
		Assert-PixelOfficeWinget
		Ensure-PixelOfficeNode -MinMajor 22
		Ensure-PixelOfficeUv
	}
	else {
		Write-Host "Skipping winget (-SkipWinget)."
		Update-PixelOfficeProcessPath
		$major = Get-PixelOfficeNodeMajor
		if ($major -lt 22) {
			throw "Node.js >= 22 required (found major $major). Omit -SkipWinget or install Node."
		}
		if (-not (Test-PixelOfficeCommand -Name "uv")) {
			throw "uv not found on PATH. Omit -SkipWinget or install uv."
		}
	}

	if (-not $SkipDownload) {
		$url = $ReleaseUrl
		if ([string]::IsNullOrWhiteSpace($url)) {
			$url = $DEFAULT_RELEASE_URL
		}
		$url = Resolve-PixelOfficeReleaseUrl `
			-ReleaseUrl $url `
			-GitHubRepo $GitHubRepo `
			-AssetName $AssetName `
			-ReleaseTag $ReleaseTag
		Expand-PixelOfficeReleaseZip -Source $url -DestinationAppDir $appDir
	}
	else {
		Write-Host "Skipping download (-SkipDownload); expecting app at $appDir"
		$pkg = Join-Path $appDir "package.json"
		if (-not (Test-Path -LiteralPath $pkg)) {
			throw "App dir missing package.json: $appDir"
		}
	}

	if (-not $SkipDeps) {
		Install-PixelOfficeNodeDeps -AppDir $appDir
		Install-PixelOfficeManagerDeps -AppDir $appDir
	}
	else {
		Write-Host "Skipping deps (-SkipDeps)."
	}

	$shortcutInstaller = Join-Path $here "Install-PixelOfficeShortcut.ps1"
	if (-not (Test-Path -LiteralPath $shortcutInstaller)) {
		throw "Missing shortcut installer: $shortcutInstaller"
	}
	Write-Host "Creating Desktop / Start Menu shortcuts..."
	# Nested script uses `exit`; run in a child powershell so it does not abort this setup.
	$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
	$shortcutArgs = @(
		"-NoProfile", "-ExecutionPolicy", "Bypass",
		"-File", $shortcutInstaller,
		"-Runtime", "windows",
		"-WindowsRepoPath", $appDir
	)
	$shortcutProc = Start-Process -FilePath $psExe -ArgumentList $shortcutArgs -Wait -PassThru -NoNewWindow
	if ($shortcutProc.ExitCode -ne 0) {
		throw "Install-PixelOfficeShortcut.ps1 failed (exit $($shortcutProc.ExitCode))."
	}

	Write-Host ""
	Write-Host "Setup complete."
	Write-Host "  App:       $appDir"
	Write-Host "  Config:    $(Get-PixelOfficeConfigPath -InstallDir $installDir)"
	Write-Host "  Shortcuts: Desktop / Start Menu — PIXTiel, PIXTiel Stop"
	Write-Host ""
	Write-Host "Uninstall:"
	Write-Host "  $($installDir)\Uninstall-PixelOfficeShortcut.ps1"
	Write-Host "  (or from this folder: .\Uninstall-PixelOfficeShortcut.ps1)"
	Write-Host ""

	if ($LaunchAfterInstall) {
		$launch = Join-Path $installDir "PixelOffice-Launch.ps1"
		if (-not (Test-Path -LiteralPath $launch)) {
			$launch = Join-Path $here "PixelOffice-Launch.ps1"
		}
		Write-Host "Launching PIXTiel..."
		& $launch
	}

	exit 0
}
catch {
	$msg = $_.Exception.Message
	Write-Error $msg
	try {
		Show-PixelOfficeMessage -Kind Error -Title "PIXTiel Setup" -Message $msg
	}
	catch {
		# Ignore UI failures in non-interactive hosts.
	}
	exit 1
}
