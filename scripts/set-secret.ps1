<#
  Sets an Edge Function secret on the Supabase project through the Management
  API, the same way scripts/run-sql.ps1 runs SQL: PAT out of Windows Credential
  Manager ("Supabase CLI:supabase"), no CLI login, no project link.

  The VALUE IS READ FROM A FILE, never taken as a string argument, so a
  credential never lands in a command line, a shell history or this repo. Point
  -ValueFile at something OUTSIDE the working tree.

      .\scripts\set-secret.ps1 -Name FCM_SERVICE_ACCOUNT_JSON `
        -ValueFile "D:\Salci Projects\Salci-Main-Portal\.secrets\fcm-service-account.json"

  -List prints the names (never the values) the project currently holds.
#>
param(
  [string]$Name,
  [string]$ValueFile,
  [switch]$List,
  [string]$ProjectRef = "gyymkgohcijeksmrzuyw"
)

$ErrorActionPreference = "Stop"

# --- Read PAT from Windows Credential Manager (UTF-8 blob) ---
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredManS {
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'CredManS').Type) {
  Add-Type -TypeDefinition $sig -Language CSharp
}

$ptr = [IntPtr]::Zero
if (-not [CredManS]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) {
  throw "Credential 'Supabase CLI:supabase' not found in Credential Manager."
}
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManS+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $pat = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally {
  [CredManS]::CredFree($ptr)
}

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/secrets"

if ($List) {
  $resp = Invoke-WebRequest -Uri $uri -Method Get `
    -Headers @{ Authorization = "Bearer $pat" } -UseBasicParsing
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $rows = $ser.DeserializeObject($resp.Content)
  Write-Output "secrets on $ProjectRef (names only):"
  foreach ($r in $rows) { Write-Output ("  " + $r["name"]) }
  exit 0
}

if (-not $Name -or -not $ValueFile) {
  throw "Both -Name and -ValueFile are required (or pass -List)."
}
if (-not (Test-Path $ValueFile)) {
  throw "Value file not found: $ValueFile"
}

$full = (Resolve-Path $ValueFile).Path
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($full.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to read a secret from inside the working tree ($full). Move it outside the repo first."
}

$value = [System.IO.File]::ReadAllText($full).Trim()
if (-not $value) { throw "Value file is empty: $full" }

# JavaScriptSerializer, not ConvertTo-Json: PS 5.1's converter mangles long
# strings with embedded newlines, which is exactly what a PEM private key is.
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 104857600
$bodyJson = $ser.Serialize(@(@{ name = $Name; value = $value }))
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

try {
  $resp = Invoke-WebRequest -Uri $uri -Method Post -Body $bodyBytes `
    -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json" -UseBasicParsing
  # Never echo the value.
  Write-Output "HTTP $($resp.StatusCode): set $Name ($($value.Length) chars) on $ProjectRef"
} catch {
  $r = $_.Exception.Response
  if ($r) {
    $errBody = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $errBody = $_.ErrorDetails.Message }
    if (-not $errBody) {
      $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
      $errBody = $reader.ReadToEnd()
    }
    Write-Output "HTTP ERROR $([int]$r.StatusCode): $errBody"
  } else {
    throw
  }
}
