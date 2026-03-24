# build_survival.ps1
# Survival procedures, assessments, and protocol for combat/field use
# Sources: JTS CPGs, TCCC, PHTLS, Wilderness Medicine, US Army FM 4-25.11

$outBase = "d:\Temp\Medic Info\triage"

function Write-Entry($section, $id, $obj, $subdir = $null) {
    $dir = if ($subdir) { "$outBase\$section\$subdir\$id" } else { "$outBase\$section\$id" }
    New-Item -ItemType Directory -Force $dir | Out-Null
    $json = $obj | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText("$dir\en.json", $json, [System.Text.Encoding]::UTF8)
    Write-Host "Written: $section/$id"
}

# ─── ASSESSMENTS ────────────────────────────────────────────────────────────────

Write-Entry "assessments" "dehydration-assessment" ([ordered]@{
        id           = "dehydration-assessment"
        name         = "Dehydration Assessment"
        category     = "circulation"
        description  = "Field assessment for dehydration and heat illness severity. Urine color is the most practical field indicator. Assess mental status as a marker for severe dehydration progressing to heat stroke."
        instructions = "Check urine color, skin turgor, mental status, and vital signs. Dark urine, dry mucous membranes, and tachycardia indicate significant dehydration requiring active rehydration."
        categories   = @(
            [ordered]@{ color = "clear-pale"; label = "Well Hydrated"; description = "Pale yellow to clear urine. No intervention needed." }
            [ordered]@{ color = "yellow"; label = "Mild Dehydration"; description = "Dark yellow urine, thirsty. Oral rehydration. Encourage 250-500 mL water per hour." }
            [ordered]@{ color = "amber-brown"; label = "Moderate-Severe Dehydration"; description = "Amber urine, HR elevated, skin turgor decreased, dry mouth. IV/IO fluids if oral not tolerated. 1-2L LR or NS." }
            [ordered]@{ color = "red"; label = "Danger -- Heat Stroke / Severe"; description = "Minimal urine output, altered LOC, hot dry skin. Medical emergency -- rapid cooling + IV fluids + MEDEVAC." }
        )
        modifiers    = [ordered]@{
            pediatric = [ordered]@{ note = "Children dehydrate faster than adults. Sunken fontanelle (infants), absent tears, and lethargy are critical signs. Weight-based IV: 20 mL/kg LR bolus." }
            obstetric = [ordered]@{ note = "Pregnant women need increased fluid intake. Dehydration can trigger preterm contractions. Aggressive oral rehydration first; IV if not tolerating oral." }
        }
        source       = "PHTLS / Wilderness Medicine / US Army Hot Weather Ops"
    })

# ─── PROCEDURES ────────────────────────────────────────────────────────────────

Write-Entry "procedures" "improvised-splinting" ([ordered]@{
        id            = "improvised-splinting"
        name          = "Improvised Splinting"
        category      = "ortho-stabilization"
        skill_level   = "Basic"
        time_estimate = "5-10 min"
        description   = "Immobilize fractures using available materials to prevent further injury, reduce pain, and limit blood loss into surrounding tissue. Splint in position found unless circulation is compromised -- then straighten gently."
        equipment     = @("SAM splint (preferred)", "Rolled magazines, sticks, tent poles (field improvised)", "Cravat / triangular bandages", "Padding (clothing, foam)", "Tape or strips of fabric")
        steps         = @(
            "Expose and assess the injury -- check circulation, sensation, movement (CSM) distal to fracture before and after.",
            "Control any active bleeding before splinting.",
            "Pad bony prominences generously to prevent pressure sores.",
            "Select splint material long enough to immobilize the joint above AND below the fracture.",
            "Position limb in position of comfort or anatomical alignment -- do not force.",
            "Apply padding, then splint material. Secure with bandages or fabric strips.",
            "Do NOT wrap too tightly -- leave fingertips/toes exposed to monitor CSM.",
            "Reassess CSM after application -- loosen immediately if circulation impaired.",
            "Elevate limb if possible to reduce swelling.",
            "Document time of splint application."
        )
        warnings      = @(
            "Reassess CSM every 15-30 minutes -- swelling can make a correct splint become a tourniquet.",
            "Open fractures: cover wound with sterile dressing first, then splint. Do NOT push bone back in.",
            "Femur fractures can lose 1-2L blood into thigh -- treat aggressively for shock.",
            "Suspected spinal fracture: do NOT improvise splint -- minimize movement, maintain inline stabilization."
        )
        follows       = @("direct-pressure", "tourniquet-application")
        precedes      = @("medevac-9line")
        modifiers     = [ordered]@{
            pediatric = [ordered]@{ note = "Growth plates in children are weaker than ligaments -- suspect fracture even with mild mechanism. Torus (buckle) fractures may have minimal swelling." }
            obstetric = [ordered]@{ note = "Standard splinting applies. Avoid prolonged supine positioning -- left lateral tilt if lying flat." }
        }
        source        = "JTS CPG: Orthopaedic Trauma / PHTLS / TCCC"
    })

Write-Entry "procedures" "patient-movement-techniques" ([ordered]@{
        id            = "patient-movement-techniques"
        name          = "Patient Movement Techniques"
        category      = "casualty-movement"
        skill_level   = "Basic"
        time_estimate = "1-30 min depending on distance and method"
        description   = "Moving a casualty under fire or to a safer location for treatment. The method depends on terrain, distance, number of rescuers, and the casualty's injuries. Speed vs. spinal precaution is a tactical decision -- in TCCC, threat takes priority."
        equipment     = @("SKED litter (preferred)", "NATO litter / portable stretcher", "Improvised litter: poles + jackets/ponchos", "Drag handles (uniform or harness)", "TACEVAC sling")
        steps         = @(
            "CARE UNDER FIRE: Return fire first if armed. Move casualty using fastest drag method -- do not stop to treat in kill zone.",
            "HASTY DRAG (one rescuer): grab collar/drag handle at shoulders, drag on back. Protect head from impact.",
            "FIREMAN CARRY (one rescuer): lift casualty over shoulders for longer distances -- requires casualty to be unconscious or cooperative.",
            "TWO-PERSON CARRY: rescuers link arms under casualty's back and knees. Faster than drag for short distances.",
            "IMPROVISED LITTER: lay two poles 18 inches apart. Weave jackets through poles with buttons inside. Test before loading casualty.",
            "SKED LITTER: unroll, slide under casualty, wrap and secure with straps. Requires 2-4 carriers.",
            "When loading: lift on count of 3, maintain head/body alignment, minimize spinal movement when possible.",
            "If spinal injury suspected and no threat: maintain inline stabilization throughout movement. One person dedicated to head control.",
            "Move to cover, then reassess ABC."
        )
        warnings      = @(
            "TCCC priority: life > limb > spinal precaution. Do not delay movement from a kill zone for spinal precautions.",
            "Fireman carry is contraindicated with suspected spinal injury, femur fracture, or penetrating abdominal trauma.",
            "Improvised litters: test weight capacity before trusting with a casualty.",
            "Moving a casualty with tourniquet: check tourniquet hasn't loosened during movement."
        )
        precedes      = @("medevac-9line")
        modifiers     = [ordered]@{
            pediatric = [ordered]@{ note = "Children are lighter -- one-rescuer carries feasible longer. Maintain head proportionally larger -- higher center of gravity when carrying." }
            obstetric = [ordered]@{ note = "Avoid prone positioning or pressure on abdomen. Lateral (left side preferred) or supine transport with left hip wedge." }
        }
        source        = "FM 4-25.11 (First Aid) / TCCC / PHTLS"
    })

Write-Entry "procedures" "heat-injury-management" ([ordered]@{
        id            = "heat-injury-management"
        name          = "Heat Injury Management"
        category      = "environmental"
        skill_level   = "Basic"
        time_estimate = "Ongoing until MEDEVAC or patient stable"
        description   = "Management of heat cramps, heat exhaustion, and heat stroke. Heat stroke is a life-threatening emergency -- rapid cooling is the treatment. Distinguish heat exhaustion (normal mentation) from heat stroke (altered LOC) immediately."
        equipment     = @("Water (oral + cooling)", "Ice packs or cold wet cloths", "IV supplies (LR or NS)", "Fan or shade", "Rectal thermometer (definitive core temp)")
        steps         = @(
            "ASSESS: Is the casualty alert and oriented? Hot dry skin vs. hot sweaty skin? Core temp if thermometer available.",
            "HEAT CRAMPS: Muscle spasms, normal mentation. Rest in shade, oral rehydration with electrolytes, gentle stretching. Not life-threatening.",
            "HEAT EXHAUSTION: Heavy sweating, weakness, dizziness, normal or near-normal mentation. Move to shade/cool area. Remove excess clothing. Oral fluids (if conscious) or IV LR 1L over 30-60 min. Monitor for progression to heat stroke.",
            "HEAT STROKE (emergency): Altered LOC, confusion, combativeness, or unconsciousness. Core temp > 40C (104F). Hot skin (may be wet or dry). BEGIN: Remove from heat immediately, remove all clothing, wet skin and fan aggressively. Apply ice packs to neck, axillae, and groin (high vascular areas). IV LR 1-2L. Protect airway if unconscious. MEDEVAC immediately.",
            "Do NOT give aspirin or acetaminophen for heat stroke -- does not help, may harm.",
            "Monitor: vitals q15 min, airway, mental status. Document temp trend.",
            "Continue cooling during MEDEVAC -- do not stop for transport."
        )
        warnings      = @(
            "Heat stroke is a life-threatening emergency -- do not mistake it for heat exhaustion. Check mental status.",
            "Cooling is the definitive treatment. Do not delay cooling to establish IV access.",
            "Exertional heat stroke can occur in fit individuals -- physical fitness does not protect.",
            "Hyponatremia (low sodium) from overhydration with plain water can mimic heat stroke -- give electrolyte solution not just water."
        )
        follows       = @("dehydration-assessment")
        precedes      = @("medevac-9line")
        modifiers     = [ordered]@{
            pediatric = [ordered]@{ note = "Children thermoregulate less efficiently. Heat stroke can progress faster. Weight-based fluid: 20 mL/kg LR IV bolus. Core temp via rectal thermometer most accurate." }
            obstetric = [ordered]@{ note = "Maternal hyperthermia (>39C) can cause fetal neural tube defects (early) and fetal distress (late). Aggressive cooling. Fetal heart rate monitoring if available." }
        }
        source        = "JTS CPG: Heat Stroke / PHTLS / US Army Hot Weather Training"
    })

Write-Entry "procedures" "cold-injury-management" ([ordered]@{
        id            = "cold-injury-management"
        name          = "Cold Injury Management"
        category      = "environmental"
        skill_level   = "Basic"
        time_estimate = "Ongoing"
        description   = "Management of frostbite, immersion foot (trench foot), and hypothermia. Cold injuries are preventable -- recognize early signs before tissue damage is irreversible. Handle frostbitten tissue extremely gently."
        equipment     = @("Dry insulating clothing/sleeping bag", "Warm water (38-42C/100-108F) for rewarming bath", "Sterile dressings", "Ibuprofen 400mg PO (if available)", "IV LR (warm if possible)")
        steps         = @(
            "HYPOTHERMIA FIRST: Assess core temp with low-reading thermometer. Mild (32-35C): shivering, confusion. Moderate (28-32C): no shivering, severe confusion. Severe (<28C): unconscious, no pulse detectable.",
            "HYPOTHERMIA -- Mild/Moderate: Remove wet clothing, insulate from ground, warm environment, warm sweet fluids if conscious, heat packs to axillae/groin (not directly on skin). Handle gently -- jarring can trigger VFib.",
            "HYPOTHERMIA -- Severe: Handle VERY gently. Check pulse 60 full seconds before CPR. Begin CPR if no pulse. Warm IV fluids if available. MEDEVAC priority -- 'not dead until warm and dead'.",
            "FROSTBITE: Superficial (skin white/gray, soft underneath) vs. deep (hard, wooden feel, blistering). Do NOT rub the area. Do NOT rewarm if risk of refreezing -- refreezing causes worse damage than delayed rewarming.",
            "FROSTBITE rewarming: Immerse in 38-42C water (not hotter) for 15-30 min until tissue is soft and red/purple. Very painful -- offer analgesia (ketamine or morphine).",
            "After rewarming: pad between toes/fingers with sterile gauze. Do NOT pop blisters. Protect from pressure.",
            "IMMERSION FOOT (Trench Foot): prolonged wet/cold exposure, skin red then pale then blistered. Dry feet, warm slowly, elevate. Do NOT apply direct heat.",
            "Document time of injury and time of rewarming."
        )
        warnings      = @(
            "Do NOT rewarm frostbite if there is any chance of refreezing -- incomplete rewarming + refreezing = catastrophic tissue loss.",
            "Severe hypothermia can mimic death. Check pulse for 60 seconds. 'Not dead until warm and dead.'",
            "Alcohol increases heat loss despite perception of warmth -- do not give alcohol.",
            "VFib risk is high in moderate-severe hypothermia -- minimize manipulation and jarring of the patient."
        )
        follows       = @("hypothermia-prevention")
        precedes      = @("medevac-9line")
        modifiers     = [ordered]@{
            pediatric = [ordered]@{ note = "Children cool faster due to higher surface area to mass ratio. Hypothermia thresholds same. Warm IV fluids critical. Weight-based fluid: 20 mL/kg warm LR." }
            obstetric = [ordered]@{ note = "Maternal hypothermia causes fetal bradycardia and acidosis. Aggressive maternal rewarming is fetal treatment. Fetal monitoring if available." }
        }
        source        = "JTS CPG: Cold Weather Injuries / PHTLS / Wilderness Medicine"
    })

# ─── PROTOCOLS ────────────────────────────────────────────────────────────────

$en = [ordered]@{
    id          = "medevac-9line"
    name        = "9-Line MEDEVAC Request"
    description = "Standardized NATO format for requesting medical evacuation. Transmitted in order, lines 1-9. Lines 1-5 transmitted immediately (unencrypted allowed). Lines 6-9 follow. A correct 9-line gets the bird in the air. An incomplete one delays it."
    source      = "FM 3-04.301 / ATP 4-02.2 / NATO STANAG 3204"
}
$flow = [ordered]@{
    id         = "medevac-9line"
    version    = "NATO-STANAG-3204"
    lines      = @(
        [ordered]@{
            line    = 1
            field   = "Location"
            format  = "Grid coordinates (8-10 digit MGRS) or known landmark"
            example = "AB 1234 5678"
            notes   = "Give the pickup site, not your current position if different."
        }
        [ordered]@{
            line    = 2
            field   = "Radio Frequency / Call Sign"
            format  = "Freq in MHz, then call sign of requesting unit"
            example = "46.25, ALPHA 6"
            notes   = "Give primary freq first. Alternate freq if primary is compromised."
        }
        [ordered]@{
            line    = 3
            field   = "Number of Patients by Precedence"
            format  = "A = Urgent (<2hr), B = Urgent Surgical (<2hr needs OR), C = Priority (<4hr), D = Routine (<24hr), E = Convenience"
            example = "2 Alpha, 1 Delta"
            notes   = "Urgent = life, limb, or eyesight at risk. Be accurate -- affects resource allocation."
        }
        [ordered]@{
            line    = 4
            field   = "Special Equipment Required"
            format  = "A = None, B = Hoist, C = Extraction equip, D = Ventilator"
            example = "Alpha"
            notes   = "Hoist required if no suitable LZ. Ventilator if intubated."
        }
        [ordered]@{
            line    = 5
            field   = "Number of Patients by Type"
            format  = "L = Litter (non-ambulatory), A = Ambulatory (walking wounded)"
            example = "2 Litter, 1 Ambulatory"
            notes   = "Determines aircraft configuration and crew requirements."
        }
        [ordered]@{
            line    = 6
            field   = "Security at Pickup Site"
            format  = "N = No enemy, P = Possible enemy, E = Enemy in area (armed escort needed), X = Enemy troops in area (armed escort essential)"
            example = "Papa"
            notes   = "Transmitted encrypted if possible. Affects whether armed escort required."
        }
        [ordered]@{
            line    = 7
            field   = "Method of Marking Pickup Site"
            format  = "A = Panels, B = Pyrotechnic signal, C = Smoke, D = None, E = Other"
            example = "Charlie -- Purple smoke"
            notes   = "Do NOT transmit smoke color until after aircraft identifies color -- prevents enemy deception."
        }
        [ordered]@{
            line    = 8
            field   = "Patient Nationality and Status"
            format  = "A = US military, B = US civilian, C = Non-US military, D = Non-US civilian, E = EPW (Enemy Prisoner of War)"
            example = "Alpha"
            notes   = "EPW requires armed escort and affects MEDEVAC crew protocols."
        }
        [ordered]@{
            line    = 9
            field   = "NBC Contamination"
            format  = "N = Nuclear, B = Biological, C = Chemical, None if clean"
            example = "None"
            notes   = "If NBC: MEDEVAC crew needs appropriate PPE. Delays response -- declare only if genuine."
        }
    )
    memory_aid = "My Rocks Said Follow Nine Soldiers My Nation"
}

$protoDir = "d:\Temp\Medic Info\triage\protocols\medevac-9line"
New-Item -ItemType Directory -Force $protoDir | Out-Null
$en | ConvertTo-Json -Depth 6 | ForEach-Object { [System.IO.File]::WriteAllText("$protoDir\en.json", $_, [System.Text.Encoding]::UTF8) }
$flow | ConvertTo-Json -Depth 6 | ForEach-Object { [System.IO.File]::WriteAllText("$protoDir\flow.json", $_, [System.Text.Encoding]::UTF8) }
Write-Host "Written: protocols/medevac-9line (en.json + flow.json)"

Write-Host ""
Write-Host "All survival entries written."
