# Shared helpers for PixelOffice Windows launcher / install / stop.
# Dot-source from sibling scripts. No elevation required.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-PixelOfficeInstallDir {
	return (Join-Path $env:LOCALAPPDATA "PixelOffice")
}

function Get-PixelOfficeConfigPath {
	param([string]$InstallDir = (Get-PixelOfficeInstallDir))
	return (Join-Path $InstallDir "config.json")
}

function Read-PixelOfficeConfig {
	param([string]$ConfigPath = (Get-PixelOfficeConfigPath))
	if (-not (Test-Path -LiteralPath $ConfigPath)) {
		throw "PixelOffice config not found: $ConfigPath`nRun Install-PixelOfficeShortcut.ps1 first."
	}
	$raw = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
	$config = $raw | ConvertFrom-Json
	if (-not $config.Runtime) {
		throw "config.json is missing Runtime (expected 'wsl' or 'windows')."
	}
	$runtime = [string]$config.Runtime
	if ($runtime -ne "wsl" -and $runtime -ne "windows") {
		throw "config.json Runtime must be 'wsl' or 'windows' (got '$runtime')."
	}
	if (-not $config.Url) {
		$config | Add-Member -NotePropertyName Url -NotePropertyValue "http://127.0.0.1:3484" -Force
	}
	if (-not $config.Browser) {
		$config | Add-Member -NotePropertyName Browser -NotePropertyValue "auto" -Force
	}
	if (-not $config.PSObject.Properties["WslDistro"]) {
		$config | Add-Member -NotePropertyName WslDistro -NotePropertyValue "" -Force
	}
	if (-not $config.PSObject.Properties["WslRepoPath"]) {
		$config | Add-Member -NotePropertyName WslRepoPath -NotePropertyValue "" -Force
	}
	if (-not $config.PSObject.Properties["WindowsRepoPath"]) {
		$config | Add-Member -NotePropertyName WindowsRepoPath -NotePropertyValue "" -Force
	}
	return $config
}

function Write-PixelOfficeConfig {
	param(
		[Parameter(Mandatory = $true)]$Config,
		[string]$ConfigPath = (Get-PixelOfficeConfigPath)
	)
	$dir = Split-Path -Parent $ConfigPath
	if (-not (Test-Path -LiteralPath $dir)) {
		New-Item -ItemType Directory -Path $dir -Force | Out-Null
	}
	$json = $Config | ConvertTo-Json -Depth 5
	Set-Content -LiteralPath $ConfigPath -Value $json -Encoding UTF8
}

function Get-PixelOfficeUrlParts {
	param([Parameter(Mandatory = $true)][string]$Url)
	$uri = [Uri]$Url
	$hostName = $uri.Host
	if ([string]::IsNullOrWhiteSpace($hostName)) {
		$hostName = "127.0.0.1"
	}
	$port = $uri.Port
	if ($port -le 0) {
		$port = if ($uri.Scheme -eq "https") { 443 } else { 80 }
	}
	return @{ Host = $hostName; Port = $port; Url = $Url }
}

function Test-PixelOfficePortOpen {
	param(
		[string]$HostName = "127.0.0.1",
		[int]$Port = 3484,
		[int]$TimeoutMs = 800
	)
	$client = New-Object System.Net.Sockets.TcpClient
	try {
		$iar = $client.BeginConnect($HostName, $Port, $null, $null)
		$ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
		if (-not $ok) {
			return $false
		}
		$client.EndConnect($iar) | Out-Null
		return $true
	}
	catch {
		return $false
	}
	finally {
		$client.Close()
	}
}

function Wait-PixelOfficeReady {
	param(
		[Parameter(Mandatory = $true)][string]$Url,
		[int]$TimeoutSec = 90,
		[int]$PollMs = 500
	)
	$parts = Get-PixelOfficeUrlParts -Url $Url
	$deadline = (Get-Date).AddSeconds($TimeoutSec)
	while ((Get-Date) -lt $deadline) {
		if (Test-PixelOfficePortOpen -HostName $parts.Host -Port $parts.Port) {
			try {
				$resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
				if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
					return $true
				}
			}
			catch {
				# Port open but HTTP not ready yet — keep polling.
			}
		}
		Start-Sleep -Milliseconds $PollMs
	}
	return $false
}

function Start-PixelOfficeSoloWsl {
	param(
		[Parameter(Mandatory = $true)][string]$WslRepoPath,
		[string]$WslDistro = ""
	)
	if ([string]::IsNullOrWhiteSpace($WslRepoPath)) {
		throw "WslRepoPath is empty. Re-run the installer and choose WSL with a Linux repo path."
	}
	# Escape single quotes for bash -lc '...'.
	$repoEscaped = $WslRepoPath.Replace("'", "'\''")
	$bash = @"
cd '$repoEscaped' || exit 1
if [ -f "`$HOME/.nvm/nvm.sh" ]; then . "`$HOME/.nvm/nvm.sh"; fi
if [ -f "`$HOME/.bashrc" ]; then . "`$HOME/.bashrc" >/dev/null 2>&1 || true; fi
exec npm run solo
"@
	$argList = @()
	if (-not [string]::IsNullOrWhiteSpace($WslDistro)) {
		$argList += @("-d", $WslDistro)
	}
	$argList += @("--", "bash", "-lc", $bash)
	Start-Process -FilePath "wsl.exe" -ArgumentList $argList -WindowStyle Minimized | Out-Null
}

function Start-PixelOfficeSoloWindows {
	param([Parameter(Mandatory = $true)][string]$WindowsRepoPath)
	if ([string]::IsNullOrWhiteSpace($WindowsRepoPath)) {
		throw "WindowsRepoPath is empty. Re-run the installer and choose Windows with a repo path."
	}
	if (-not (Test-Path -LiteralPath $WindowsRepoPath)) {
		throw "Windows repo path does not exist: $WindowsRepoPath"
	}
	$packageJson = Join-Path $WindowsRepoPath "package.json"
	if (-not (Test-Path -LiteralPath $packageJson)) {
		throw "Not a PixelOffice repo root (missing package.json): $WindowsRepoPath"
	}
	$installDir = Get-PixelOfficeInstallDir
	$logPath = Join-Path $installDir "solo.log"
	$cmd = "set npm_config_yes=true&& npm run solo >> `"$logPath`" 2>&1"
	Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WorkingDirectory $WindowsRepoPath -WindowStyle Minimized | Out-Null
}

function Start-PixelOfficeStack {
	param([Parameter(Mandatory = $true)]$Config)
	$runtime = [string]$Config.Runtime
	if ($runtime -eq "wsl") {
		Start-PixelOfficeSoloWsl -WslRepoPath ([string]$Config.WslRepoPath) -WslDistro ([string]$Config.WslDistro)
	}
	elseif ($runtime -eq "windows") {
		Start-PixelOfficeSoloWindows -WindowsRepoPath ([string]$Config.WindowsRepoPath)
	}
	else {
		throw "Unknown Runtime: $runtime"
	}
}

function Find-BrowserExe {
	param([string]$Browser = "auto")
	$edgeCandidates = @(
		(Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
		(Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
		(Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
	)
	$chromeCandidates = @(
		(Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
		(Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
		(Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
	)
	$prefer = [string]$Browser
	if ($prefer -eq "edge") {
		foreach ($p in $edgeCandidates) { if (Test-Path -LiteralPath $p) { return $p } }
	}
	if ($prefer -eq "chrome") {
		foreach ($p in $chromeCandidates) { if (Test-Path -LiteralPath $p) { return $p } }
	}
	foreach ($p in ($edgeCandidates + $chromeCandidates)) {
		if (Test-Path -LiteralPath $p) { return $p }
	}
	return $null
}

function Open-PixelOfficeUi {
	param(
		[Parameter(Mandatory = $true)][string]$Url,
		[string]$Browser = "auto"
	)
	$exe = Find-BrowserExe -Browser $Browser
	if ($null -ne $exe) {
		Start-Process -FilePath $exe -ArgumentList "--app=$Url" | Out-Null
		return
	}
	# Fallback: default browser (may open a tab).
	Start-Process $Url | Out-Null
}

function Stop-ListenersOnPortsWindows {
	param([int[]]$Ports = @(3484, 8321))
	$pids = New-Object System.Collections.Generic.HashSet[int]
	foreach ($port in $Ports) {
		try {
			$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
			foreach ($c in $conns) {
				if ($c.OwningProcess -gt 0) {
					[void]$pids.Add([int]$c.OwningProcess)
				}
			}
		}
		catch {
			# Get-NetTCPConnection may be unavailable; fall through to netstat.
		}
	}
	if ($pids.Count -eq 0) {
		$netstat = & netstat -ano -p tcp 2>$null
		foreach ($line in $netstat) {
			foreach ($port in $Ports) {
				if ($line -match (":$port\s+") -and $line -match "LISTENING\s+(\d+)\s*$") {
					[void]$pids.Add([int]$Matches[1])
				}
			}
		}
	}
	foreach ($procId in $pids) {
		if ($procId -le 4) { continue }
		try {
			Stop-Process -Id $procId -Force -ErrorAction Stop
			Write-Host "Stopped PID $procId"
		}
		catch {
			Write-Warning "Could not stop PID $procId : $($_.Exception.Message)"
		}
	}
	if ($pids.Count -eq 0) {
		Write-Host "No listeners found on ports $($Ports -join ', ')."
	}
}

function Stop-PixelOfficeStackWsl {
	param(
		[string]$WslDistro = "",
		[int[]]$Ports = @(3484, 8321)
	)
	# Kill node/npm processes listening on solo/manager ports inside the distro.
	$portList = ($Ports -join " ")
	$bash = @"
for p in $portList; do
  pids=`$(ss -ltnp 2>/dev/null | awk -v p=":`$p" '`$4 ~ p {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | sort -u)
  if [ -z "`$pids" ]; then
    pids=`$(lsof -t -iTCP:`$p -sTCP:LISTEN 2>/dev/null || true)
  fi
  for pid in `$pids; do
    kill -TERM `$pid 2>/dev/null || true
  done
done
pkill -f 'scripts/solo.mjs' 2>/dev/null || true
pkill -f 'node.*solo' 2>/dev/null || true
sleep 0.5
for p in $portList; do
  pids=`$(lsof -t -iTCP:`$p -sTCP:LISTEN 2>/dev/null || true)
  for pid in `$pids; do
    kill -KILL `$pid 2>/dev/null || true
  done
done
exit 0
"@
	$argList = @()
	if (-not [string]::IsNullOrWhiteSpace($WslDistro)) {
		$argList += @("-d", $WslDistro)
	}
	$argList += @("--", "bash", "-lc", $bash)
	& wsl.exe @argList
	# Also clear any Windows-side forwarded listeners if present.
	Stop-ListenersOnPortsWindows -Ports $Ports
}

function New-PixelOfficeShortcut {
	param(
		[Parameter(Mandatory = $true)][string]$ShortcutPath,
		[Parameter(Mandatory = $true)][string]$TargetPath,
		[string]$Arguments = "",
		[string]$WorkingDirectory = "",
		[string]$IconLocation = "",
		[string]$Description = "PixelOffice"
	)
	$dir = Split-Path -Parent $ShortcutPath
	if (-not (Test-Path -LiteralPath $dir)) {
		New-Item -ItemType Directory -Path $dir -Force | Out-Null
	}
	$wsh = New-Object -ComObject WScript.Shell
	$sc = $wsh.CreateShortcut($ShortcutPath)
	$sc.TargetPath = $TargetPath
	$sc.Arguments = $Arguments
	if ($WorkingDirectory) { $sc.WorkingDirectory = $WorkingDirectory }
	if ($IconLocation) { $sc.IconLocation = $IconLocation }
	$sc.Description = $Description
	$sc.WindowStyle = 7
	$sc.Save()
}

function Show-PixelOfficeMessage {
	param(
		[Parameter(Mandatory = $true)][string]$Message,
		[string]$Title = "PixelOffice",
		[ValidateSet("Info", "Error", "Warning")][string]$Kind = "Info"
	)
	$icon = switch ($Kind) {
		"Error" { 16 }
		"Warning" { 48 }
		default { 64 }
	}
	try {
		Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
		[System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
	}
	catch {
		Write-Host "[$Title] $Message"
	}
}
