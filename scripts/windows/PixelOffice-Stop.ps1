#Requires -Version 5.1
<#
.SYNOPSIS
  Stop PixelOffice listeners (solo :3484 and Manager :8321) for the configured runtime.

.DESCRIPTION
  Agent PTYs and task processes may die with the stack. Prefer this over killing random node PIDs by hand.
#>
[CmdletBinding()]
param(
	[string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "PixelOffice.Common.ps1")

try {
	if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
		$ConfigPath = Get-PixelOfficeConfigPath
	}
	$config = Read-PixelOfficeConfig -ConfigPath $ConfigPath
	$runtime = [string]$config.Runtime
	Write-Host "Stopping PixelOffice ($runtime)..."
	if ($runtime -eq "wsl") {
		Stop-PixelOfficeStackWsl -WslDistro ([string]$config.WslDistro)
	}
	else {
		Stop-ListenersOnPortsWindows -Ports @(3484, 8321)
	}
	Write-Host "Done."
	exit 0
}
catch {
	Show-PixelOfficeMessage -Kind Error -Title "PixelOffice Stop" -Message $_.Exception.Message
	exit 1
}
