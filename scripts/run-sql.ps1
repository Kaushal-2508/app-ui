param(
  [Parameter(Mandatory = $true)][string]$SqlFile,
  [string]$OutFile = "$env:TEMP\sql_result.json",
  [string]$ProjectRef = "gyymkgohcijeksmrzuyw"
)

$ErrorActionPreference = "Stop"

# --- Read PAT from Windows Credential Manager (UTF-8 blob) ---
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
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
if (-not ([System.Management.Automation.PSTypeName]'CredMan').Type) {
  Add-Type -TypeDefinition $sig -Language CSharp
}

$ptr = [IntPtr]::Zero
if (-not [CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) {
  throw "Credential 'Supabase CLI:supabase' not found in Credential Manager."
}
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredMan+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $pat = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally {
  [CredMan]::CredFree($ptr)
}

# --- Build JSON body with JavaScriptSerializer (ConvertTo-Json mangles SQL strings) ---
$sql = [System.IO.File]::ReadAllText($SqlFile)
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 104857600
$bodyJson = $ser.Serialize(@{ query = $sql })
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
try {
  $resp = Invoke-WebRequest -Uri $uri -Method Post -Body $bodyBytes `
    -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json" -UseBasicParsing
  [System.IO.File]::WriteAllText($OutFile, $resp.Content, [System.Text.Encoding]::UTF8)
  Write-Output "HTTP $($resp.StatusCode) -> $OutFile"
} catch {
  $r = $_.Exception.Response
  if ($r) {
    $reader = New-Object System.IO.StreamReader($r.GetResponseStream())
    $errBody = $reader.ReadToEnd()
    # PS 5.1 usually drains the 4xx body into ErrorDetails before we get here,
    # leaving the stream empty. Without this fallback a SQL error from the
    # Management API shows as "HTTP ERROR 400" with no message at all.
    if (-not $errBody -and $_.ErrorDetails -and $_.ErrorDetails.Message) {
      $errBody = $_.ErrorDetails.Message
    }
    [System.IO.File]::WriteAllText($OutFile, $errBody, [System.Text.Encoding]::UTF8)
    Write-Output "HTTP ERROR $([int]$r.StatusCode) -> $OutFile"
    Write-Output $errBody
  } else {
    throw
  }
}
