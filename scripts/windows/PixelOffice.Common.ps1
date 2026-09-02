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
		throw "PIXTiel config not found: $ConfigPath`nRun Install-PixelOfficeShortcut.ps1 first."
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
		throw "Not a PIXTiel repo root (missing package.json): $WindowsRepoPath"
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
		[string]$Description = "PIXTiel"
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
		[string]$Title = "PIXTiel",
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

function Get-PixelOfficeAppDir {
	param([string]$InstallDir = (Get-PixelOfficeInstallDir))
	return (Join-Path $InstallDir "app")
}

function Update-PixelOfficeProcessPath {
	$machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
	$user = [Environment]::GetEnvironmentVariable("Path", "User")
	$parts = @()
	if (-not [string]::IsNullOrWhiteSpace($machine)) { $parts += $machine }
	if (-not [string]::IsNullOrWhiteSpace($user)) { $parts += $user }
	$env:Path = ($parts -join ";")
}

function Test-PixelOfficeCommand {
	param([Parameter(Mandatory = $true)][string]$Name)
	$null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-PixelOfficeNodeMajor {
	if (-not (Test-PixelOfficeCommand -Name "node")) {
		return 0
	}
	try {
		$ver = (& node -v 2>$null | Out-String).Trim()
		if ($ver -match "^v?(\d+)") {
			return [int]$Matches[1]
		}
	}
	catch {
		return 0
	}
	return 0
}

function Assert-PixelOfficeWinget {
	if (-not (Test-PixelOfficeCommand -Name "winget")) {
		throw "winget was not found on PATH. Install App Installer from the Microsoft Store, then re-run Setup."
	}
}

function Install-PixelOfficeWingetPackage {
	param(
		[Parameter(Mandatory = $true)][string]$Id,
		[string]$DisplayName = $Id
	)
	Assert-PixelOfficeWinget
	Write-Host "Installing $DisplayName via winget ($Id)..."
	$args = @(
		"install", "-e", "--id", $Id,
		"--accept-package-agreements",
		"--accept-source-agreements",
		"--disable-interactivity"
	)
	& winget @args
	$exit = 0
	if (Test-Path variable:/LASTEXITCODE) { $exit = [int]$LASTEXITCODE }
	# 0 = success, -1978335189 (0x8A15002B) = already installed
	if ($exit -ne 0 -and $exit -ne -1978335189) {
		throw "winget install failed for $Id (exit $exit)."
	}
	Update-PixelOfficeProcessPath
}

function Ensure-PixelOfficeNode {
	param([int]$MinMajor = 22)
	Update-PixelOfficeProcessPath
	$major = Get-PixelOfficeNodeMajor
	if ($major -ge $MinMajor) {
		Write-Host "Node $(node -v) OK (>= $MinMajor)."
		return
	}
	Install-PixelOfficeWingetPackage -Id "OpenJS.NodeJS.22" -DisplayName "Node.js 22"
	Update-PixelOfficeProcessPath
	$major = Get-PixelOfficeNodeMajor
	if ($major -lt $MinMajor) {
		# Fallback package id used by some winget catalogs.
		Install-PixelOfficeWingetPackage -Id "OpenJS.NodeJS" -DisplayName "Node.js"
		Update-PixelOfficeProcessPath
		$major = Get-PixelOfficeNodeMajor
	}
	if ($major -lt $MinMajor) {
		throw "Node.js >= $MinMajor is required after winget install (found major $major). Restart the shell and re-run Setup."
	}
	Write-Host "Node $(node -v) OK."
}

function Ensure-PixelOfficeUv {
	Update-PixelOfficeProcessPath
	if (Test-PixelOfficeCommand -Name "uv") {
		Write-Host "uv OK ($(uv --version 2>$null))."
		return
	}
	Install-PixelOfficeWingetPackage -Id "astral-sh.uv" -DisplayName "uv"
	Update-PixelOfficeProcessPath
	if (-not (Test-PixelOfficeCommand -Name "uv")) {
		throw "uv was not found on PATH after winget install. Restart the shell and re-run Setup."
	}
	Write-Host "uv OK ($(uv --version 2>$null))."
}

function Resolve-PixelOfficeReleaseUrl {
	param(
		[string]$ReleaseUrl = "",
		[string]$GitHubRepo = "",
		[string]$AssetName = "",
		[string]$ReleaseTag = "latest"
	)
	if (-not [string]::IsNullOrWhiteSpace($ReleaseUrl)) {
		return $ReleaseUrl.Trim()
	}
	if ([string]::IsNullOrWhiteSpace($GitHubRepo)) {
		throw "ReleaseUrl or GitHubRepo is required. Pass -ReleaseUrl, or -GitHubRepo owner/name with -AssetName."
	}
	if ([string]::IsNullOrWhiteSpace($AssetName)) {
		throw "AssetName is required when resolving from GitHubRepo."
	}
	$repo = $GitHubRepo.Trim().TrimStart("/")
	if ($ReleaseTag -eq "latest") {
		$api = "https://api.github.com/repos/$repo/releases/latest"
	}
	else {
		$api = "https://api.github.com/repos/$repo/releases/tags/$ReleaseTag"
	}
	Write-Host "Resolving release asset from $api ..."
	$headers = @{
		"User-Agent" = "PIXTiel-Setup"
		"Accept"     = "application/vnd.github+json"
	}
	$release = Invoke-RestMethod -Uri $api -Headers $headers -UseBasicParsing
	$asset = $release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
	if ($null -eq $asset) {
		$names = @($release.assets | ForEach-Object { $_.name }) -join ", "
		throw "Asset '$AssetName' not found on release. Available: $names"
	}
	return [string]$asset.browser_download_url
}

function Expand-PixelOfficeReleaseZip {
	param(
		[Parameter(Mandatory = $true)][string]$Source,
		[Parameter(Mandatory = $true)][string]$DestinationAppDir
	)
	$tempRoot = Join-Path $env:TEMP "PixelOffice-setup"
	if (Test-Path -LiteralPath $tempRoot) {
		Remove-Item -LiteralPath $tempRoot -Recurse -Force
	}
	New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
	$zipPath = Join-Path $tempRoot "release.zip"
	$extractDir = Join-Path $tempRoot "extract"
	New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

	$src = $Source.Trim()
	if ($src -match "^file:///" ) {
		$src = [Uri]::UnescapeDataString(($src -replace "^file:///", "") -replace "/", "\")
	}
	if (Test-Path -LiteralPath $src) {
		Write-Host "Using local zip: $src"
		Copy-Item -LiteralPath $src -Destination $zipPath -Force
	}
	else {
		Write-Host "Downloading release zip..."
		Write-Host "  $src"
		$prevProgress = $ProgressPreference
		$ProgressPreference = "SilentlyContinue"
		try {
			Invoke-WebRequest -Uri $src -OutFile $zipPath -UseBasicParsing
		}
		finally {
			$ProgressPreference = $prevProgress
		}
	}

	Write-Host "Extracting..."
	Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

	# GitHub source zips wrap contents in a single top-level folder.
	$root = $extractDir
	$children = @(Get-ChildItem -LiteralPath $extractDir -Force)
	if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
		$nestedPkg = Join-Path $children[0].FullName "package.json"
		if (Test-Path -LiteralPath $nestedPkg) {
			$root = $children[0].FullName
		}
	}
	$pkg = Join-Path $root "package.json"
	if (-not (Test-Path -LiteralPath $pkg)) {
		throw "Extracted archive is not a PIXTiel repo root (missing package.json)."
	}

	$parent = Split-Path -Parent $DestinationAppDir
	if (-not (Test-Path -LiteralPath $parent)) {
		New-Item -ItemType Directory -Path $parent -Force | Out-Null
	}
	if (Test-Path -LiteralPath $DestinationAppDir) {
		Remove-Item -LiteralPath $DestinationAppDir -Recurse -Force
	}
	New-Item -ItemType Directory -Path $DestinationAppDir -Force | Out-Null
	Copy-Item -Path (Join-Path $root "*") -Destination $DestinationAppDir -Recurse -Force
	Write-Host "App installed to: $DestinationAppDir"
}

function Get-PixelOfficePackageManagerSpec {
	param([Parameter(Mandatory = $true)][string]$AppDir)
	$pkgPath = Join-Path $AppDir "package.json"
	$raw = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8
	$pkg = $raw | ConvertFrom-Json
	if ($pkg.packageManager) {
		return [string]$pkg.packageManager
	}
	return "pnpm@11.18.0"
}

function Install-PixelOfficeNodeDeps {
	param([Parameter(Mandatory = $true)][string]$AppDir)
	Update-PixelOfficeProcessPath
	if (-not (Test-PixelOfficeCommand -Name "node")) {
		throw "node not found on PATH."
	}
	$spec = Get-PixelOfficePackageManagerSpec -AppDir $AppDir
	# packageManager is like "pnpm@11.18.0+sha512...."
	$pnpmSpec = ($spec -split "\+")[0]
	Write-Host "Enabling Corepack / pnpm ($pnpmSpec)..."
	& corepack enable
	$enableExit = 0
	if (Test-Path variable:/LASTEXITCODE) { $enableExit = [int]$LASTEXITCODE }
	if ($enableExit -ne 0) {
		Write-Warning "corepack enable exited $enableExit — continuing."
	}
	& corepack prepare $pnpmSpec --activate
	$prepareExit = 0
	if (Test-Path variable:/LASTEXITCODE) { $prepareExit = [int]$LASTEXITCODE }
	if ($prepareExit -ne 0) {
		throw "corepack prepare failed for $pnpmSpec (exit $prepareExit)."
	}
	Update-PixelOfficeProcessPath
	Write-Host "Running pnpm install in $AppDir ..."
	Push-Location -LiteralPath $AppDir
	try {
		& pnpm install
		$pnpmExit = 0
		if (Test-Path variable:/LASTEXITCODE) { $pnpmExit = [int]$LASTEXITCODE }
		if ($pnpmExit -ne 0) {
			throw "pnpm install failed (exit $pnpmExit)."
		}
	}
	finally {
		Pop-Location
	}
}

function Install-PixelOfficeManagerDeps {
	param([Parameter(Mandatory = $true)][string]$AppDir)
	Update-PixelOfficeProcessPath
	$managerDir = Join-Path $AppDir "backends\manager"
	if (-not (Test-Path -LiteralPath $managerDir)) {
		Write-Warning "Manager directory not found ($managerDir); skipping uv sync."
		return
	}
	if (-not (Test-PixelOfficeCommand -Name "uv")) {
		throw "uv not found on PATH."
	}
	Write-Host "Running uv sync in $managerDir ..."
	Push-Location -LiteralPath $managerDir
	try {
		& uv sync
		$uvExit = 0
		if (Test-Path variable:/LASTEXITCODE) { $uvExit = [int]$LASTEXITCODE }
		if ($uvExit -ne 0) {
			throw "uv sync failed (exit $uvExit)."
		}
	}
	finally {
		Pop-Location
	}
}
