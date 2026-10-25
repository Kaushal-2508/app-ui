# Run a SQL file (or -Sql string) against prod via Supabase Management API.
# PAT comes from Windows Credential Manager ("Supabase CLI:supabase").
# Output JSON is written to -OutFile (default: result.json next to this script).
param(
  [string]$SqlFile,
  [string]$Sql,
  [string]$OutFile = "$PSScriptRoot\result.json"
)

$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManQ {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'CredManQ').Type) {
  Add-Type -TypeDefinition $sig
}
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManQ]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManQ+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($bytes)

if ($SqlFile) { $query = [System.IO.File]::ReadAllText($SqlFile) }
elseif ($Sql) { $query = $Sql }
else { throw "Provide -SqlFile or -Sql" }

# Send the body as UTF-8 BYTES: PS 5.1 Invoke-RestMethod encodes string bodies
# as Latin-1, which silently mangles any non-ASCII SQL (the 2026-06-12
# demo-question garbling). Prefer ASCII-only SQL anyway (LaTeX/escapes).
$body = @{ query = $query } | ConvertTo-Json -Depth 3
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
try {
  $resp = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/gyymkgohcijeksmrzuyw/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json; charset=utf-8" -Body $bodyBytes
  $json = $resp | ConvertTo-Json -Depth 12
  if ($null -eq $json) { $json = "[]" }
  [System.IO.File]::WriteAllText($OutFile, $json, [System.Text.Encoding]::UTF8)
  Write-Output "OK -> $OutFile"
} catch {
  $err = $_.ErrorDetails.Message
  if (-not $err) { $err = $_.Exception.Message }
  [System.IO.File]::WriteAllText($OutFile, "ERROR: $err", [System.Text.Encoding]::UTF8)
  Write-Output "FAILED -> $OutFile"
}
