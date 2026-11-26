# Genere les images de l'installateur Windows (bandeau lateral et en-tete)
# aux couleurs du logiciel. Usage : powershell -File build/installer-art.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$icon = [System.Drawing.Image]::FromFile((Join-Path $root "icons\256x256.png"))

function New-Color($hex, $alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

function Save-Bmp($bmp, $name) {
  # NSIS attend un BMP 24 bits.
  $out = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height)
  $g.Dispose()
  $out.Save((Join-Path $root $name), [System.Drawing.Imaging.ImageFormat]::Bmp)
  $out.Dispose()
}

function Set-Quality($g) {
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.TextRenderingHint = "AntiAliasGridFit"
}

# --- Bandeau lateral (pages Bienvenue et Fin) : 164 x 314 -------------------
$w = 164; $h = 314
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
Set-Quality $g
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, $h), (New-Color "#161C29"), (New-Color "#0B0D10")
$g.FillRectangle($bg, 0, 0, $w, $h)

# Trame de points discrete.
$dot = New-Object System.Drawing.SolidBrush (New-Color "#FFFFFF" 14)
for ($y = 10; $y -lt $h; $y += 14) { for ($x = 10; $x -lt $w; $x += 14) { $g.FillEllipse($dot, $x, $y, 2, 2) } }

# Halo derriere l'icone.
$halo = New-Object System.Drawing.Drawing2D.GraphicsPath
$halo.AddEllipse(22, 22, 120, 120)
$haloBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $halo
$haloBrush.CenterColor = New-Color "#34D399" 70
$haloBrush.SurroundColors = @((New-Color "#34D399" 0))
$g.FillPath($haloBrush, $halo)
$g.DrawImage($icon, 42, 42, 80, 80)

$white = New-Object System.Drawing.SolidBrush (New-Color "#E8EAEE")
$muted = New-Object System.Drawing.SolidBrush (New-Color "#8B93A1")
$center = New-Object System.Drawing.StringFormat
$center.Alignment = "Center"
$title = New-Object System.Drawing.Font "Segoe UI", 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$small = New-Object System.Drawing.Font "Segoe UI", 10.5, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$mono = New-Object System.Drawing.Font "Consolas", 10, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString("IA CLI Launcher", $title, $white, (New-Object System.Drawing.RectangleF 0, 142, $w, 20), $center)
$g.DrawString("Tes IA en ligne de commande, r$([char]0xE9)unies au m$([char]0xEA)me endroit.", $small, $muted, (New-Object System.Drawing.RectangleF 14, 166, ($w - 28), 40), $center)

# Petite invite de commande.
$card = New-Object System.Drawing.SolidBrush (New-Color "#0B0D10")
$cardLine = New-Object System.Drawing.Pen (New-Color "#2A3140"), 1
$g.FillRectangle($card, 16, 222, ($w - 32), 44)
$g.DrawRectangle($cardLine, 16, 222, ($w - 32), 44)
$teal = New-Object System.Drawing.SolidBrush (New-Color "#34D399")
$g.DrawString(">_ claude", $mono, $teal, 24, 230)
$g.DrawString(">_ codex", $mono, $muted, 24, 246)

# Liseré degrade en bas.
$bar = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $w, 0), (New-Color "#5EEAD4"), (New-Color "#22D3EE")
$g.FillRectangle($bar, 0, ($h - 4), $w, 4)
$g.Dispose()
Save-Bmp $bmp "installer-sidebar.bmp"
$bmp.Dispose()

# --- En-tete (autres pages) : 150 x 57, a droite ------------------------------
$w = 150; $h = 57
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
Set-Quality $g
$g.Clear((New-Color "#0B0D10"))
$halo = New-Object System.Drawing.Drawing2D.GraphicsPath
$halo.AddEllipse(88, -4, 64, 64)
$haloBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush $halo
$haloBrush.CenterColor = New-Color "#34D399" 60
$haloBrush.SurroundColors = @((New-Color "#34D399" 0))
$g.FillPath($haloBrush, $halo)
$g.DrawImage($icon, 101, 9, 38, 38)
$g.Dispose()
Save-Bmp $bmp "installer-header.bmp"
$bmp.Dispose()
$icon.Dispose()
"ok"
