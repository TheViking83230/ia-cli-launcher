<#
  Jeton GitHub de publication, range dans le Gestionnaire d'identifiants de
  Windows (identifiant generique "ia-cli-launcher/github"), chiffre pour le
  compte Windows courant. Rien n'est ecrit dans le projet.

  Enregistrer / remplacer le jeton :
    powershell -ExecutionPolicy Bypass -File scripts/gh-token.ps1 -Set
    (le jeton est demande sans s'afficher ; ou passe par la variable GH_TOKEN)
  Supprimer :
    powershell -ExecutionPolicy Bypass -File scripts/gh-token.ps1 -Remove
  Lire (utilise par scripts/release.js, ne pas lancer a la main) :
    powershell -ExecutionPolicy Bypass -File scripts/gh-token.ps1 -Get
#>
param([switch]$Set, [switch]$Get, [switch]$Remove)

$ErrorActionPreference = "Stop"
$Target = "ia-cli-launcher/github"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LauncherCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWrite(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDelete(string target, int type, int flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr cred);

  public static void Write(string target, string secret) {
    byte[] blob = Encoding.Unicode.GetBytes(secret);
    CREDENTIAL cred = new CREDENTIAL();
    cred.Type = 1; cred.TargetName = target; cred.UserName = "github";
    cred.CredentialBlobSize = blob.Length; cred.Persist = 2;
    cred.CredentialBlob = Marshal.AllocCoTaskMem(blob.Length);
    Marshal.Copy(blob, 0, cred.CredentialBlob, blob.Length);
    try {
      if (!CredWrite(ref cred, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeCoTaskMem(cred.CredentialBlob); }
  }
  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
    } finally { CredFree(ptr); }
  }
  public static bool Delete(string target) { return CredDelete(target, 1, 0); }
}
"@

if ($Get) {
  $token = [LauncherCred]::Read($Target)
  if (-not $token) { exit 2 }
  [Console]::Out.Write($token)
  exit 0
}

if ($Remove) {
  if ([LauncherCred]::Delete($Target)) { Write-Host "Jeton supprime." } else { Write-Host "Aucun jeton enregistre." }
  exit 0
}

if ($Set) {
  $token = $env:GH_TOKEN
  if (-not $token) {
    $secure = Read-Host "Jeton GitHub (github_pat_...)" -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure))
  }
  $token = $token.Trim()
  if ($token -notmatch '^(github_pat_|ghp_)[A-Za-z0-9_]+$') { throw "Ce n'est pas un jeton GitHub valide." }
  [LauncherCred]::Write($Target, $token)
  Write-Host "Jeton enregistre dans le Gestionnaire d'identifiants Windows ($Target)."
  exit 0
}

Write-Host "Utilisation : gh-token.ps1 -Set | -Remove"
