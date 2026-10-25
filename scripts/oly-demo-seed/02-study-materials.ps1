# OLY DEMO SEED — 02 STUDY MATERIALS
# Generates minimal one-page PDFs, uploads them to the olympiad-study-material
# bucket via the storage REST API (service role key fetched from the
# Management API), then inserts oly_study_materials rows via SQL.
$ErrorActionPreference = "Stop"
$root = "d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main\scripts\oly-demo-seed"
$ref = "gyymkgohcijeksmrzuyw"

# --- PAT from credential manager ---
$sig = @'
using System;
using System.Runtime.InteropServices;
public class CredManS {
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
if (-not ([System.Management.Automation.PSTypeName]'CredManS').Type) { Add-Type -TypeDefinition $sig }
[IntPtr]$ptr = [IntPtr]::Zero
if (-not [CredManS]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "CredRead failed" }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManS+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$pat = [System.Text.Encoding]::UTF8.GetString($bytes)

# --- service role key via Management API ---
$keys = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/api-keys?reveal=true" -Headers @{ Authorization = "Bearer $pat" }
$serviceKey = ($keys | Where-Object { $_.name -eq "service_role" }).api_key
if (-not $serviceKey) { throw "service_role key not found" }

# --- minimal valid one-page PDF builder ---
function Build-Pdf([string]$title, [string]$subtitle, [string]$outPath) {
  $esc = { param($s) $s -replace '\\','\\\\' -replace '\(','\(' -replace '\)','\)' }
  $t = & $esc $title
  $st = & $esc $subtitle
  $content = "BT /F1 20 Tf 60 710 Td ($t) Tj ET`nBT /F1 11 Tf 60 680 Td ($st) Tj ET`nBT /F1 11 Tf 60 650 Td (This is demo study material seeded for the SALCI Olympiad demo school.) Tj ET"
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
  [void]$sb.Append("xref`n0 $($objects.Count + 1)`n")
  [void]$sb.Append("0000000000 65535 f `n")
  foreach ($o in $offsets) { [void]$sb.Append(("{0:D10} 00000 n `n" -f $o)) }
  [void]$sb.Append("trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xrefPos`n%%EOF")
  [System.IO.File]::WriteAllBytes($outPath, [System.Text.Encoding]::ASCII.GetBytes($sb.ToString()))
}

# --- materials manifest: subject_id, grade_id, title, description ---
$C9  = "d9ec752e-e972-447c-b099-ccf502d554ab"
$C10 = "17bf8c34-4bb6-404b-820c-ae58ea359c16"
$MATH = "943791db-a7e8-409a-a725-07ccc6cde3ee"
$SCI  = "bb031046-f4a4-4cf1-a733-6403b23643cd"
$GK   = "60f55974-5713-4bb7-9483-54ba462c4908"
$CS   = "23ae1b4e-e585-4c68-880b-a12b2103ae23"
$ENG  = "bde40945-a493-40ef-a999-9549e0feb911"

$materials = @(
  @{ s=$MATH; g=$C9;  o=1; t="Number Systems and Polynomials - Practice Set"; d="Worked examples and practice questions" },
  @{ s=$MATH; g=$C9;  o=2; t="Geometry Essentials - Quick Revision";          d="Coordinate geometry and triangles at a glance" },
  @{ s=$SCI;  g=$C9;  o=1; t="Matter and Atoms - Concept Notes";              d="States of matter, atoms and molecules" },
  @{ s=$SCI;  g=$C9;  o=2; t="Motion and Force - Solved Examples";            d="Laws of motion with solved numericals" },
  @{ s=$GK;   g=$C9;  o=1; t="India and the World - Fact Book";               d="Capitals, currencies and national symbols" },
  @{ s=$GK;   g=$C9;  o=2; t="Sports and Current Affairs Digest";             d="Quick-fire facts for the GK paper" },
  @{ s=$CS;   g=$C10; o=1; t="Computer Fundamentals - Crash Notes";           d="Hardware, software and number systems" },
  @{ s=$CS;   g=$C10; o=2; t="Internet and Cyber Safety Handbook";            d="Web basics, protocols and staying safe online" },
  @{ s=$ENG;  g=$C10; o=1; t="Grammar and Vocabulary Workbook";               d="Tenses, parts of speech, synonyms and antonyms" },
  @{ s=$ENG;  g=$C10; o=2; t="Reading Comprehension Practice";                d="Passages with question sets and strategies" },
  @{ s=$GK;   g=$C10; o=1; t="World Geography Fact Sheet";                    d="Oceans, mountains and world organisations" },
  @{ s=$GK;   g=$C10; o=2; t="Science and Discoveries Digest";                d="Inventors, elements and milestones" }
)

$tmpDir = Join-Path $root "pdf-tmp"
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$values = @()
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$n = 0
foreach ($m in $materials) {
  $n++
  $safe = ($m.t -replace '[^a-zA-Z0-9._-]', '_') + ".pdf"
  $local = Join-Path $tmpDir $safe
  Build-Pdf $m.t "SALCI Olympiad 2026 - $($m.d)" $local
  $size = (Get-Item $local).Length
  $path = "$($m.s)/$($m.g)/$($epoch + $n)-$safe"
  $uri = "https://$ref.supabase.co/storage/v1/object/olympiad-study-material/$path"
  Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $serviceKey"; apikey = $serviceKey; "x-upsert" = "true" } -ContentType "application/pdf" -InFile $local | Out-Null
  Write-Output "uploaded: $path ($size bytes)"
  $values += "('$($m.s)','$($m.g)','$($m.t -replace "'","''")','$($m.d -replace "'","''")','$path',$size,$($m.o))"
}

# --- register rows (idempotent: clear previous demo rows for these pairs first) ---
$sql = @"
delete from oly_study_materials
 where (subject_id, grade_level_id) in (
   ('$MATH'::uuid,'$C9'::uuid),('$SCI'::uuid,'$C9'::uuid),('$GK'::uuid,'$C9'::uuid),
   ('$CS'::uuid,'$C10'::uuid),('$ENG'::uuid,'$C10'::uuid),('$GK'::uuid,'$C10'::uuid)
 );
insert into oly_study_materials (subject_id, grade_level_id, title, description, storage_path, file_size_bytes, display_order)
values $($values -join ",`n");
select count(*) as materials from oly_study_materials;
"@
$body = @{ query = $sql } | ConvertTo-Json -Depth 3
$resp = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $pat" } -ContentType "application/json" -Body $body
$resp | ConvertTo-Json -Depth 5
