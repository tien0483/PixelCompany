#Requires -Version 5.1
<#
.SYNOPSIS
  Remove per-user PixelOffice shortcuts and %LOCALAPPDATA%\PixelOffice\.
#>
[CmdletBinding()]
param(
	[switch]$KeepConfig
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "PixelOffice.Common.ps1")

$installDir = Get-PixelOfficeInstallDir
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

$links = @(
	(Join-Path $desktop "PIXTiel.lnk"),
	(Join-Path $desktop "PIXTiel Stop.lnk"),
	(Join-Path $startMenu "PIXTiel.lnk"),
	(Join-Path $startMenu "PIXTiel Stop.lnk")
)

foreach ($link in $links) {
	if (Test-Path -LiteralPath $link) {
		Remove-Item -LiteralPath $link -Force
		Write-Host "Removed $link"
	}
}

if (Test-Path -LiteralPath $installDir) {
	if ($KeepConfig) {
		Get-ChildItem -LiteralPath $installDir -Force |
			Where-Object { $_.Name -ne "config.json" } |
			Remove-Item -Recurse -Force
		Write-Host "Cleared $installDir (kept config.json)"
	}
	else {
		Remove-Item -LiteralPath $installDir -Recurse -Force
		Write-Host "Removed $installDir"
	}
}
else {
	Write-Host "Install dir not found: $installDir"
}

Write-Host "Uninstall complete (user-scope only)."
