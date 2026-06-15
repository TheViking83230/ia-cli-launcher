param(
  [string]$Path = "dist",
  [string]$PfxPath = $env:SIGN_PFX_PATH,
  [string]$PfxPassword = $env:SIGN_PFX_PASSWORD,
  [switch]$CreateSelfSigned
)

$ErrorActionPreference = "Stop"

function Get-SigningCertificate {
  if ($PfxPath) {
    if (-not (Test-Path -LiteralPath $PfxPath)) {
      throw "Certificat PFX introuvable: $PfxPath"
    }

    if (-not $PfxPassword) {
      throw "Mot de passe PFX manquant. Definir SIGN_PFX_PASSWORD ou passer -PfxPassword."
    }

    $securePassword = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
    $imported = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $securePassword
    return $imported | Select-Object -First 1
  }

  if ($CreateSelfSigned) {
    $existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
      Where-Object { $_.Subject -eq "CN=Dev OpA Local Code Signing" } |
      Sort-Object NotAfter -Descending |
      Select-Object -First 1

    if ($existing) {
      return $existing
    }

    return New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject "CN=Dev OpA Local Code Signing" `
      -CertStoreLocation Cert:\CurrentUser\My `
      -KeyAlgorithm RSA `
      -KeyLength 3072 `
      -HashAlgorithm SHA256 `
      -NotAfter (Get-Date).AddYears(3)
  }

  throw "Aucun certificat fourni. Utiliser -CreateSelfSigned pour un test local ou SIGN_PFX_PATH/SIGN_PFX_PASSWORD pour une vraie signature."
}

$resolvedPath = Resolve-Path -LiteralPath $Path
$certificate = Get-SigningCertificate
$targets = Get-ChildItem -LiteralPath $resolvedPath -Recurse -File |
  Where-Object { $_.Extension -in ".exe", ".dll", ".node" }

if (-not $targets) {
  throw "Aucun binaire a signer dans $resolvedPath"
}

foreach ($target in $targets) {
  $signature = Set-AuthenticodeSignature -FilePath $target.FullName -Certificate $certificate -HashAlgorithm SHA256
  if ($signature.Status -notin "Valid", "UnknownError") {
    throw "Signature echouee pour $($target.FullName): $($signature.StatusMessage)"
  }
  Write-Output "Signe: $($target.FullName) [$($signature.Status)]"
}

Write-Output "Certificat: $($certificate.Subject)"
