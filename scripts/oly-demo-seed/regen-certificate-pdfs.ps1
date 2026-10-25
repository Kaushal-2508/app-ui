# Generate the MISSING Olympiad certificate PDFs for the New Flow Demo school
# via the real oly-generate-certificate-pdf edge function. The later demo seeds
# (Class 8, extra Class 9/10) wrote oly_results rows but never ran the publish
# pipeline's certificate child, so certificate_pdf_path stayed null and the
# "Certificate" download button is disabled. This back-fills them.
#
# The function is idempotent (skips rows that already have a path, skips absent),
# so it only targets non-absent rows where certificate_pdf_path IS NULL. Nothing
# is cleared, so a single failure is harmless — we continue and report counts.
#   -Limit N   only the first N (highest % first). Omit = all missing.
param(
  [int]$Limit = 0
)
$ErrorActionPreference = "Stop"
$ref = "gyymkgohcijeksmrzuyw"
$URL = "https://$ref.supabase.co"
$SCHOOL = "edec11b2-2604-4e58-bfdb-2dfa05f8d3a1"
$ADMIN_EMAIL = "bhanu@salci.in"

# ── PAT from Windows Credential Manager ───────────────────────────────────────
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManC {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManC').Type) { Add-Type -TypeDefinition $sig }
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManC]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManC+CREDENTIAL])
$cb = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $cb, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($cb)

function Invoke-Sql([string]$q) {
  $body = @{ query = $q } | ConvertTo-Json -Depth 4
  $bb = [System.Text.Encoding]::UTF8.GetBytes($body)
  return Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json; charset=utf-8" -Body $bb
}

# ── API keys (reveal) ─────────────────────────────────────────────────────────
$keys = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $pat" }
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
$anonKey    = ($keys | Where-Object { $_.name -eq "anon" }).api_key
if (-not $serviceKey -or -not $anonKey) { throw "Could not read api keys" }

# ── Mint a super-admin session via magiclink OTP ──────────────────────────────
$genBody = @{ type = "magiclink"; email = $ADMIN_EMAIL } | ConvertTo-Json
$gen = Invoke-RestMethod -Method Post -Uri "$URL/auth/v1/admin/generate_link" -Headers @{ apikey = $serviceKey; Authorization = "Bearer $serviceKey" } -ContentType "application/json" -Body $genBody
$otp = $gen.email_otp; if (-not $otp -and $gen.properties) { $otp = $gen.properties.email_otp }
if (-not $otp) { throw "No email_otp in generate_link response" }
$verBody = @{ type = "magiclink"; email = $ADMIN_EMAIL; token = $otp } | ConvertTo-Json
$ver = Invoke-RestMethod -Method Post -Uri "$URL/auth/v1/verify" -Headers @{ apikey = $anonKey } -ContentType "application/json" -Body $verBody
$jwt = $ver.access_token
if (-not $jwt) { throw "No access_token from verify" }
Write-Output "Minted super-admin JWT for $ADMIN_EMAIL"

# ── Targets: non-absent results still missing a certificate, highest % first ──
$q = "select json_agg(x) from (select r.id, s.full_name, r.percentage from oly_results r join oly_students s on s.id = r.oly_student_id where r.oly_school_id = '$SCHOOL' and r.certificate_tier <> 'absent' and r.certificate_pdf_path is null order by r.percentage desc) x;"
$rows = (Invoke-Sql $q)[0].json_agg
if (-not $rows) { Write-Output "Nothing to do - every non-absent result already has a certificate."; return }
if ($Limit -gt 0) { $rows = $rows | Select-Object -First $Limit }
Write-Output "Targeting $($rows.Count) missing certificate(s)"

$ok = 0; $fail = 0
foreach ($r in $rows) {
  $rid = $r.id
  $fnBody = @{ oly_result_id = $rid } | ConvertTo-Json
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$URL/functions/v1/oly-generate-certificate-pdf" -Headers @{ apikey = $anonKey; Authorization = "Bearer $jwt" } -ContentType "application/json" -Body $fnBody
    Write-Output ("OK   {0,-22} {1,6}%  -> {2}" -f $r.full_name, $r.percentage, ($resp.path))
    $ok++
  } catch {
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    Write-Output ("FAIL {0,-22} {1,6}%  -> {2}" -f $r.full_name, $r.percentage, $msg)
    $fail++
  }
}
Write-Output "Done. ok=$ok fail=$fail"
