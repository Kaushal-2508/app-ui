# Send the designed SALCI Olympiad outreach email (email-template.html) to tushar@salci.in
# via the existing broadcast-email edge function (service_role authed; preview_only_email path
# => only this address is emailed). Hosts logo + flow graphic + brochure as 7-day signed URLs.
$ErrorActionPreference = "Stop"
$ref = "gyymkgohcijeksmrzuyw"
$URL = "https://$ref.supabase.co"
$dir = "d:/Salci Projects/Salci-Main-Portal/salci-eco-core-main/marketing/olympiad"
$TO  = "tushar@salci.in"
$FROM = "SALCI Olympiad <team@salci.in>"

# ── PAT from Windows Credential Manager ───────────────────────────────────────
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManE {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManE').Type) { Add-Type -TypeDefinition $sig }
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManE]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManE+CREDENTIAL])
$cb = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $cb, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($cb)

$keys = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $pat" }
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
$anonKey    = ($keys | Where-Object { $_.name -eq "anon" }).api_key
if (-not $serviceKey -or -not $anonKey) { throw "missing api keys" }

# any single institution (preview_only_email overrides recipients)
$body = @{ query = "select name from institutions order by name limit 1;" } | ConvertTo-Json
$bb = [System.Text.Encoding]::UTF8.GetBytes($body)
$instRes = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json; charset=utf-8" -Body $bb
$instName = $instRes[0].name
Write-Output "Institution pattern: $instName"

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

$recipients = @("tushar@salci.in", "ekansh@salci.in", "ceo@salci.in")
foreach ($to in $recipients) {
  $payload = @{
    institution_name_pattern = $instName
    preview_only_email       = $to
    from_address             = $FROM
    subject                  = "[SAMPLE] An Olympiad that gives every student a report - not just a rank"
    html_body                = $html
    entity_name              = "Olympiad outreach (designed template)"
  } | ConvertTo-Json -Depth 6
  $pb = [System.Text.Encoding]::UTF8.GetBytes($payload)
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$URL/functions/v1/broadcast-email" -Headers @{ apikey = $anonKey; Authorization = "Bearer $serviceKey" } -ContentType "application/json; charset=utf-8" -Body $pb
    Write-Output ("SENT -> {0,-18} sent={1} failed={2}" -f $to, $resp.sent, $resp.failed)
    if ($resp.results) { $resp.results | ForEach-Object { Write-Output ("        {0} : {1} {2}" -f $_.email, $_.status, $_.error) } }
  } catch {
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    Write-Output ("FAIL -> {0,-18} {1}" -f $to, $msg)
  }
}
Write-Output "DONE"
