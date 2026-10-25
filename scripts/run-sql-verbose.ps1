param(
  [Parameter(Mandatory = $true)][string]$SqlFile,
  [string]$ProjectRef = "gyymkgohcijeksmrzuyw"
)
$ErrorActionPreference = "Stop"

$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredManV {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManV').Type) { Add-Type -TypeDefinition $sig -Language CSharp }
$ptr = [IntPtr]::Zero
[CredManV]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr) | Out-Null
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManV+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
[CredManV]::CredFree($ptr)

$sql = [System.IO.File]::ReadAllText($SqlFile)
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 104857600
$bodyJson = $ser.Serialize(@{ query = $sql })

Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Add("Authorization", "Bearer $pat")
$content = New-Object System.Net.Http.StringContent($bodyJson, [System.Text.Encoding]::UTF8, "application/json")
$resp = $client.PostAsync("https://api.supabase.com/v1/projects/$ProjectRef/database/query", $content).Result
$respBody = $resp.Content.ReadAsStringAsync().Result
Write-Output ("STATUS: " + [int]$resp.StatusCode)
Write-Output ("BODY: " + $respBody)
