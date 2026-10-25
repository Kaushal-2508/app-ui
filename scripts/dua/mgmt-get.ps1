param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutFile
)
# Read-only GET against the Supabase Management API, using the PAT stored in
# Windows Credential Manager (target "Supabase CLI:supabase", same lookup as
# scripts/run-sql.ps1). Writes the raw body to OutFile and prints the HTTP status.
$ErrorActionPreference = "Stop"
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredManDua {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManDua').Type) { Add-Type -TypeDefinition $sig -Language CSharp }
$ptr = [IntPtr]::Zero
if (-not [CredManDua]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "Credential 'Supabase CLI:supabase' not found" }
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManDua+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $pat = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally { [CredManDua]::CredFree($ptr) }
try {
  $resp = Invoke-WebRequest -Uri ("https://api.supabase.com" + $Path) -Method Get -Headers @{ Authorization = "Bearer $pat" } -UseBasicParsing
  [System.IO.File]::WriteAllText($OutFile, $resp.Content, [System.Text.Encoding]::UTF8)
  Write-Output "HTTP $($resp.StatusCode)"
} catch {
  $msg = ""; if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
  [System.IO.File]::WriteAllText($OutFile, $msg, [System.Text.Encoding]::UTF8)
  $r = $_.Exception.Response
  if ($r) { Write-Output "HTTP ERROR $([int]$r.StatusCode)" } else { Write-Output "ERROR $($_.Exception.Message)" }
}
