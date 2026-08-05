#Requires -Version 5.1
<#
.SYNOPSIS
  Build PixelOffice-Setup.exe from Install-PixelOffice.ps1 via the ps2exe module.

.DESCRIPTION
  Copies companion scripts into scripts\windows\dist\, optionally bakes DEFAULT_RELEASE_URL
  into a staging copy of Install-PixelOffice.ps1, then runs Invoke-ps2exe.

.EXAMPLE
  .\Build-SetupExe.ps1 -ReleaseUrl https://github.com/org/repo/releases/download/v1.0.0/PixelOffice-windows.zip

.EXAMPLE
  .\Build-SetupExe.ps1
  # Builds exe without a baked URL; end users must pass -ReleaseUrl / -GitHubRepo
#>
[CmdletBinding()]
param(
	[string]$ReleaseUrl = "",
	[string]$OutputDir = "",
	[string]$OutputName = "PixelOffice-Setup.exe",
	[switch]$SkipModuleInstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
	$OutputDir = Join-Path $here "dist"
}

$companionFiles = @(
	"PixelOffice.Common.ps1",
	"Install-PixelOfficeShortcut.ps1",
	"Uninstall-PixelOfficeShortcut.ps1",
	"PixelOffice-Launch.ps1",
	"PixelOffice-Stop.ps1",
	"config.example.json",
	"README.md"
)

try {
	Write-Host "Building PixelOffice Setup.exe..."
	Write-Host "  Source dir: $here"
	Write-Host "  Output dir: $OutputDir"

	if (-not (Get-Module -ListAvailable -Name ps2exe)) {
		if ($SkipModuleInstall) {
			throw "ps2exe module not found. Install with: Install-Module ps2exe -Scope CurrentUser"
		}
		Write-Host "Installing ps2exe module (CurrentUser)..."
		Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
	}
	Import-Module ps2exe -ErrorAction Stop

	if (-not (Test-Path -LiteralPath $OutputDir)) {
		New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
	}

	foreach ($name in $companionFiles) {
		$src = Join-Path $here $name
		if (Test-Path -LiteralPath $src) {
			Copy-Item -LiteralPath $src -Destination (Join-Path $OutputDir $name) -Force
		}
		else {
			Write-Warning "Companion missing (skipped): $name"
		}
	}

	$iconSrc = Join-Path $here "PixelOffice.ico"
	$iconDst = Join-Path $OutputDir "PixelOffice.ico"
	if (Test-Path -LiteralPath $iconSrc) {
		Copy-Item -LiteralPath $iconSrc -Destination $iconDst -Force
	}

	$installSrc = Join-Path $here "Install-PixelOffice.ps1"
	if (-not (Test-Path -LiteralPath $installSrc)) {
		throw "Missing $installSrc"
	}

	$staging = Join-Path $OutputDir "Install-PixelOffice.staged.ps1"
	$raw = Get-Content -LiteralPath $installSrc -Raw -Encoding UTF8
	if (-not [string]::IsNullOrWhiteSpace($ReleaseUrl)) {
		$escaped = $ReleaseUrl.Replace("'", "''").Replace('"', '`"')
		$pattern = '\$DEFAULT_RELEASE_URL\s*=\s*"[^"]*"'
		# .NET Regex.Replace treats $ as group refs — escape as $$.
		$replacement = ('$$DEFAULT_RELEASE_URL = "{0}"' -f $ReleaseUrl.Replace('"', ''))
		$updated = [regex]::Replace($raw, $pattern, $replacement, 1)
		if ($updated -eq $raw) {
			throw "Could not bake ReleaseUrl: DEFAULT_RELEASE_URL assignment not found in Install-PixelOffice.ps1"
		}
		$raw = $updated
		Write-Host "  Baked DEFAULT_RELEASE_URL = $ReleaseUrl"
	}
	else {
		Write-Host "  No -ReleaseUrl; exe will require -ReleaseUrl or -GitHubRepo at runtime."
	}
	Set-Content -LiteralPath $staging -Value $raw -Encoding UTF8

	$outExe = Join-Path $OutputDir $OutputName
	if (Test-Path -LiteralPath $outExe) {
		Remove-Item -LiteralPath $outExe -Force
	}

	$ps2exeParams = @{
		inputFile  = $staging
		outputFile = $outExe
		noConsole  = $false
		title      = "PixelOffice Setup"
		description = "PixelOffice Windows full setup"
		company    = "PixelOffice"
		product    = "PixelOffice Setup"
	}
	if (Test-Path -LiteralPath $iconDst) {
		$ps2exeParams["iconFile"] = $iconDst
	}

	Write-Host "  Running Invoke-ps2exe..."
	Invoke-ps2exe @ps2exeParams

	Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue

	if (-not (Test-Path -LiteralPath $outExe)) {
		throw "ps2exe did not produce $outExe"
	}

	Write-Host ""
	Write-Host "Built: $outExe"
	Write-Host "Distribute the entire dist\ folder (exe + companion *.ps1), or at least:"
	Write-Host "  $OutputName, PixelOffice.Common.ps1, Install-PixelOfficeShortcut.ps1,"
	Write-Host "  Uninstall-PixelOfficeShortcut.ps1, PixelOffice-Launch.ps1, PixelOffice-Stop.ps1"
	Write-Host "  (and PixelOffice.ico if present)"
	exit 0
}
catch {
	Write-Error $_.Exception.Message
	exit 1
}
