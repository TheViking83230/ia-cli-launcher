# Fabrique l'installateur maison d'IA CLI Launcher (installer/setup.cc) :
# compile la fenetre avec MSVC, puis ajoute a la fin l'installateur NSIS
# d'electron-builder (dist\IA-CLI-Launcher-<version>-x64.exe).
#
# Usage : powershell -File scripts/build-setup.ps1
#   -> dist\IA-CLI-Launcher-Setup-<version>.exe
param([switch]$StubOnly, [switch]$Preview)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$obj = Join-Path $root 'installer\obj'
New-Item -ItemType Directory -Force $obj | Out-Null

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Outils C++ MSVC introuvables (Visual Studio Build Tools, charge de travail C++).' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'

$stub = Join-Path $obj 'setup-stub.exe'
$src = Join-Path $root 'installer'
$level = if ($Preview) { 'asInvoker' } else { 'requireAdministrator' }
$installerDir = Split-Path $vswhere
$cmd = "set `"PATH=$installerDir;%PATH%`" && `"$vcvars`" >nul && cd /d `"$src`" && " +
       "rc /nologo /fo `"$obj\setup.res`" setup.rc && " +
       "cl /nologo /O2 /MT /utf-8 /EHsc /std:c++17 /DUNICODE /D_UNICODE /Fo`"$obj\\`" setup.cc `"$obj\setup.res`" " +
       "/link /SUBSYSTEM:WINDOWS /MANIFEST:EMBED /MANIFESTUAC:`"level='$level' uiAccess='false'`" /OUT:`"$stub`""
$ErrorActionPreference = 'Continue'
cmd /c $cmd
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $stub)) { throw "Echec de la compilation de l'installateur (code $LASTEXITCODE)." }
Write-Host "OK : $stub"
if ($StubOnly) { return }

$nsis = Join-Path $dist "IA-CLI-Launcher-$version-x64.exe"
if (-not (Test-Path $nsis)) { throw "Installateur NSIS introuvable : $nsis (lance d'abord electron-builder)." }
$unpacked = Join-Path $dist 'win-unpacked'
$appBytes = [uint64]0
if (Test-Path $unpacked) {
  $appBytes = [uint64]((Get-ChildItem $unpacked -Recurse -File | Measure-Object Length -Sum).Sum)
}

$setup = if ($Preview) { Join-Path $obj "Setup-preview.exe" } else { Join-Path $dist "IA-CLI-Launcher-Setup-$version.exe" }
Copy-Item $stub $setup -Force
$out = [IO.File]::Open($setup, 'Append', 'Write')
try {
  $offset = [uint64]$out.Length
  $in = [IO.File]::OpenRead($nsis)
  try { $in.CopyTo($out, 4MB) } finally { $in.Close() }
  $size = [uint64]$out.Length - $offset
  # Pied : offset, taille, taille de l'application, version (24 octets), "IACLIPK1".
  $w = New-Object IO.BinaryWriter($out)
  $w.Write($offset)
  $w.Write($size)
  $w.Write($appBytes)
  $v = New-Object byte[] 24
  $vb = [Text.Encoding]::ASCII.GetBytes($version)
  [Array]::Copy($vb, $v, [Math]::Min($vb.Length, 23))
  $w.Write($v)
  $w.Write([Text.Encoding]::ASCII.GetBytes('IACLIPK1'))
  $w.Flush()
} finally { $out.Close() }
Write-Host ("OK : $setup ({0:N0} Mo)" -f ((Get-Item $setup).Length / 1MB))
