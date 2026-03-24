# build_pharmacology.ps1 (fixed — properly quoted search terms)
# Pulls FDA drug label data for core combat drugs and writes pharmacology/ entries

$outBase = "d:\Temp\Medic Info\triage\pharmacology"

$drugs = @(
    @{ id = "txa"; query = '"tranexamic acid"'; category = "hemostatic" },
    @{ id = "ketamine"; query = '"ketamine"'; category = "analgesia-anesthesia" },
    @{ id = "morphine"; query = '"morphine sulfate"'; category = "analgesia-anesthesia" },
    @{ id = "naloxone"; query = '"naloxone"'; category = "reversal-agent" },
    @{ id = "epinephrine"; query = '"epinephrine"'; category = "cardiac-emergency" },
    @{ id = "amoxicillin"; query = '"amoxicillin"'; category = "antibiotic" },
    @{ id = "doxycycline"; query = '"doxycycline"'; category = "antibiotic" },
    @{ id = "ciprofloxacin"; query = '"ciprofloxacin"'; category = "antibiotic" },
    @{ id = "metronidazole"; query = '"metronidazole"'; category = "antibiotic" },
    @{ id = "cefazolin"; query = '"cefazolin"'; category = "antibiotic" },
    @{ id = "lorazepam"; query = '"lorazepam"'; category = "sedation-seizure" },
    @{ id = "midazolam"; query = '"midazolam"'; category = "sedation-seizure" },
    @{ id = "diazepam"; query = '"diazepam"'; category = "sedation-seizure" },
    @{ id = "aspirin"; query = '"aspirin"'; category = "antiplatelet" },
    @{ id = "ondansetron"; query = '"ondansetron"'; category = "antiemetic" },
    @{ id = "dexamethasone"; query = '"dexamethasone"'; category = "corticosteroid" },
    @{ id = "normal-saline"; query = '"sodium chloride"'; category = "fluid-resuscitation" },
    @{ id = "lactated-ringers"; query = '"lactated ringer"'; category = "fluid-resuscitation" },
    @{ id = "oxytocin"; query = '"oxytocin"'; category = "obstetric" },
    @{ id = "magnesium-sulfate"; query = '"magnesium sulfate"'; category = "obstetric-eclampsia" }
)

foreach ($drug in $drugs) {
    # URL-encode the quoted search term
    $encoded = [Uri]::EscapeDataString($drug.query)
    $url = "https://api.fda.gov/drug/label.json?search=openfda.generic_name:$encoded&limit=1"

    try {
        $resp = Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 15
        $result = $resp.results[0]

        $genericNames = if ($result.openfda.generic_name) { $result.openfda.generic_name } else { @($drug.id) }
        $name = $genericNames[0]
        $brandNames = if ($result.openfda.brand_name -is [array]) { $result.openfda.brand_name } else { @() }
        $rxnorm = if ($result.openfda.rxcui -and $result.openfda.rxcui.Count -gt 0) { $result.openfda.rxcui[0] } else { "" }
        $indications = if ($result.indications_and_usage) { $result.indications_and_usage[0] }           else { "" }
        $dosage = if ($result.dosage_and_administration) { $result.dosage_and_administration[0] }       else { "" }
        $warnings = if ($result.warnings) { $result.warnings[0] }                        else { "" }
        $contraindic = if ($result.contraindications) { $result.contraindications[0] }               else { "" }

        # Trim to reasonable lengths
        $clean = { param($s, $max) ($s -replace '\s+', ' ').Trim() | ForEach-Object { if ($_.Length -gt $max) { $_.Substring(0, $max) + "..." } else { $_ } } }
        $indications = & $clean $indications 1000
        $dosage = & $clean $dosage 1200
        $warnings = & $clean $warnings 800
        $contraindic = & $clean $contraindic 600

        $obj = [ordered]@{
            id                = $drug.id
            name              = $name
            category          = $drug.category
            rxnorm            = $rxnorm
            brand_names       = $brandNames
            description       = $indications
            indications       = @($indications)
            dose              = $dosage
            route             = @("IV", "IO", "IM")
            window            = ""
            contraindications = @($contraindic)
            warnings          = @($warnings)
            regional_names    = [ordered]@{ generic = $name }
            modifiers         = [ordered]@{
                pediatric = [ordered]@{ dose = ""; note = "" }
                obstetric = [ordered]@{ note = "" }
            }
            source            = "OpenFDA / FDA Drug Label"
        }

        $dir = Join-Path $outBase $drug.id
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $json = $obj | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText((Join-Path $dir "en.json"), $json, [System.Text.Encoding]::UTF8)
        Write-Host "OK  $($drug.id) <- $name"

    }
    catch {
        Write-Host "ERR $($drug.id): $($_.Exception.Message)"
    }

    Start-Sleep -Milliseconds 400
}

Write-Host "Done."
