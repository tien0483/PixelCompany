Add-Type -AssemblyName System.Drawing

function New-PoIcon {
	param([int]$Size, [string]$Path)
	$bmp = New-Object System.Drawing.Bitmap $Size, $Size
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.SmoothingMode = "AntiAlias"
	$g.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 40))
	$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 132, 255))
	$margin = [int]($Size * 0.18)
	$g.FillRectangle($brush, $margin, $margin, $Size - 2 * $margin, $Size - 2 * $margin)
	$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 230, 237, 243), [Math]::Max(2, [int]($Size / 32)))
	$g.DrawRectangle($pen, $margin, $margin, $Size - 2 * $margin, $Size - 2 * $margin)
	$g.Dispose()
	$bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
	$bmp.Dispose()
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root "package.json"))) {
	$root = "C:\Users\ADMIN\.agent\worktrees\401fe\PixelOffice-v2"
}

$pub = Join-Path $root "frontends\pixel_office\public\assets"
New-Item -ItemType Directory -Force -Path $pub | Out-Null
New-PoIcon -Size 192 -Path (Join-Path $pub "icon-192.png")
New-PoIcon -Size 512 -Path (Join-Path $pub "icon-512.png")

$icoPath = Join-Path $root "scripts\windows\PixelOffice.ico"
$bmp32 = New-Object System.Drawing.Bitmap 32, 32
$g2 = [System.Drawing.Graphics]::FromImage($bmp32)
$g2.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 40))
$b2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 132, 255))
$g2.FillRectangle($b2, 6, 6, 20, 20)
$g2.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp32.GetHicon())
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp32.Dispose()

Write-Host "Wrote icons under $pub and $icoPath"
