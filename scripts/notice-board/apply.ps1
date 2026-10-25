param(
  [Parameter(Mandatory = $true)][string]$Migration,
  [Parameter(Mandatory = $true)][string]$Verify
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Output "=== APPLY $Migration ==="
& "$root\scripts\run-sql.ps1" -SqlFile $Migration -OutFile "$env:TEMP\nb_apply.json"
Get-Content "$env:TEMP\nb_apply.json" -Raw

Write-Output "=== VERIFY $Verify ==="
& "$root\scripts\run-sql.ps1" -SqlFile $Verify -OutFile "$env:TEMP\nb_verify.json"
$raw = Get-Content "$env:TEMP\nb_verify.json" -Raw
Write-Output $raw
if ($raw -match '"ok_[a-z_0-9]+":false') {
  throw "VERIFY FAILED - at least one assertion returned false"
}
Write-Output "ALL ASSERTIONS PASSED"
