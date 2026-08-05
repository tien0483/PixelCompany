#Requires -Version 5.1
<#
.SYNOPSIS
  Start PixelOffice (WSL or Windows) if needed, then open a standalone app window.

.DESCRIPTION
  Reads %LOCALAPPDATA%\PixelOffice\config.json (written by Install-PixelOfficeShortcut.ps1).
  If http://127.0.0.1:3484 is down, starts `npm run solo` in the configured runtime, waits,
  then opens Edge/Chrome with --app=.
#>
[CmdletBinding()]
param(
	[string]$ConfigPath = "",
	[switch]$NoUi
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here "PixelOffice.Common.ps1")

try {
	if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
		$ConfigPath = Get-PixelOfficeConfigPath
	}
	$config = Read-PixelOfficeConfig -ConfigPath $ConfigPath
	$url = [string]$config.Url
	$parts = Get-PixelOfficeUrlParts -Url $url

	$alreadyUp = Test-PixelOfficePortOpen -HostName $parts.Host -Port $parts.Port
	if (-not $alreadyUp) {
		Write-Host "PixelOffice not running on $($parts.Host):$($parts.Port) — starting ($($config.Runtime))..."
		Start-PixelOfficeStack -Config $config
		$ready = Wait-PixelOfficeReady -Url $url -TimeoutSec 120
		if (-not $ready) {
			$hint = if ([string]$config.Runtime -eq "windows") {
				"Check %LOCALAPPDATA%\PixelOffice\solo.log and that Node >= 22 is on PATH."
			}
			else {
				"Check the minimized WSL window and that the Linux repo path is on ext4 (not /mnt/...)."
			}
			Show-PixelOfficeMessage -Kind Error -Title "PixelOffice" -Message (
				"Timed out waiting for $url`n`n$hint"
			)
			exit 1
		}
	}
	else {
		Write-Host "PixelOffice already listening on $($parts.Host):$($parts.Port)"
	}

	if (-not $NoUi) {
		Open-PixelOfficeUi -Url $url -Browser ([string]$config.Browser)
	}
	exit 0
}
catch {
	Show-PixelOfficeMessage -Kind Error -Title "PixelOffice" -Message $_.Exception.Message
	exit 1
}
