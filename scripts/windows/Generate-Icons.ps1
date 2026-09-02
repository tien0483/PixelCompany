Add-Type -AssemblyName System.Drawing

function New-PoIcon {
	param([int]$Size, [string]$Path)
	$bmp = New-Object System.Drawing.Bitmap $Size, $Size
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
	$g.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 40))

	$c1 = [System.Drawing.Color]::FromArgb(255, 0, 132, 255)
	$c2 = [System.Drawing.Color]::FromArgb(255, 38, 208, 168)
	$rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
	$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush ($rect, $c1, $c2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)

	$font = New-Object System.Drawing.Font "Segoe UI", ([float]($Size * 0.6)), [System.Drawing.FontStyle]::Bold
	$sf = New-Object System.Drawing.StringFormat
	$sf.Alignment = [System.Drawing.StringAlignment]::Center
	$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

	$g.DrawString("P", $font, $brush, $rect, $sf)

	$font.Dispose()
	$brush.Dispose()
	$sf.Dispose()
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
New-PoIcon -Size 192 -Path (Join-Path $pub "icon-notification.png")

$icoPath = Join-Path $root "scripts\windows\PixelOffice.ico"
$bmp32 = New-Object System.Drawing.Bitmap 32, 32
$g2 = [System.Drawing.Graphics]::FromImage($bmp32)
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g2.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g2.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 40))
$c1 = [System.Drawing.Color]::FromArgb(255, 0, 132, 255)
$c2 = [System.Drawing.Color]::FromArgb(255, 38, 208, 168)
$rect32 = New-Object System.Drawing.RectangleF 0, 0, 32, 32
$b2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush ($rect32, $c1, $c2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$font32 = New-Object System.Drawing.Font "Segoe UI", 18.0, [System.Drawing.FontStyle]::Bold
$sf32 = New-Object System.Drawing.StringFormat
$sf32.Alignment = [System.Drawing.StringAlignment]::Center
$sf32.LineAlignment = [System.Drawing.StringAlignment]::Center
$g2.DrawString("P", $font32, $b2, $rect32, $sf32)
$font32.Dispose()
$b2.Dispose()
$sf32.Dispose()
$g2.Dispose()
$icon = [System.Drawing.Icon]::FromHandle($bmp32.GetHicon())
$fs = [System.IO.File]::Create($icoPath)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp32.Dispose()

Write-Host "Wrote icons under $pub and $icoPath"
