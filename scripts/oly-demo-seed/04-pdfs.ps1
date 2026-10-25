# OLY DEMO SEED — 04 PDFs (results, certificates, receipts)
# Uploads per-student PDFs to the olympiad-receipts bucket and registers
# paths: oly_results.result_pdf_path/certificate_pdf_path (no bucket prefix),
# oly_receipts rows (storage_path WITH bucket prefix).
$ErrorActionPreference = "Stop"
$root = "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main\scripts\oly-demo-seed"
$ref = "gyymkgohcijeksmrzuyw"
$SCHOOL = "edec11b2-2604-4e58-bfdb-2dfa05f8d3a1"

$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManP {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManP').Type) { Add-Type -TypeDefinition $sig }
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManP]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManP+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($bytes)

function Invoke-Sql([string]$q) {
  $body = @{ query = $q } | ConvertTo-Json -Depth 3
  return Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json" -Body $body
}

$keys = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $pat" }
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key

function Build-Pdf([string]$title, [string[]]$lines, [string]$outPath) {
  $esc = { param($s) $s -replace '\\','\\\\' -replace '\(','\(' -replace '\)','\)' }
  $t = & $esc $title
  $content = "BT /F1 18 Tf 60 720 Td ($t) Tj ET"
  $y = 685
  foreach ($l in $lines) {
    $le = & $esc $l
    $content += "`nBT /F1 11 Tf 60 $y Td ($le) Tj ET"
    $y -= 22
  }
  $cBytes = [System.Text.Encoding]::ASCII.GetBytes($content)
  $objects = @(
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length $($cBytes.Length) >>`nstream`n$content`nendstream"
  )
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("%PDF-1.4`n")
  $offsets = @()
  for ($i = 0; $i -lt $objects.Count; $i++) {
    $offsets += $sb.Length
    [void]$sb.Append("$($i+1) 0 obj`n$($objects[$i])`nendobj`n")
  }
  $xrefPos = $sb.Length
  [void]$sb.Append("xref`n0 $($objects.Count + 1)`n0000000000 65535 f `n")
  foreach ($o in $offsets) { [void]$sb.Append(("{0:D10} 00000 n `n" -f $o)) }
  [void]$sb.Append("trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xrefPos`n%%EOF")
  [System.IO.File]::WriteAllBytes($outPath, [System.Text.Encoding]::ASCII.GetBytes($sb.ToString()))
}

function Upload-Pdf([string]$local, [string]$path) {
  $uri = "https://$ref.supabase.co/storage/v1/object/olympiad-receipts/$path"
  Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $serviceKey"; apikey = $serviceKey; "x-upsert" = "true" } -ContentType "application/pdf" -InFile $local | Out-Null
}

# --- fetch results + students ---
$q = @"
select json_agg(json_build_object(
  'result_id', r.id, 'student_id', s.id, 'name', s.full_name, 'roll', s.roll_number,
  'class', s.class_label, 'tier', r.certificate_tier, 'pct', r.percentage,
  'obtained', r.total_marks_obtained, 'cert', r.certificate_id,
  'channel', s.enrollment_channel, 'parent_email', s.parent_email,
  'pay_id', p.gateway_payment_id))
from oly_results r
join oly_students s on s.id = r.oly_student_id
left join oly_enrollment_pending p on p.promoted_student_id = s.id and p.status = 'paid'
where r.oly_school_id = '$SCHOOL';
"@
$rows = (Invoke-Sql $q)[0].json_agg
$tmp = Join-Path $root "pdf-tmp"
New-Item -ItemType Directory -Force $tmp | Out-Null
$updates = @()
$receipts = @()
foreach ($r in $rows) {
  $rid = $r.result_id; $sidnum = $r.student_id
  # receipt for every student
  $rcpt = Join-Path $tmp "rcpt.pdf"
  Build-Pdf "Payment Receipt - SALCI Olympiad 2026" @(
    "Student: $($r.name) ($($r.roll))", "Class: $($r.class)",
    "Amount: Rs 500.00 + GST Rs 90.00 = Rs 590.00",
    "Payment method: $(if ($r.channel -eq 'teacher_cash') { 'Cash' } else { 'Online' })",
    "School: New Flow Demo (NEW00A)") $rcpt
  Upload-Pdf $rcpt "$sidnum.pdf"
  $method = if ($r.channel -eq 'teacher_cash') { 'cash' } else { 'online' }
  $payid = if ($r.pay_id) { "'$($r.pay_id)'" } else { 'null' }
  $receipts += "('$sidnum', oly_next_receipt_number(2026), 'olympiad-receipts/$sidnum.pdf', 500.00, 90.00, 590.00, '$method', $payid)"

  if ($r.tier -ne 'absent') {
    $res = Join-Path $tmp "res.pdf"
    Build-Pdf "Olympiad Result - $($r.name)" @(
      "Roll: $($r.roll)   Class: $($r.class)",
      "Score: $($r.obtained) / 30   Percentage: $($r.pct)%",
      "Medal tier: $(($r.tier).ToUpper())",
      "Certificate: $($r.cert)") $res
    Upload-Pdf $res "results/$rid.pdf"
    $cert = Join-Path $tmp "cert.pdf"
    Build-Pdf "Certificate of Achievement" @(
      "This certifies that $($r.name) of $($r.class)",
      "achieved the $(($r.tier).ToUpper()) tier in the SALCI Olympiad 2026.",
      "Certificate ID: $($r.cert)") $cert
    Upload-Pdf $cert "certificates/$rid.pdf"
    $updates += "update oly_results set result_pdf_path = 'results/$rid.pdf', certificate_pdf_path = 'certificates/$rid.pdf', result_pdf_generated_at = timestamptz '2026-06-10 18:02:00+05:30', certificate_pdf_generated_at = timestamptz '2026-06-10 18:03:00+05:30' where id = '$rid';"
  } else {
    $updates += "update oly_results set result_pdf_path = null, certificate_pdf_path = null where id = '$rid';"
  }
  Write-Output "done: $($r.name) [$($r.tier)]"
}

$sql = @"
delete from oly_receipts r using oly_students s where r.oly_student_id = s.id and s.oly_school_id = '$SCHOOL';
insert into oly_receipts (oly_student_id, receipt_number, storage_path, amount_rupees, gst_rupees, total_rupees, payment_method, gateway_payment_id)
values $($receipts -join ",`n");
$($updates -join "`n")
select (select count(*) from oly_receipts r join oly_students s on s.id = r.oly_student_id where s.oly_school_id = '$SCHOOL') as receipts,
       (select count(*) from oly_results where oly_school_id = '$SCHOOL' and result_pdf_path is not null) as results_with_pdf;
"@
(Invoke-Sql $sql) | ConvertTo-Json -Depth 4
