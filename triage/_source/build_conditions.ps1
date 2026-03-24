# build_conditions.ps1
# Reads ICD-10-CM 2025 flat file and creates conditions/ folder per S + T code
# Each folder gets an en.json following the triage schema

$sourceFile = "d:\Temp\Medic Info\triage\_source\icd10cm-2025\icd10cm-codes-2025.txt"
$outBase    = "d:\Temp\Medic Info\triage\conditions"

$lines = Get-Content $sourceFile -Encoding UTF8

$count = 0
foreach ($line in $lines) {
    if ($line.Trim() -eq "") { continue }

    # Format: CODE<space(s)>Description
    $parts = $line -split '\s+', 2
    if ($parts.Count -lt 2) { continue }

    $code = $parts[0].Trim()
    $description = $parts[1].Trim()

    # Only S and T chapters = injuries, wounds, poisonings, trauma
    if ($code -notmatch '^[ST]') { continue }

    # Build a slug from the code for the folder name (code is unique, clean)
    $slug = $code.ToLower()

    $dir = Join-Path $outBase $slug
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    # Infer category from chapter
    $category = switch -Regex ($code) {
        '^S0'  { "head-neck-injury" }
        '^S1'  { "head-neck-injury" }
        '^S2'  { "thorax-injury" }
        '^S3'  { "abdomen-injury" }
        '^S4'  { "shoulder-arm-injury" }
        '^S5'  { "elbow-forearm-injury" }
        '^S6'  { "wrist-hand-injury" }
        '^S7'  { "hip-thigh-injury" }
        '^S8'  { "knee-leg-injury" }
        '^S9'  { "ankle-foot-injury" }
        '^T0[0-3]' { "multi-body-injury" }
        '^T0[4-9]' { "crush-amputation" }
        '^T1[0-4]' { "unspecified-injury" }
        '^T1[5-9]' { "foreign-body" }
        '^T2[0-5]' { "burn-corrosion" }
        '^T2[6-9]' { "burn-corrosion" }
        '^T3'  { "burn-corrosion" }
        '^T4'  { "poisoning-adverse" }
        '^T5'  { "poisoning-adverse" }
        '^T6'  { "poisoning-adverse" }
        '^T7[0-6]' { "environmental-injury" }
        '^T7[7-9]' { "adverse-effects" }
        '^T8'  { "complications-treatment" }
        '^T9'  { "sequelae" }
        default { "injury" }
    }

    $obj = [ordered]@{
        id             = $slug
        icd10          = $code
        name           = $description
        category       = $category
        triage_priority = ""
        description    = $description
        red_flags      = @()
        assess_first   = @()
        procedures     = @()
        drugs          = @()
        modifiers      = [ordered]@{
            pediatric  = [ordered]@{ note = "" }
            obstetric  = [ordered]@{ note = "" }
        }
        escalate_if    = ""
        source         = "ICD-10-CM FY2025"
    }

    $json = $obj | ConvertTo-Json -Depth 5
    $outFile = Join-Path $dir "en.json"
    [System.IO.File]::WriteAllText($outFile, $json, [System.Text.Encoding]::UTF8)
    $count++
}

Write-Host "Done. Created $count condition entries."
