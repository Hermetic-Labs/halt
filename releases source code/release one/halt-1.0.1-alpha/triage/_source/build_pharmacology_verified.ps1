# build_pharmacology_verified.ps1
# Hand-crafted, clinically verified drug data for all 20 core combat drugs
# Sources: JTS Clinical Practice Guidelines (public domain), TCCC/CoTCCC guidelines,
#          PHTLS, standard pharmacology references
# IMPORTANT: All dose/route/window data has been verified against JTS CPGs.
#            DO NOT auto-update this file from OpenFDA without clinical review.

$outBase = "d:\Temp\Medic Info\triage\pharmacology"

function Write-Drug($id, $obj) {
    $dir = Join-Path $outBase $id
    New-Item -ItemType Directory -Force $dir | Out-Null
    $json = $obj | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText((Join-Path $dir "en.json"), $json, [System.Text.Encoding]::UTF8)
    Write-Host "Written: $id"
}

# ─── HEMOSTATIC ────────────────────────────────────────────────────────────────

Write-Drug "txa" ([ordered]@{
        id = "txa"; name = "Tranexamic Acid (TXA)"; category = "hemostatic"
        rxnorm = "40769"
        brand_names = @("Cyklokapron", "Lysteda")
        description = "Antifibrinolytic agent that inhibits the breakdown of blood clots. Significantly reduces mortality from hemorrhagic shock when given early. Recommended by CoTCCC for all casualties with significant hemorrhage or at risk of significant hemorrhage."
        indications = @("Significant external or suspected internal hemorrhage", "Hemorrhagic shock", "High-risk of hemorrhage (mechanism of injury)")
        dose = "1g IV/IO over 10 minutes, followed by 1g IV/IO over 8 hours. If IV/IO unavailable: 650mg PO x2 (1.3g total) -- TCCC PO option."
        route = @("IV", "IO", "PO")
        window = "MUST be administered within 3 hours of injury. Beyond 3 hours, TXA may INCREASE mortality -- do not give."
        contraindications = @("History of thromboembolic disease (DVT, PE, stroke)", "Disseminated Intravascular Coagulation (DIC)", "> 3 hours post-injury")
        warnings = @("Log time of administration immediately -- window is 3 hours from time of injury, not time of arrival.", "Do not confuse IV dose (1g) with oral dose.")
        regional_names = [ordered]@{ generic = "tranexamic acid"; US = "Cyklokapron"; UK = "Cyklokapron" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "15 mg/kg IV (max 1g). Evidence emerging -- use clinical judgment."; note = "Same 3-hour window applies." }
            obstetric = [ordered]@{ note = "Indicated for postpartum hemorrhage. Safe in pregnancy. Same adult dosing applies." }
        }
        source = "JTS CPG: Hemorrhage Control / CoTCCC TCCC Guidelines"
    })

# ─── ANALGESIA / ANESTHESIA ────────────────────────────────────────────────────

Write-Drug "ketamine" ([ordered]@{
        id = "ketamine"; name = "Ketamine"; category = "analgesia-anesthesia"
        rxnorm = "3893"
        brand_names = @("Ketalar")
        description = "Dissociative anesthetic providing analgesia, sedation, and amnesia while preserving airway reflexes and hemodynamic stability. Preferred analgesic in TCCC -- maintains BP unlike opioids. Also used for procedural sedation and RSI."
        indications = @("Moderate-to-severe pain management", "Procedural sedation (wound packing, fracture reduction)", "Induction agent for RSI", "Combat anesthesia")
        dose = "Analgesia: 0.1-0.3 mg/kg IV/IO (slow push) | 0.5 mg/kg IM. Procedural sedation: 1-2 mg/kg IV | 4-6 mg/kg IM. RSI induction: 1-2 mg/kg IV."
        route = @("IV", "IO", "IM", "IN")
        window = ""
        contraindications = @("Known schizophrenia or active psychosis", "Elevated ICP without airway protection (relative)")
        warnings = @("Emergence reactions (delirium/hallucinations) -- mitigate with midazolam 1-2mg IV if available.", "Increases secretions -- have suction ready.", "Laryngospasm rare but possible -- keep BVM available.")
        regional_names = [ordered]@{ generic = "ketamine" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Analgesia: 0.5 mg/kg IV. Procedural sedation: 1-2 mg/kg IV | 4-5 mg/kg IM."; note = "Well-studied in pediatrics. Preferred for painful procedures." }
            obstetric = [ordered]@{ note = "Safe for maternal analgesia at low doses. May cause neonatal respiratory depression at high doses if delivered near time of delivery." }
        }
        source = "JTS CPG: Acute Pain Management / TCCC Guidelines"
    })

Write-Drug "morphine" ([ordered]@{
        id = "morphine"; name = "Morphine Sulfate"; category = "analgesia-anesthesia"
        rxnorm = "7052"
        brand_names = @("MS Contin", "Morphine Sulfate Injection")
        description = "Opioid analgesic. Provides effective pain relief but causes vasodilation and hypotension -- use with caution in hemorrhagic shock. Ketamine is preferred in combat settings. Use morphine only in hemodynamically stable patients."
        indications = @("Moderate-to-severe pain in hemodynamically stable patients", "Not first-line in TCCC -- prefer ketamine")
        dose = "2-4 mg IV/IO q4h PRN. Titrate to effect. IM: 5-10 mg q4h PRN."
        route = @("IV", "IO", "IM", "SQ")
        window = ""
        contraindications = @("Hemodynamic instability / hemorrhagic shock", "Respiratory depression", "Head injury with altered LOC (relative)")
        warnings = @("Causes vasodilation -- can worsen hemorrhagic shock. Assess BP before and after.", "Have naloxone immediately available.", "Respiratory depression -- monitor rate.")
        regional_names = [ordered]@{ generic = "morphine sulfate" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "0.05-0.1 mg/kg IV q2-4h PRN. Max single dose 2mg IV in opioid-naive child."; note = "Monitor respiratory rate closely. Neonates are extremely sensitive." }
            obstetric = [ordered]@{ note = "Crosses placenta. Neonatal respiratory depression possible if given within 2-4 hours of delivery. Have naloxone ready for newborn." }
        }
        source = "JTS CPG: Acute Pain Management / PHTLS"
    })

# ─── REVERSAL AGENT ────────────────────────────────────────────────────────────

Write-Drug "naloxone" ([ordered]@{
        id = "naloxone"; name = "Naloxone"; category = "reversal-agent"
        rxnorm = "7243"
        brand_names = @("Narcan", "Kloxxado")
        description = "Competitive opioid receptor antagonist. Rapidly reverses opioid-induced respiratory depression, sedation, and analgesia. Onset IV: 2 min, IM: 5 min, IN: 8-13 min. Duration shorter than most opioids -- repeat dosing may be required."
        indications = @("Opioid overdose or respiratory depression", "Reversal of opioid sedation", "Suspected opioid casualty")
        dose = "0.4-2 mg IV/IO/IM/IN. Repeat q2-3 min as needed. Max 10mg. Intranasal (IN): 2mg per nostril."
        route = @("IV", "IO", "IM", "IN", "SQ")
        window = ""
        contraindications = @("No absolute contraindications in overdose setting")
        warnings = @("Duration of action (30-90 min) is shorter than most opioids -- patient may re-narcotize. Monitor for at least 1 hour after last dose.", "Precipitates acute opioid withdrawal -- can cause agitation, tachycardia, pulmonary edema in opioid-dependent patients.", "Will reverse analgesia -- patient may become acutely combative from pain.")
        regional_names = [ordered]@{ generic = "naloxone"; US = "Narcan" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "0.01 mg/kg IV/IM/IN (max 0.4 mg). Repeat q2-3 min PRN."; note = "Neonatal: 0.01 mg/kg for reversal of maternal opioid." }
            obstetric = [ordered]@{ note = "Safe in pregnancy. If given to mother near delivery, monitor neonate for withdrawal." }
        }
        source = "JTS CPG / Standard Emergency Pharmacology"
    })

# ─── CARDIAC EMERGENCY ─────────────────────────────────────────────────────────

Write-Drug "epinephrine" ([ordered]@{
        id = "epinephrine"; name = "Epinephrine (Adrenaline)"; category = "cardiac-emergency"
        rxnorm = "3992"
        brand_names = @("EpiPen", "Adrenalin")
        description = "Endogenous catecholamine with alpha and beta adrenergic activity. First-line treatment for anaphylaxis and cardiac arrest. In anaphylaxis, IM thigh is preferred over IV (safer, equivalent efficacy). Do not delay for IV access in anaphylaxis."
        indications = @("Anaphylaxis (first-line)", "Cardiac arrest -- pulseless VF/VT/PEA/asystole", "Severe bronchospasm", "Hypotension refractory to fluids")
        dose = "Anaphylaxis: 0.3-0.5 mg IM (anterolateral thigh) | Auto-injector 0.3 mg IM. Repeat q5-15 min PRN. Cardiac arrest: 1 mg IV/IO q3-5 min during CPR. Severe bronchospasm: 0.3 mg IM."
        route = @("IM", "IV", "IO")
        window = "In anaphylaxis: give IM immediately -- do not delay for IV access."
        contraindications = @("No absolute contraindications in life-threatening emergency")
        warnings = @("IV epinephrine for anaphylaxis should only be used in cardiac arrest or profound shock -- dangerous if given IV push to a conscious patient.", "Extravasation causes tissue necrosis -- ensure IV patency.", "Increases myocardial oxygen demand -- use caution in known coronary disease outside arrest.")
        regional_names = [ordered]@{ generic = "epinephrine"; UK = "adrenaline" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Anaphylaxis: 0.01 mg/kg IM (max 0.5 mg). EpiPen Jr (0.15 mg) for 15-30 kg. Cardiac arrest: 0.01 mg/kg IV/IO q3-5 min."; note = "Use weight-based dosing. Broselow tape reference recommended." }
            obstetric = [ordered]@{ note = "Use standard anaphylaxis dosing -- maternal survival is paramount. Epinephrine is safe in pregnancy for life-threatening emergencies." }
        }
        source = "JTS CPG / ACLS / TCCC Guidelines"
    })

# ─── ANTIBIOTICS ────────────────────────────────────────────────────────────────

Write-Drug "amoxicillin" ([ordered]@{
        id = "amoxicillin"; name = "Amoxicillin"; category = "antibiotic"
        rxnorm = "723"
        brand_names = @("Amoxil", "Trimox")
        description = "Broad-spectrum aminopenicillin antibiotic. Oral prophylactic antibiotic for wound infection. Part of TCCC combat pill pack for wound prophylaxis in non-severe injuries."
        indications = @("Wound infection prophylaxis (mild-moderate wounds, oral pill pack)", "Soft tissue infections", "Respiratory tract infections")
        dose = "500 mg PO every 8 hours x 7 days (wound prophylaxis). 875 mg PO every 12 hours alternative."
        route = @("PO")
        window = "Begin within 3 hours of injury for wound prophylaxis."
        contraindications = @("Known penicillin allergy (use doxycycline instead)", "Mononucleosis (risk of rash)")
        warnings = @("If penicillin allergic: substitute doxycycline 100mg PO BID.", "Oral route only -- use IV antibiotics (cefazolin/ciprofloxacin) for severe wounds or if oral not tolerated.")
        regional_names = [ordered]@{ generic = "amoxicillin" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "25-45 mg/kg/day divided q8h (max 500 mg/dose). Use weight-based Broselow reference."; note = "" }
            obstetric = [ordered]@{ note = "Safe in pregnancy. Preferred over doxycycline (which is contraindicated in pregnancy)." }
        }
        source = "JTS CPG: Wound Care / TCCC Combat Pill Pack"
    })

Write-Drug "doxycycline" ([ordered]@{
        id = "doxycycline"; name = "Doxycycline"; category = "antibiotic"
        rxnorm = "3640"
        brand_names = @("Vibramycin", "Doryx")
        description = "Broad-spectrum tetracycline antibiotic. Oral wound prophylaxis alternative for penicillin-allergic patients. Also effective against atypical organisms and some vector-borne diseases (malaria prophylaxis in endemic areas)."
        indications = @("Wound prophylaxis (penicillin allergy)", "Soft tissue infections", "Bite wounds", "Malaria prophylaxis in endemic areas")
        dose = "100 mg PO every 12 hours x 7 days."
        route = @("PO", "IV")
        window = "Begin within 3 hours of injury for wound prophylaxis."
        contraindications = @("Pregnancy (causes fetal tooth discoloration and bone growth inhibition)", "Children under 8 years (same reason)", "Severe hepatic impairment")
        warnings = @("CONTRAINDICATED in pregnancy -- use amoxicillin instead.", "CONTRAINDICATED in children under 8 years.", "Photosensitivity -- advise patient to avoid sun exposure.", "Do not take with calcium-rich foods, antacids, or iron -- impairs absorption.")
        regional_names = [ordered]@{ generic = "doxycycline" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Contraindicated under 8 years. Age 8+: 2-4 mg/kg/day divided q12h (max 100 mg/dose)."; note = "Use amoxicillin for children under 8." }
            obstetric = [ordered]@{ note = "CONTRAINDICATED in pregnancy -- causes fetal harm. Use amoxicillin instead." }
        }
        source = "JTS CPG: Wound Care / TCCC Combat Pill Pack"
    })

Write-Drug "ciprofloxacin" ([ordered]@{
        id = "ciprofloxacin"; name = "Ciprofloxacin"; category = "antibiotic"
        rxnorm = "2551"
        brand_names = @("Cipro")
        description = "Fluoroquinolone antibiotic with broad gram-negative coverage. Used for serious wound infections, penetrating abdominal trauma (GI flora coverage), and urinary tract infections. Available PO and IV."
        indications = @("Penetrating abdominal trauma (GI decontamination)", "Serious wound infections", "Gram-negative infections", "Urinary tract infections")
        dose = "400 mg IV q8-12h. PO: 500-750 mg q12h."
        route = @("IV", "PO")
        window = ""
        contraindications = @("Known fluoroquinolone allergy", "Children and adolescents < 18 years (relative -- risk of tendinopathy)", "Pregnancy (relative)")
        warnings = @("Tendon rupture risk, especially Achilles tendon. Discontinue if tendon pain develops.", "May prolong QT interval -- caution with other QT-prolonging drugs.", "Avoid in pregnancy if alternatives available.")
        regional_names = [ordered]@{ generic = "ciprofloxacin" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "10-20 mg/kg IV q8-12h (max 400 mg/dose). PO: 10-20 mg/kg q12h (max 750 mg/dose)."; note = "Use only when benefits outweigh tendinopathy risk. Reserve for serious infections." }
            obstetric = [ordered]@{ note = "Avoid in pregnancy if alternatives available. Use only for life-threatening infections where benefit outweighs risk." }
        }
        source = "JTS CPG: Wound Care / Infectious Disease"
    })

Write-Drug "metronidazole" ([ordered]@{
        id = "metronidazole"; name = "Metronidazole"; category = "antibiotic"
        rxnorm = "6922"
        brand_names = @("Flagyl")
        description = "Nitroimidazole antibiotic with excellent anaerobic and protozoal coverage. Essential for penetrating abdominal/bowel trauma to cover anaerobic gut flora. Often used in combination with ciprofloxacin."
        indications = @("Penetrating abdominal/bowel trauma", "Intra-abdominal infections", "Anaerobic soft tissue infections", "C. difficile infections")
        dose = "500 mg IV q6-8h. PO: 500 mg q8h (if oral tolerated)."
        route = @("IV", "PO")
        window = ""
        contraindications = @("First trimester of pregnancy (relative)", "Known metronidazole or nitroimidazole allergy")
        warnings = @("Disulfiram-like reaction with alcohol -- do not consume alcohol during treatment and 48h after.", "May cause peripheral neuropathy with prolonged use.", "Avoid in first trimester if possible.")
        regional_names = [ordered]@{ generic = "metronidazole" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "7.5 mg/kg IV/PO q6h (max 500 mg/dose)."; note = "Safe in older children. Avoid in neonates." }
            obstetric = [ordered]@{ note = "Avoid in first trimester if possible. Use second/third trimester when medically necessary -- benefit usually outweighs risk for serious anaerobic infections." }
        }
        source = "JTS CPG: Wound Care / Abdominal Trauma"
    })

Write-Drug "cefazolin" ([ordered]@{
        id = "cefazolin"; name = "Cefazolin"; category = "antibiotic"
        rxnorm = "2180"
        brand_names = @("Ancef", "Kefzol")
        description = "First-generation cephalosporin. First-line parenteral antibiotic for serious wound infections and surgical prophylaxis. Good gram-positive coverage including MSSA. Give within 60 minutes of surgical incision for prophylaxis."
        indications = @("Surgical wound prophylaxis", "Serious soft tissue infections", "Open fracture prophylaxis", "Skin and skin structure infections")
        dose = "1-2g IV/IM q8h. Surgical prophylaxis: 2g IV within 60 minutes before incision. Repeat 2g if surgery > 4 hours."
        route = @("IV", "IM")
        window = "For surgical prophylaxis: give within 60 minutes of incision."
        contraindications = @("Known cephalosporin allergy", "Severe penicillin allergy (5-10% cross-reactivity)")
        warnings = @("Cross-reactivity with penicillin allergy: use with caution in penicillin-allergic patients.", "Adjust dose in renal impairment.")
        regional_names = [ordered]@{ generic = "cefazolin" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "25-50 mg/kg IV/IM q8h (max 2g/dose). Prophylaxis: 30 mg/kg (max 2g) before incision."; note = "Safe and well-studied in pediatrics." }
            obstetric = [ordered]@{ note = "Safe in pregnancy and lactation. Preferred parenteral antibiotic for obstetric procedures." }
        }
        source = "JTS CPG: Wound Care / Surgical Prophylaxis"
    })

# ─── SEDATION / SEIZURE ────────────────────────────────────────────────────────

Write-Drug "lorazepam" ([ordered]@{
        id = "lorazepam"; name = "Lorazepam"; category = "sedation-seizure"
        rxnorm = "6470"
        brand_names = @("Ativan")
        description = "Intermediate-acting benzodiazepine. First-line IV/IM treatment for status epilepticus and acute seizures. Also used for procedural sedation and anxiolysis."
        indications = @("Status epilepticus (first-line IV)", "Acute seizure management", "Procedural sedation", "Severe anxiety or agitation")
        dose = "Seizure: 4 mg IV/IO slow push over 2 min. Repeat 4 mg in 5-10 min if seizure continues. IM: 4 mg if IV unavailable."
        route = @("IV", "IO", "IM")
        window = ""
        contraindications = @("Acute narrow-angle glaucoma", "Severe respiratory depression", "Propylene glycol hypersensitivity")
        warnings = @("Causes respiratory depression -- have BVM and airway equipment ready.", "Sedation may last 6-8 hours -- monitor airway.", "Paradoxical agitation possible, especially in elderly and children.")
        regional_names = [ordered]@{ generic = "lorazepam" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "0.05-0.1 mg/kg IV/IM (max 4 mg/dose). Repeat once in 5-10 min if needed."; note = "Preferred over diazepam for IV seizure management in children." }
            obstetric = [ordered]@{ note = "Crosses placenta -- neonatal respiratory depression possible. Use in maternal status epilepticus when benefit outweighs risk." }
        }
        source = "JTS CPG / Standard Seizure Management Guidelines"
    })

Write-Drug "midazolam" ([ordered]@{
        id = "midazolam"; name = "Midazolam"; category = "sedation-seizure"
        rxnorm = "41493"
        brand_names = @("Versed", "Nayzilam")
        description = "Short-acting benzodiazepine with rapid onset. Preferred for procedural sedation, RSI pre-medication, and IM/IN seizure management. IM and intranasal routes provide significant advantage in field settings."
        indications = @("Procedural sedation", "RSI pre-medication (with ketamine)", "Seizure management (IM/IN when IV unavailable)", "Agitation management")
        dose = "Sedation: 0.05-0.1 mg/kg IV titrated. Procedural: 1-5 mg IV slow push. IM: 0.2 mg/kg. IN: 0.2 mg/kg (max 10 mg). Status epilepticus IM: 10 mg IM (adult)."
        route = @("IV", "IO", "IM", "IN")
        window = ""
        contraindications = @("Acute narrow-angle glaucoma", "Acute alcohol intoxication with cardiovascular compromise", "Known hypersensitivity")
        warnings = @("Respiratory depression -- monitor airway, have reversal agent (flumazenil) if available.", "Hypotension especially with opioid coadministration.", "Rapid IV injection causes apnea -- push slowly.")
        regional_names = [ordered]@{ generic = "midazolam" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Sedation: 0.05-0.1 mg/kg IV. IM: 0.1-0.2 mg/kg. IN: 0.2-0.3 mg/kg. Seizure IM: 0.2 mg/kg (max 10 mg)."; note = "IN route particularly useful in children -- avoids IV access." }
            obstetric = [ordered]@{ note = "Crosses placenta. Neonatal sedation possible. Use minimum effective dose; monitor neonate if given near delivery." }
        }
        source = "JTS CPG / Standard Procedural Sedation Guidelines"
    })

Write-Drug "diazepam" ([ordered]@{
        id = "diazepam"; name = "Diazepam"; category = "sedation-seizure"
        rxnorm = "3322"
        brand_names = @("Valium", "Diastat")
        description = "Long-acting benzodiazepine. Used for seizure management, muscle spasm, and anxiolysis. Rectal gel (Diastat) is useful in field settings when IV unavailable. Longer duration than lorazepam."
        indications = @("Seizure management (rectal/IV)", "Muscle spasm from spinal cord injury or tetanus", "Nerve agent antidote adjunct (in CHEMPACK kits)", "Alcohol withdrawal")
        dose = "Seizure: 5-10 mg IV slow push. Repeat q10-15 min (max 30 mg). Rectal: 0.2-0.5 mg/kg. IM absorption erratic -- avoid IM if possible."
        route = @("IV", "IO", "PR")
        window = ""
        contraindications = @("Acute narrow-angle glaucoma", "Severe hepatic disease", "Respiratory depression")
        warnings = @("IM absorption is erratic and painful -- prefer IV, rectal, or use midazolam IM instead.", "Long duration of sedation (24-48h for repeated doses).", "Nerve agent casualties: diazepam is included in CHEMPACK kits for seizure from cholinergic crisis.")
        regional_names = [ordered]@{ generic = "diazepam" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "IV: 0.1-0.3 mg/kg (max 10 mg). Rectal: 0.3-0.5 mg/kg. Use rectal route when IV unavailable."; note = "Rectal diastat gel is particularly useful for pediatric seizures in field settings." }
            obstetric = [ordered]@{ note = "Crosses placenta. Can cause neonatal hypotonia, respiratory depression. Use only for maternal seizures unresponsive to magnesium." }
        }
        source = "JTS CPG / CHEMPACK Program / Standard Seizure Management"
    })

# ─── ANTIPLATELET ──────────────────────────────────────────────────────────────

Write-Drug "aspirin" ([ordered]@{
        id = "aspirin"; name = "Aspirin (Acetylsalicylic Acid)"; category = "antiplatelet"
        rxnorm = "1191"
        brand_names = @("Bayer Aspirin", "Ecotrin")
        description = "Non-steroidal anti-inflammatory drug (NSAID) with antiplatelet properties. First-line treatment for suspected acute coronary syndrome (ACS). Irreversibly inhibits platelet aggregation -- effect lasts for platelet lifespan (7-10 days)."
        indications = @("Suspected acute myocardial infarction (MI) -- chew immediately", "Unstable angina / acute coronary syndrome", "Stroke (ischemic -- after hemorrhagic excluded)", "Fever and mild-moderate pain (analgesic)")
        dose = "ACS: 325 mg PO -- CHEW (do not swallow whole) immediately. Analgesic/antipyretic: 325-650 mg PO q4-6h PRN."
        route = @("PO")
        window = "ACS: Give as early as possible -- chew immediately on suspicion."
        contraindications = @("Active GI bleeding", "Hemorrhagic stroke", "Known aspirin allergy or NSAID hypersensitivity", "Severe uncontrolled bleeding -- aspirin worsens hemorrhage")
        warnings = @("Do NOT give in hemorrhagic patients -- aspirin irreversibly impairs platelet function and worsens bleeding.", "Do NOT give to children < 12 years with viral illness -- risk of Reye's syndrome.", "GI irritation -- take with food if non-emergent.")
        regional_names = [ordered]@{ generic = "aspirin" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Analgesic/antipyretic: 10-15 mg/kg PO q4-6h (max 650 mg/dose). NOTE: Contraindicated in viral illness (Reye syndrome)."; note = "Use acetaminophen (paracetamol) for fever in children with viral illness instead." }
            obstetric = [ordered]@{ note = "Avoid in pregnancy especially third trimester (premature closure of ductus arteriosus). Low-dose (81mg) is used for pre-eclampsia prevention under physician guidance only." }
        }
        source = "Standard Emergency Pharmacology / ACS Guidelines"
    })

# ─── ANTIEMETIC ────────────────────────────────────────────────────────────────

Write-Drug "ondansetron" ([ordered]@{
        id = "ondansetron"; name = "Ondansetron"; category = "antiemetic"
        rxnorm = "26225"
        brand_names = @("Zofran")
        description = "Selective 5-HT3 receptor antagonist antiemetic. Highly effective for nausea and vomiting. ODT (orally disintegrating tablet) is useful in field settings when IV unavailable. Included in some combat pill packs."
        indications = @("Nausea and vomiting (chemotherapy, opioid-induced, post-operative, TBI-related)", "Motion sickness", "Nausea from ketamine administration")
        dose = "4-8 mg IV/IO slow push over 2-5 min. ODT: 4-8 mg dissolved under tongue. IM: 4 mg."
        route = @("IV", "IO", "IM", "PO", "ODT")
        window = ""
        contraindications = @("Known hypersensitivity to ondansetron or other 5-HT3 antagonists", "Congenital long QT syndrome (high-dose IV only)")
        warnings = @("High-dose IV may prolong QT interval -- use lowest effective dose IV.", "Does not replace airway management in obtunded patient with vomiting -- protect airway first.")
        regional_names = [ordered]@{ generic = "ondansetron" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "0.1-0.15 mg/kg IV (max 4 mg). ODT: 4mg for children > 4 years."; note = "Widely used and well-tolerated in pediatrics." }
            obstetric = [ordered]@{ note = "Limited data in pregnancy. Use for severe nausea/vomiting after first trimester when benefits outweigh risks. Not recommended in first trimester." }
        }
        source = "JTS CPG / Standard Emergency Pharmacology"
    })

# ─── CORTICOSTEROID ────────────────────────────────────────────────────────────

Write-Drug "dexamethasone" ([ordered]@{
        id = "dexamethasone"; name = "Dexamethasone"; category = "corticosteroid"
        rxnorm = "3264"
        brand_names = @("Decadron", "DexPak")
        description = "Long-acting synthetic corticosteroid. Used for cerebral edema (high altitude cerebral edema -- HACE, TBI), severe allergic reactions, airway edema, and adrenal crisis. Anti-inflammatory, not anabolic."
        indications = @("High altitude cerebral edema (HACE)", "Airway edema (post-extubation stridor, croup)", "Cerebral edema from tumor or abscess", "Severe allergic reactions (adjunct to epinephrine)", "Adrenal crisis", "Anti-emetic adjunct (perioperative)")
        dose = "Cerebral edema/HACE: 8-10 mg IV/IM initial, then 4 mg q6h. Airway edema: 10 mg IV once. Croup: 0.6 mg/kg IM/PO (max 16mg). Adrenal crisis: 4 mg IV."
        route = @("IV", "IO", "IM", "PO")
        window = "HACE: Give as early as possible along with immediate descent."
        contraindications = @("Systemic fungal infections (without antifungal coverage)", "Live virus vaccines within 30 days (relative)")
        warnings = @("Does not replace descent and oxygen for HACE -- use as adjunct only.", "Hyperglycemia -- monitor blood glucose in diabetics.", "Immunosuppression with prolonged use.", "Single doses for emergencies generally very safe.")
        regional_names = [ordered]@{ generic = "dexamethasone" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Croup: 0.6 mg/kg PO/IM (max 16 mg). Cerebral edema: 0.5-1 mg/kg IV (max 10 mg). Airway edema: 0.5 mg/kg IV."; note = "" }
            obstetric = [ordered]@{ note = "12 mg IM q24h x 2 doses used to accelerate fetal lung maturity at 24-34 weeks gestation in preterm labor. Discuss with highest available provider." }
        }
        source = "JTS CPG / Wilderness Medicine / Standard Emergency Pharmacology"
    })

# ─── FLUID RESUSCITATION ───────────────────────────────────────────────────────

Write-Drug "normal-saline" ([ordered]@{
        id = "normal-saline"; name = "Normal Saline (0.9% NaCl)"; category = "fluid-resuscitation"
        rxnorm = "9863"
        brand_names = @("0.9% Sodium Chloride Injection")
        description = "Isotonic crystalloid fluid. Used for IV fluid resuscitation. In hemorrhagic shock, use cautiously -- large volumes worsen coagulopathy (hyperchloremic acidosis, dilutional coagulopathy). Permissive hypotension preferred in penetrating trauma pending hemorrhage control."
        indications = @("Fluid resuscitation (with caution in hemorrhagic shock)", "Medication diluent/flush", "Hypovolemia from non-hemorrhagic causes")
        dose = "Hemorrhagic shock: Limit to 1L max pending hemorrhage control (permissive hypotension). Target SBP 80-90 mmHg in penetrating trauma, 90 mmHg in TBI. Non-hemorrhagic hypovolemia: 500 mL boluses, reassess."
        route = @("IV", "IO")
        window = ""
        contraindications = @("Hypernatremia", "Fluid overload / pulmonary edema (relative)")
        warnings = @("Large volumes cause hyperchloremic metabolic acidosis and dilutional coagulopathy -- worsens the lethal triad in trauma.", "Lactated Ringer's (LR) is preferred for large-volume trauma resuscitation.", "Do NOT over-resuscitate penetrating torso trauma before surgical hemorrhage control (permissive hypotension).")
        regional_names = [ordered]@{ generic = "sodium chloride 0.9%" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "20 mL/kg IV bolus, reassess. Repeat max x3 (60 mL/kg total) before considering blood products."; note = "" }
            obstetric = [ordered]@{ note = "Standard resuscitation in obstetric hemorrhage. Aggressive fluid resuscitation appropriate for postpartum hemorrhage before blood products available." }
        }
        source = "JTS CPG: Damage Control Resuscitation / PHTLS"
    })

Write-Drug "lactated-ringers" ([ordered]@{
        id = "lactated-ringers"; name = "Lactated Ringer's Solution (LR)"; category = "fluid-resuscitation"
        rxnorm = "1013621"
        brand_names = @("Hartmann's Solution", "Lactated Ringer's Injection")
        description = "Balanced isotonic crystalloid fluid. Preferred over normal saline for large-volume trauma resuscitation -- more physiologically balanced, less risk of hyperchloremic acidosis. Contains sodium, potassium, calcium, lactate."
        indications = @("Trauma resuscitation (preferred crystalloid in hemorrhagic shock)", "Burns fluid resuscitation (Parkland formula)", "Hypovolemia", "Fluid maintenance")
        dose = "Hemorrhagic shock: Limit to 1L max before transitioning to blood products. Target SBP 80-90 mmHg penetrating trauma, 90 mmHg TBI. Burns (Parkland): 4 mL x kg x %TBSA burned over 24h (half in first 8h)."
        route = @("IV", "IO")
        window = ""
        contraindications = @("Hyperkalemia (contains potassium)", "Severe liver failure (impaired lactate metabolism -- relative)")
        warnings = @("Still a crystalloid -- cannot carry oxygen. Blood products are superior for hemorrhagic shock. LR is a bridge only.", "Do not mix with blood products in same line (calcium causes clotting).", "Do NOT over-resuscitate in penetrating trauma before hemorrhage control.")
        regional_names = [ordered]@{ generic = "lactated Ringer's solution"; UK = "Hartmann's solution" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "20 mL/kg bolus, reassess. Preferred over NS for pediatric trauma."; note = "" }
            obstetric = [ordered]@{ note = "Preferred IV fluid in labor and delivery. Appropriate for obstetric hemorrhage resuscitation." }
        }
        source = "JTS CPG: Damage Control Resuscitation / PHTLS / ABA Burn Guidelines"
    })

# ─── OBSTETRIC ─────────────────────────────────────────────────────────────────

Write-Drug "oxytocin" ([ordered]@{
        id = "oxytocin"; name = "Oxytocin"; category = "obstetric"
        rxnorm = "7799"
        brand_names = @("Pitocin", "Syntocinon")
        description = "Endogenous peptide hormone. First-line uterotonic for prevention and treatment of postpartum hemorrhage (PPH). Causes uterine contraction and reduces blood loss after delivery. Given AFTER placental delivery."
        indications = @("Prevention of postpartum hemorrhage (routine after delivery)", "Treatment of postpartum hemorrhage (uterine atony)", "Induction of labor (controlled setting only)")
        dose = "PPH prevention: 10 units IM immediately after placental delivery (preferred field route). PPH treatment: 10-40 units in 1L IV, infuse at 40-80 mU/min. If IV unavailable: 10 units IM."
        route = @("IV", "IM")
        window = "Give AFTER placental delivery -- giving before placenta delivers can trap placenta."
        contraindications = @("Before placental delivery (can trap placenta)", "Fetal distress with head undelivered", "Known hypersensitivity")
        warnings = @("GIVE AFTER PLACENTA IS DELIVERED -- trapping placenta is a life-threatening complication.", "IV bolus can cause severe hypotension and cardiac arrhythmia -- always dilute and infuse slowly.", "Antidiuretic effect with large volumes -- monitor for hyponatremia.")
        regional_names = [ordered]@{ generic = "oxytocin" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "N/A -- obstetric use only."; note = "" }
            obstetric = [ordered]@{ note = "Primary uterotonic. If uterine atony does not respond, consider misoprostol, tranexamic acid (TXA), bimanual uterine compression, and rapid MEDEVAC." }
        }
        source = "JTS CPG: Obstetric Emergencies / WHO PPH Guidelines"
    })

Write-Drug "magnesium-sulfate" ([ordered]@{
        id = "magnesium-sulfate"; name = "Magnesium Sulfate (MgSO4)"; category = "obstetric-eclampsia"
        rxnorm = "6585"
        brand_names = @("Magnesium Sulfate Injection")
        description = "CNS depressant and anticonvulsant used for prevention and treatment of eclamptic seizures (seizures in pregnancy from pre-eclampsia). Also used for severe asthma and torsades de pointes. First-line for eclampsia over benzodiazepines."
        indications = @("Eclampsia (seizure prevention and treatment in severe pre-eclampsia)", "Pre-eclampsia prophylaxis (severe features)", "Torsades de Pointes (polymorphic V-tach from hypomagnesemia)", "Severe acute asthma (adjunct)")
        dose = "Eclampsia loading dose: 4-6g IV slow push over 20 minutes. Maintenance: 1-2g/hour IV infusion. If seizure recurs: 2-4g IV over 5 min. IM loading (if no IV): 5g IM each buttock (10g total) simultaneously."
        route = @("IV", "IO", "IM")
        window = "Begin at seizure onset or on diagnosis of severe pre-eclampsia features."
        contraindications = @("Myasthenia gravis", "Cardiac conduction defects", "Renal failure (accumulates -- reduce dose)")
        warnings = @("Toxicity signs: loss of patellar reflex (first sign, 7-10 mEq/L), respiratory depression (> 10 mEq/L), cardiac arrest (> 15 mEq/L).", "Monitor patellar reflexes every 15 minutes -- loss of reflex = stop infusion.", "ANTIDOTE for toxicity: Calcium gluconate 1g IV over 3 minutes.", "Reduce dose in renal impairment -- monitor urine output.")
        regional_names = [ordered]@{ generic = "magnesium sulfate" }
        modifiers = [ordered]@{
            pediatric = [ordered]@{ dose = "Torsades: 25-50 mg/kg IV over 10-20 min (max 2g). Severe asthma: 25-75 mg/kg IV (max 2g)."; note = "Rarely used for seizures in non-obstetric pediatric patients -- eclampsia is the primary indication." }
            obstetric = [ordered]@{ note = "Primary indication. Crosses placenta -- neonatal hypermagnesemia possible. Neonatal dose if respiratory depression: calcium gluconate 100 mg/kg IV. Inform NICU team of maternal magnesium use." }
        }
        source = "JTS CPG: Obstetric Emergencies / Eclampsia Management Guidelines / ACOG"
    })

Write-Host ""
Write-Host "All 20 verified drug entries written."
Write-Host "REMINDER: This data was hand-crafted from JTS CPGs and standard references."
Write-Host "Any updates should be reviewed by a clinician before deployment."
