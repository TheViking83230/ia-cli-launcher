# Genere les icones de l'application a partir de la marque "IA".
# Produit build/icon.png (512x512, utilise par Linux) et build/icon.ico (Windows).
# Lancer :  powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing

$buildDir = Join-Path $PSScriptRoot "..\build"
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }
$buildDir = (Resolve-Path $buildDir).Path

# Dessine la marque "IA" sur un carre arrondi sombre, texte vert accent.
function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Fond : carre arrondi (rayon = 18% de la taille).
    $radius = [int]($size * 0.18)
    $d = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d - 1, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d - 1, $size - $d - 1, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d - 1, $d, $d, 90, 90)
    $path.CloseFigure()

    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 32, 37, 48),   # #202530
        [System.Drawing.Color]::FromArgb(255, 16, 19, 26))   # #10131a
    $g.FillPath($bg, $path)

    # Texte "IA" centre, en vert accent #45d483.
    $fontSize = [single]($size * 0.42)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 69, 212, 131))
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, [single](-$size * 0.02), $size, $size)
    $g.DrawString("IA", $font, $accent, $rect, $fmt)

    $g.Dispose()
    return $bmp
}

# --- icon.png (512) ---
$png512 = New-IconBitmap 512
$pngPath = Join-Path $buildDir "icon.png"
$png512.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Cree : $pngPath"

# --- icon.ico (PNG 256 encapsule au format ICO) ---
$bmp256 = New-IconBitmap 256
$ms = New-Object System.IO.MemoryStream
$bmp256.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[byte[]]$pngData = $ms.ToArray()
$ms.Dispose()
Write-Output "PNG 256 : $($pngData.Length) octets"
$icoPath = Join-Path $buildDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)            # reserved
$bw.Write([uint16]1)            # type = icone
$bw.Write([uint16]1)            # nombre d'images
$bw.Write([byte]0)              # largeur 0 => 256
$bw.Write([byte]0)              # hauteur 0 => 256
$bw.Write([byte]0)              # palette
$bw.Write([byte]0)              # reserved
$bw.Write([uint16]1)            # plans
$bw.Write([uint16]32)           # bits/pixel
$bw.Write([uint32]$pngData.Length)
$bw.Write([uint32]22)           # offset des donnees (6 + 16)
$bw.Write($pngData)
$bw.Flush(); $bw.Dispose(); $fs.Dispose()
Write-Output "Cree : $icoPath"

$png512.Dispose(); $bmp256.Dispose()
