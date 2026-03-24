# build_assessments_procedures_protocols.ps1
# Writes hand-crafted assessments, procedures, protocols, and special_populations
# sourced from JTS CPGs, PHTLS, and SALT/START/MARCH standards (public domain)

$base = "d:\Temp\Medic Info\triage"

function Write-Entry($folder, $lang, $obj) {
    $dir = Join-Path $base $folder
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $json = $obj | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $dir "$lang.json"), $json, [System.Text.Encoding]::UTF8)
}

# ─────────────────────────────────────────────
# ASSESSMENTS
# ─────────────────────────────────────────────

Write-Entry "assessments\gcs" "en" ([ordered]@{
        id = "gcs"; name = "Glasgow Coma Scale (GCS)"; category = "neurological"
        description = "Standardized neurological scoring of consciousness via eye, verbal, and motor responses. Score range 3-15."
        instructions = "Score each of the three domains independently. Sum all three scores for the total GCS."
        scoring = @(
            [ordered]@{ domain = "Eye"; options = @(
                    [ordered]@{score = 4; label = "Spontaneous" },
                    [ordered]@{score = 3; label = "To voice" },
                    [ordered]@{score = 2; label = "To pain" },
                    [ordered]@{score = 1; label = "None" }) 
            },
            [ordered]@{ domain = "Verbal"; options = @(
                    [ordered]@{score = 5; label = "Oriented" },
                    [ordered]@{score = 4; label = "Confused" },
                    [ordered]@{score = 3; label = "Inappropriate words" },
                    [ordered]@{score = 2; label = "Incomprehensible sounds" },
                    [ordered]@{score = 1; label = "None" }) 
            },
            [ordered]@{ domain = "Motor"; options = @(
                    [ordered]@{score = 6; label = "Obeys commands" },
                    [ordered]@{score = 5; label = "Localizes pain" },
                    [ordered]@{score = 4; label = "Withdraws from pain" },
                    [ordered]@{score = 3; label = "Abnormal flexion (decorticate)" },
                    [ordered]@{score = 2; label = "Extension (decerebrate)" },
                    [ordered]@{score = 1; label = "None" }) 
            }
        )
        interpretation = @(
            [ordered]@{range = @(13, 15); label = "Mild TBI -- monitor closely" },
            [ordered]@{range = @(9, 12); label = "Moderate TBI -- prepare airway" },
            [ordered]@{range = @(3, 8); label = "Severe TBI -- airway at immediate risk, intubate if possible" }
        )
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Use Pediatric GCS (pGCS) for children under 2 years. Verbal scoring adjusted for pre-verbal children." }
        }
        source = "JTS CPG / Standard Neurological Assessment"
    })

Write-Entry "assessments\avpu" "en" ([ordered]@{
        id = "avpu"; name = "AVPU Scale"; category = "neurological"
        description = "Rapid 4-level consciousness assessment. Faster than GCS for initial triage."
        instructions = "Assess the highest level of response the patient demonstrates."
        scoring = @(
            [ordered]@{code = "A"; label = "Alert"; description = "Patient is awake, aware, and responding normally" },
            [ordered]@{code = "V"; label = "Voice"; description = "Patient responds only to verbal stimulation" },
            [ordered]@{code = "P"; label = "Pain"; description = "Patient responds only to painful stimuli (sternal rub, nail bed pressure)" },
            [ordered]@{code = "U"; label = "Unresponsive"; description = "No response to any stimuli -- immediate airway intervention required" }
        )
        interpretation = @(
            [ordered]@{code = "A"; triage = "Stable -- continue assessment" },
            [ordered]@{code = "V"; triage = "Concerning -- monitor airway" },
            [ordered]@{code = "P"; triage = "Critical -- airway at risk, GCS typically <= 8" },
            [ordered]@{code = "U"; triage = "Immediate -- manage airway now" }
        )
        source = "JTS CPG / PHTLS Standard"
    })

Write-Entry "assessments\hemorrhage-class" "en" ([ordered]@{
        id = "hemorrhage-class"; name = "Hemorrhage Classification (Class I-IV)"; category = "circulatory"
        description = "ATLS hemorrhage classification by estimated blood loss and physiological response."
        instructions = "Estimate blood loss and match physiological signs to class. Treatment urgency escalates with class."
        scoring = @(
            [ordered]@{class = "I"; blood_loss_ml = "<750"; blood_loss_pct = "<15%"; hr = "<100"; sbp = "Normal"; rr = "14-20"; mental_status = "Normal"; treatment = "Observe, PO fluids if able" },
            [ordered]@{class = "II"; blood_loss_ml = "750-1500"; blood_loss_pct = "15-30%"; hr = "100-120"; sbp = "Normal"; rr = "20-30"; mental_status = "Anxious"; treatment = "IV access, isotonic crystalloid" },
            [ordered]@{class = "III"; blood_loss_ml = "1500-2000"; blood_loss_pct = "30-40%"; hr = "120-140"; sbp = "Decreased"; rr = "30-40"; mental_status = "Confused"; treatment = "IV fluids + blood products, immediate hemorrhage control" },
            [ordered]@{class = "IV"; blood_loss_ml = ">2000"; blood_loss_pct = ">40%"; hr = ">140"; sbp = "Very low"; rr = ">40"; mental_status = "Lethargic/unconscious"; treatment = "Immediate surgical hemorrhage control -- life-threatening" }
        )
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Children compensate longer before decompensating. Class III/IV may present with near-normal BP until sudden collapse. Trust tachycardia and mental status over BP." }
            obstetric = [ordered]@{ note = "Pregnant patients have 40-50% increased blood volume. May tolerate greater loss before showing signs. Fetal distress may precede maternal signs." }
        }
        source = "ATLS / JTS CPG / PHTLS"
    })

Write-Entry "assessments\shock-index" "en" ([ordered]@{
        id = "shock-index"; name = "Shock Index"; category = "circulatory"
        description = "Rapid single-number indicator of hemodynamic stability. Calculated as HR / SBP. Normal is 0.5-0.7."
        instructions = "Divide heart rate by systolic blood pressure. A rising shock index indicates deterioration."
        scoring = @(
            [ordered]@{range = "<0.6"; label = "Normal -- hemodynamically stable" },
            [ordered]@{range = "0.6-1.0"; label = "Mild shock -- monitor closely" },
            [ordered]@{range = "1.0-1.4"; label = "Moderate shock -- IV access, fluids" },
            [ordered]@{range = ">1.4"; label = "Severe shock -- immediate resuscitation, blood products" }
        )
        modifiers = [ordered]@{
            obstetric = [ordered]@{ note = "Obstetric Shock Index (OSI) uses same formula. SI > 0.9 in pregnant patients is significant. Normal HR is higher in pregnancy (80-100 bpm)." }
        }
        source = "JTS CPG / PHTLS"
    })

Write-Entry "assessments\salt-triage" "en" ([ordered]@{
        id = "salt-triage"; name = "SALT Triage (Sort, Assess, Lifesaving Interventions, Treatment/Transport)"; category = "mass-casualty"
        description = "Mass casualty triage protocol. Standard for multi-casualty events in military and civilian settings."
        instructions = "Step 1: Global sort (walking, waving, still). Step 2: Assess in priority order. Step 3: Perform lifesaving interventions (control major bleeding, open airway, needle decompression, auto-injectors). Step 4: Assign category."
        categories = @(
            [ordered]@{color = "black"; label = "Expectant/Deceased"; description = "Unlikely to survive given available resources, or confirmed deceased" },
            [ordered]@{color = "red"; label = "Immediate (T1)"; description = "Life-threatening injuries, will survive with immediate intervention" },
            [ordered]@{color = "yellow"; label = "Delayed (T2)"; description = "Serious but stable injuries, can wait for care" },
            [ordered]@{color = "green"; label = "Minimal (T3)"; description = "Minor injuries -- walking wounded" },
            [ordered]@{color = "gray"; label = "Expectant"; description = "Unsurvivable injury given current resources -- comfort care only" }
        )
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "JumpSTART triage algorithm modifies SALT for pediatric patients. Respiratory rate thresholds and assessment steps differ for children under 8." }
        }
        source = "SALT Mass Casualty Triage (CDC/CHEMPACK), JTS CPG"
    })

# ─────────────────────────────────────────────
# PROCEDURES
# ─────────────────────────────────────────────

Write-Entry "procedures\direct-pressure" "en" ([ordered]@{
        id = "direct-pressure"; name = "Direct Pressure for Hemorrhage Control"; category = "hemorrhage-control"
        skill_level = "any-responder"; time_estimate = "3-5 min"
        description = "First-line hemorrhage control for accessible extremity and body wounds."
        equipment = @("gloves", "trauma-dressing", "cravat-bandage")
        steps = @(
            "Don gloves if available.",
            "Expose the wound by cutting away clothing.",
            "Apply a trauma dressing or folded cloth directly over the wound.",
            "Press firmly with the heel of your hand. Use your body weight -- not just arm strength.",
            "Hold continuous, uninterrupted pressure for at least 3 minutes.",
            "Do NOT lift the dressing to check -- this disrupts clot formation.",
            "If bleeding soaks through, add another dressing on top. Do not remove the first.",
            "Secure with a pressure bandage if available and move to wound packing or tourniquet if bleeding continues."
        )
        warnings = @(
            "Direct pressure alone is inadequate for arterial bleeds -- escalate to wound packing or tourniquet.",
            "Junctional wounds (groin, axilla, neck) require wound packing, not external pressure alone."
        )
        follows = @()
        precedes = @("wound-packing", "tourniquet-application")
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Proportional pressure only. Avoid compressing the thorax in infants." }
            obstetric = [ordered]@{ note = "Avoid heavy compression over gravid uterus. Use lateral packing if junctional wound near pelvis." }
        }
        source = "JTS CPG / TCCC / PHTLS"
    })

Write-Entry "procedures\wound-packing" "en" ([ordered]@{
        id = "wound-packing"; name = "Hemostatic Wound Packing"; category = "hemorrhage-control"
        skill_level = "combat-lifesaver"; time_estimate = "3-5 min"
        description = "Packing of a non-compressible or junctional wound with hemostatic gauze to control hemorrhage where tourniquet cannot be applied."
        equipment = @("hemostatic-gauze", "nitrile-gloves", "trauma-shears", "pressure-bandage")
        steps = @(
            "Don gloves. Expose the wound fully using trauma shears.",
            "Identify the active bleeding source within the wound cavity.",
            "Open hemostatic gauze and pack it firmly into the wound with your finger, pushing it directly to the bleeding source.",
            "Continue packing until the wound cavity is completely filled.",
            "Apply firm, continuous direct pressure with the heel of your hand for a minimum of 3 minutes.",
            "Do NOT remove any packing material once applied.",
            "Apply a pressure bandage over the packed wound.",
            "Mark the time on the TCCC card or patient's forehead (e.g., 'PKD 0145')."
        )
        warnings = @(
            "Do NOT pack penetrating chest wounds -- use chest seal instead.",
            "If packing a neck wound, apply pressure without compressing both carotids simultaneously.",
            "Reassess within 5 minutes if arterial source suspected."
        )
        follows = @("direct-pressure")
        precedes = @("tourniquet-application")
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Use proportionally less gauze. Apply lighter pressure to avoid thoracic compression in infants." }
            obstetric = [ordered]@{ note = "Avoid deep or aggressive packing pressure near gravid abdomen. Rapid escalation is preferred." }
        }
        source = "TCCC / JTS CPG CoTCCC"
    })

Write-Entry "procedures\tourniquet-application" "en" ([ordered]@{
        id = "tourniquet-application"; name = "Tourniquet Application (Combat Application Tourniquet -- CAT)"; category = "hemorrhage-control"
        skill_level = "any-responder"; time_estimate = "30-60 sec"
        description = "Definitive hemorrhage control for life-threatening extremity bleeding. Apply early -- do not delay."
        equipment = @("cat-tourniquet", "permanent-marker")
        steps = @(
            "Apply tourniquet 2-3 inches (5-7 cm) proximal (above) the wound -- over clothing is acceptable.",
            "Route the self-adhering band around the limb and thread through the friction adaptor buckle.",
            "Pull the band tight and secure it back on itself.",
            "Twist the windlass rod until bleeding stops or distal pulse is absent.",
            "Lock the windlass in the windlass clip.",
            "Apply the windlass strap over the windlass rod to secure.",
            "Write the time of application directly on the tourniquet (use marker) AND on the TCCC card.",
            "Expose and re-evaluate the wound. Reassess after 5 minutes."
        )
        warnings = @(
            "Do NOT remove a tourniquet once applied in the field -- only trained medical personnel in a controlled setting.",
            "Time is critical: tourniquet >2 hours significantly increases limb loss risk. Log time immediately.",
            "Do NOT apply over a joint. If limb has wounds at multiple levels, apply proximal to all wounds.",
            "Improvised tourniquets (belts, ropes) are significantly less effective."
        )
        follows = @("direct-pressure", "wound-packing")
        precedes = @()
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Use narrow pediatric tourniquet if available. Standard CAT can be used but tighten with care. Limbs are smaller -- check distal pulse carefully." }
            obstetric = [ordered]@{ note = "Standard application for extremity wounds. Do not apply to abdomen or pelvis." }
        }
        source = "TCCC / JTS CPG / CoTCCC"
    })

Write-Entry "procedures\needle-decompression" "en" ([ordered]@{
        id = "needle-decompression"; name = "Needle Chest Decompression (NCD)"; category = "respiration"
        skill_level = "combat-medic"; time_estimate = "1-2 min"
        description = "Emergency relief of tension pneumothorax by needle insertion into the second intercostal space. Life-saving intervention."
        equipment = @("14g-needle-catheter-3-25in", "gloves", "chest-seal-optional")
        steps = @(
            "Identify tension pneumothorax: absent breath sounds on affected side, tracheal deviation (late), respiratory distress, hypotension, JVD.",
            "Expose the chest on the affected side.",
            "Locate the 2nd intercostal space, midclavicular line (alternative: 4th/5th ICS, anterior axillary line).",
            "Insert a 14g, 3.25-inch needle-catheter perpendicular to the chest wall, just over the TOP of the 3rd rib (avoids neurovascular bundle).",
            "Advance until a rush of air is felt or audible hiss.",
            "Remove the needle and leave the catheter in place.",
            "Listen for improvement in breath sounds and respiratory effort.",
            "Secure the catheter hub. Do NOT clamp or cover the open end.",
            "Reassess every 5 minutes -- catheter can kink or clot, requiring repeat decompression."
        )
        warnings = @(
            "Use a 3.25-inch needle -- standard 14g angiocatheter (1.5in) frequently fails in military patients due to body armor and musculature.",
            "Bilateral NCD may be required if uncertain which side is affected and patient is peri-arrest.",
            "Do not place on same side as sucking chest wound without first sealing the wound."
        )
        follows = @()
        precedes = @("chest-seal-application")
        modifiers = [ordered]@{
            pediatric = [ordered]@{ note = "Use an appropriately sized needle (smaller patients, 1.5-2in may be sufficient). Use 2nd ICS MCL approach. Landmark recognition is more difficult -- use caution." }
        }
        source = "TCCC / JTS CPG"
    })

Write-Entry "procedures\chest-seal-application" "en" ([ordered]@{
        id = "chest-seal-application"; name = "Occlusive Chest Seal Application"; category = "respiration"
        skill_level = "combat-lifesaver"; time_estimate = "1-2 min"
        description = "Sealing a sucking chest wound (open pneumothorax) with a vented chest seal to prevent air entry while allowing pressure release."
        equipment = @("vented-chest-seal", "gloves", "trauma-shears")
        steps = @(
            "Expose the wound -- cut away or remove clothing.",
            "Wipe the skin around the wound as dry as possible (blood, sweat prevent adhesion).",
            "Open the vented chest seal package.",
            "Place the seal over the wound, centered on the hole. Press firmly, ensuring all edges adhere.",
            "Check valve orientation -- the vent must face outward (away from skin) and remain unobstructed.",
            "Reassess breath sounds. If deterioration continues after sealing, consider tension pneumothorax -- perform NCD.",
            "If a vented seal is unavailable, a non-vented seal can be used but MUST be monitored for tension pneumothorax development."
        )
        warnings = @(
            "Non-vented seals can convert a simple pneumothorax to a tension pneumothorax -- use vented seals only in field.",
            "Three-sided taping (improvised seal) is no longer recommended by CoTCCC -- use commercial vented chest seal.",
            "Always apply a seal to ENTRANCE and EXIT wounds."
        )
        follows = @()
        precedes = @("needle-decompression")
        source = "TCCC / JTS CPG / CoTCCC"
    })

Write-Entry "procedures\airway-management-npa" "en" ([ordered]@{
        id = "airway-management-npa"; name = "Nasopharyngeal Airway (NPA) Insertion"; category = "airway"
        skill_level = "combat-lifesaver"; time_estimate = "1 min"
        description = "Insertion of a flexible nasal airway adjunct to maintain airway patency in an unconscious or semiconscious patient."
        equipment = @("npa-with-safety-pin", "lubricant")
        steps = @(
            "Select appropriate NPA size (measure from nostril to earlobe).",
            "Lubricate the NPA generously with water-soluble lubricant or saline.",
            "Insert the safety pin through the flange if not already present (prevents aspiration).",
            "Insert gently into the right nostril (bevel toward septum), advancing parallel to the palate.",
            "Advance until the flange rests against the nostril.",
            "Reposition the patient (recovery position if no spinal concern) and reassess airway.",
            "If resistance is met, try the left nostril."
        )
        warnings = @(
            "Contraindicated in suspected basilar skull fracture (raccoon eyes, Battle's sign, CSF rhinorrhea).",
            "NPA is unconscious patient's best initial airway adjunct -- OPA can trigger vomiting in semiconscious patients."
        )
        source = "TCCC / JTS CPG"
    })

Write-Entry "procedures\hypothermia-prevention" "en" ([ordered]@{
        id = "hypothermia-prevention"; name = "Hypothermia Prevention (H -- MARCH)"; category = "temperature-management"
        skill_level = "any-responder"; time_estimate = "2-3 min"
        description = "Combat hypothermia is a leading preventable killer in trauma. The lethal triad: hypothermia + acidosis + coagulopathy. Prevent at all costs."
        equipment = @("heat-reflective-blanket", "hypothermia-prevention-kit", "warm-iv-fluids-if-available")
        steps = @(
            "Remove all wet clothing as soon as tactically feasible.",
            "Cover the patient with a heat-reflective (space) blanket -- shiny side IN toward patient.",
            "Wrap head and neck (significant heat loss site).",
            "Insulate from ground -- place something between patient and cold ground surface.",
            "Administer warm IV fluids if available.",
            "Do not allow patient to shiver without cover -- shivering is an early warning sign.",
            "Monitor temperature if thermometer available. Below 35°C (95°F) = hypothermia."
        )
        warnings = @(
            "Hypothermia worsens coagulopathy -- bleeding patients cool down faster and clot less effectively.",
            "Field hypothermia prevention must begin at point of injury, not at CCP."
        )
        source = "TCCC / JTS CPG"
    })

# ─────────────────────────────────────────────
# PROTOCOLS
# ─────────────────────────────────────────────

$marchDir = "d:\Temp\Medic Info\triage\protocols\march"
New-Item -ItemType Directory -Force $marchDir | Out-Null

# Translated display
$marchDisplay = [ordered]@{
    id = "march"; name = "MARCH Protocol"
    description = "The primary trauma management sequence used in Tactical Combat Casualty Care. Addresses the leading causes of preventable combat death in priority order: Massive hemorrhage, Airway, Respiration, Circulation, Hypothermia."
    source = "TCCC / JTS CPG / CoTCCC"
}
[System.IO.File]::WriteAllText("$marchDir\en.json", ($marchDisplay | ConvertTo-Json -Depth 3), [System.Text.Encoding]::UTF8)

# Logic flow -- not translated
$marchFlow = [ordered]@{
    id = "march"; algorithm = "sequential"
    entry = "any-trauma-casualty"
    steps = @(
        [ordered]@{ phase = "M"; label = "Massive Hemorrhage"; check = "visible-arterial-or-major-bleeding"
            yes = [ordered]@{ assess = @("hemorrhage-class", "shock-index"); procedures = @("direct-pressure", "wound-packing", "tourniquet-application"); drugs = @("txa") }
            no = [ordered]@{ next = "A" } 
        },
        [ordered]@{ phase = "A"; label = "Airway"; check = "airway-patent-and-clear"
            yes = [ordered]@{ next = "R" }
            no = [ordered]@{ procedures = @("airway-management-npa"); next = "R" } 
        },
        [ordered]@{ phase = "R"; label = "Respiration"; check = "adequate-chest-rise-both-sides"
            yes = [ordered]@{ next = "C" }
            no = [ordered]@{ assess = @("breath-sounds"); procedures = @("needle-decompression", "chest-seal-application"); next = "C" } 
        },
        [ordered]@{ phase = "C"; label = "Circulation"; check = "none"
            assess = @("shock-index", "hemorrhage-class"); drugs = @("normal-saline", "lactated-ringers"); next = "H" 
        },
        [ordered]@{ phase = "H"; label = "Hypothermia"; check = "none"
            procedures = @("hypothermia-prevention"); next = $null 
        }
    )
}
[System.IO.File]::WriteAllText("$marchDir\flow.json", ($marchFlow | ConvertTo-Json -Depth 6), [System.Text.Encoding]::UTF8)

# ─────────────────────────────────────────────
# SPECIAL POPULATIONS
# ─────────────────────────────────────────────

Write-Entry "special_populations\pediatric\vital-sign-ranges" "en" ([ordered]@{
        id = "pediatric-vital-sign-ranges"; name = "Pediatric Normal Vital Sign Ranges"
        description = "Age-adjusted reference for HR, RR, and SBP. Critical for correct triage classification in pediatric patients -- adult normal ranges are incorrect for children."
        ranges = @(
            [ordered]@{age = "Newborn (0-1 month)"; hr = "100-160"; rr = "30-60"; sbp_mmhg = "60-90"; gcs_min = 15 },
            [ordered]@{age = "Infant (1-12 months)"; hr = "90-150"; rr = "30-60"; sbp_mmhg = "70-100"; gcs_min = 15 },
            [ordered]@{age = "Toddler (1-3 years)"; hr = "80-130"; rr = "24-40"; sbp_mmhg = "80-110"; gcs_min = 15 },
            [ordered]@{age = "Child (3-12 years)"; hr = "70-120"; rr = "18-30"; sbp_mmhg = "80-120"; gcs_min = 15 },
            [ordered]@{age = "Adolescent (>12 years)"; hr = "60-100"; rr = "12-20"; sbp_mmhg = "90-130"; gcs_min = 15 }
        )
        source = "PALS Guidelines / JTS Pediatric CPG"
    })

Write-Entry "special_populations\pediatric\broselow-tape" "en" ([ordered]@{
        id = "broselow-tape"; name = "Broselow Pediatric Emergency Tape Reference"
        description = "Color-coded weight-to-dose reference for pediatric drug administration when a scale is unavailable. Measure child from top of head to heel and match to color band."
        note = "This reference is for ESTIMATION only. Use actual weight when available."
        bands = @(
            [ordered]@{color = "grey"; weight_kg = "3-5"; length_cm = "46-57"; est_age = "Newborn" },
            [ordered]@{color = "pink"; weight_kg = "6-7"; length_cm = "57-67"; est_age = "3-6 months" },
            [ordered]@{color = "red"; weight_kg = "8-9"; length_cm = "67-74"; est_age = "6-12 months" },
            [ordered]@{color = "purple"; weight_kg = "10-11"; length_cm = "74-83"; est_age = "12-18 months" },
            [ordered]@{color = "yellow"; weight_kg = "12-14"; length_cm = "83-95"; est_age = "18 months-3 years" },
            [ordered]@{color = "white"; weight_kg = "15-18"; length_cm = "95-107"; est_age = "3-5 years" },
            [ordered]@{color = "blue"; weight_kg = "19-22"; length_cm = "107-122"; est_age = "5-7 years" },
            [ordered]@{color = "orange"; weight_kg = "24-28"; length_cm = "122-137"; est_age = "7-9 years" },
            [ordered]@{color = "green"; weight_kg = "30-36"; length_cm = "137-152"; est_age = "9-12 years" }
        )
        source = "Broselow Pediatric Emergency Reference / PALS"
    })

Write-Entry "special_populations\obstetric\field-delivery" "en" ([ordered]@{
        id = "field-delivery"; name = "Emergency Field Delivery"; category = "obstetric"
        skill_level = "combat-medic"; time_estimate = "Varies -- 20+ min"
        description = "Management of precipitous or unplanned delivery in austere environment."
        equipment = @("gloves", "clean-cloth-blankets", "cord-clamps-or-ties", "scissors", "bulb-syringe")
        steps = @(
            "Position the mother supine or semi-reclined. Left lateral tilt preferred if unconscious (prevents aortocaval compression).",
            "Control the delivery of the head -- support with palm. Do NOT pull.",
            "Once the head is delivered, check for nuchal cord (around neck). If present, slip over head. If tight, clamp and cut.",
            "Suction the mouth then nose with bulb syringe if available.",
            "Guide delivery of anterior shoulder by gentle downward traction on the head, then upward for posterior shoulder.",
            "Deliver the body -- note time of delivery.",
            "Dry and warm the infant immediately. Stimulate by rubbing the back.",
            "Clamp and cut the cord (wait 1-2 min if infant is stable).",
            "Deliver the placenta with gentle controlled traction -- do NOT force.",
            "Administer oxytocin (if available) to prevent postpartum hemorrhage after placenta delivery.",
            "Assess for postpartum hemorrhage -- fundal massage, bimanual compression if needed.",
            "Assess Apgar score at 1 and 5 minutes."
        )
        warnings = @(
            "If delivery is not imminent -- do NOT attempt. Rapid MEDEVAC is preferred.",
            "Shoulder dystocia: if shoulders are stuck, apply McRoberts maneuver (hyperflex hips) and suprapubic pressure.",
            "Postpartum hemorrhage is the leading cause of preventable maternal death -- have oxytocin ready."
        )
        source = "JTS Obstetric CPG / PHTLS"
    })

Write-Entry "special_populations\obstetric\perimortem-csection" "en" ([ordered]@{
        id = "perimortem-csection"; name = "Perimortem Cesarean Section (PMCS)"; category = "obstetric"
        skill_level = "physician-surgeon"; time_estimate = "3-5 min"
        description = "Emergency cesarean delivery within 4 minutes of maternal cardiac arrest to allow effective CPR and potential neonatal survival. The uterus compresses the aorta and IVC -- delivery is also resuscitative for the mother."
        equipment = @("scalpel", "gloves", "retractors", "cord-clamps", "neonatal-resuscitation-equipment")
        steps = @(
            "Continue CPR without interruption.",
            "Make a vertical midline incision from umbilicus to pubis through skin and fascia.",
            "Incise the lower uterine segment horizontally.",
            "Deliver the infant -- note time.",
            "Clamp and cut the cord.",
            "Hand infant to second provider for neonatal resuscitation.",
            "Remove the placenta.",
            "Pack the uterus and abdomen if definitive closure is not immediately possible.",
            "Continue maternal resuscitation -- ROSC is more likely after uterine decompression."
        )
        warnings = @(
            "Decision-to-delivery time must be under 5 minutes for best maternal and fetal outcomes.",
            "This procedure is a last resort -- only if mother is in cardiac arrest and delivery is imminent (>20 weeks gestation).",
            "Requires physician-level training. Combat medics should prepare the field and support, not perform independently."
        )
        source = "JTS Obstetric CPG / ACOG Emergency Guidelines"
    })

Write-Host "All assessments, procedures, protocols, and special populations written successfully."
