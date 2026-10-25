# Real outreach send of the SALCI Olympiad email (email-template.html) to a single school,
# with the team CC'd. Uses the broadcast-email edge function (service_role authed). Unlike
# send-sample-emails.ps1 this is a REAL send (no [SAMPLE] subject), routes TO the school and
# CC's the given addresses, and rewrites the greeting to "Dear <Name>,".
param(
  [string]   $To           = "40765@cbseshiksha.in",
  [string]   $GreetingName = "Nitin Sir",
  [string[]] $Cc           = @("ceo@salci.ai", "ekansh@salci.ai", "tushar@salci.ai"),
  [string]   $Subject      = "An Olympiad that gives every student a report, not just a rank"
)
$ErrorActionPreference = "Stop"
$ref = "gyymkgohcijeksmrzuyw"
$URL = "https://$ref.supabase.co"
$dir = "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main/marketing/olympiad"
$FROM = "SALCI Olympiad <team@salci.in>"

# PAT from Windows Credential Manager
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManO {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManO').Type) { Add-Type -TypeDefinition $sig }
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManO]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManO+CREDENTIAL])
$cb = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $cb, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($cb)

$keys = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $pat" }
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
$anonKey    = ($keys | Where-Object { $_.name -eq "anon" }).api_key
if (-not $serviceKey -or -not $anonKey) { throw "missing api keys" }

# any single institution satisfies broadcast-email's lookup guard (preview_only_email sets the real TO)
$body = @{ query = "select name from institutions order by name limit 1;" } | ConvertTo-Json
$bb = [System.Text.Encoding]::UTF8.GetBytes($body)
$instRes = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json; charset=utf-8" -Body $bb
$instName = $instRes[0].name

function Upload-Obj([string]$localPath,[string]$key,[string]$mime) {
  Invoke-RestMethod -Method Post -Uri "$URL/storage/v1/object/olympiad-receipts/$key" -Headers @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey"; "x-upsert" = "true" } -ContentType $mime -InFile $localPath | Out-Null
}
function Sign-Url([string]$key) {
  $r = Invoke-RestMethod -Method Post -Uri "$URL/storage/v1/object/sign/olympiad-receipts/$key" -Headers @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" } -ContentType "application/json" -Body (@{ expiresIn = 604800 } | ConvertTo-Json)
  return "$URL/storage/v1$($r.signedURL)"
}

Upload-Obj "$dir/assets/salci-logo.png"            "marketing/salci-logo.png"        "image/png"
Upload-Obj "$dir/out/salci-olympiad-flow.png"      "marketing/olympiad-flow.png"     "image/png"
Upload-Obj "$dir/out/salci-olympiad-brochure.pdf"  "marketing/olympiad-brochure.pdf" "application/pdf"
$logoUrl     = Sign-Url "marketing/salci-logo.png"
$flowUrl     = Sign-Url "marketing/olympiad-flow.png"
$brochureUrl = Sign-Url "marketing/olympiad-brochure.pdf"
Write-Output "hosted: logo + flow + brochure OK"

$html = [System.IO.File]::ReadAllText("$dir/email-template.html")
$html = $html.Replace("{{LOGO_URL}}", $logoUrl).Replace("{{FLOW_URL}}", $flowUrl).Replace("{{BROCHURE_URL}}", $brochureUrl)
# Rewrite greeting: "Dear Principal <strong ...>[Name]</strong>," -> "Dear <strong ...>$GreetingName</strong>,"
$oldGreeting = 'Dear Principal <strong style="color:#16202b;">[Name]</strong>,'
$newGreeting = 'Dear <strong style="color:#16202b;">' + $GreetingName + '</strong>,'
if (-not $html.Contains($oldGreeting)) { throw "greeting anchor not found; aborting (template changed)" }
$html = $html.Replace($oldGreeting, $newGreeting)
Write-Output "greeting -> Dear $GreetingName,"
Write-Output ("TO {0}  CC {1}" -f $To, ($Cc -join ", "))
Write-Output ("subject: {0}" -f $Subject)

$payload = @{
  institution_name_pattern = $instName
  preview_only_email       = $To
  cc                       = $Cc
  from_address             = $FROM
  subject                  = $Subject
  html_body                = $html
  entity_name              = "Olympiad outreach: $To ($GreetingName)"
} | ConvertTo-Json -Depth 6
$pb = [System.Text.Encoding]::UTF8.GetBytes($payload)
try {
  $resp = Invoke-RestMethod -Method Post -Uri "$URL/functions/v1/broadcast-email" -Headers @{ apikey = $anonKey; Authorization = "Bearer $serviceKey" } -ContentType "application/json; charset=utf-8" -Body $pb
  Write-Output ("SENT -> {0}  sent={1} failed={2}" -f $To, $resp.sent, $resp.failed)
  if ($resp.results) { $resp.results | ForEach-Object { Write-Output ("        {0} : {1} {2}" -f $_.email, $_.status, $_.error) } }
} catch {
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  Write-Output ("FAIL -> {0}  {1}" -f $To, $msg)
}
Write-Output "DONE"
