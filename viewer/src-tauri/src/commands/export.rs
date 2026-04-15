//! Export — PDF and HTML patient record generation + shift report.
//!
//! Direct translation of the export sections of `api/routes/patients.py`.
//!
//! Three export modes:
//!   1. PDF — stdlib-only text PDF (Courier font, wrapped lines, multi-page)
//!   2. HTML — print-ready, locale-aware patient card for medevac handoff
//!   3. Shift Report — cross-ward status rollup grouped by ward + priority

use crate::models::nllb;
use crate::storage;
use serde_json::Value;
use std::collections::HashMap;

// ── PDF Export ──────────────────────────────────────────────────────────────

/// Generate a text-only PDF of a patient record.
/// Direct translation of `patient_pdf()` from patients.py.
/// Stdlib-only: no reportlab, no weasyprint. Pure PDF primitives.
#[tauri::command]
pub fn export_patient_pdf(patient_id: String) -> Result<Vec<u8>, String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    let rec = storage::read_json(&path)?;

    // Build text lines (identical to Python's line-building logic)
    let mut lines = Vec::new();
    let name = rec
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");
    let id = rec.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();

    lines.push(format!("PATIENT RECORD — {}", name));
    lines.push(format!("ID: {}  |  Generated: {}", id, now));
    lines.push(String::new());
    lines.push("DEMOGRAPHICS".into());
    lines.push(format!(
        "  Name: {}  |  Age: {} {}  |  Sex: {}",
        name,
        rec.get("age").and_then(|v| v.as_f64()).unwrap_or(0.0),
        rec.get("ageUnit").and_then(|v| v.as_str()).unwrap_or(""),
        rec.get("sex").and_then(|v| v.as_str()).unwrap_or("--"),
    ));
    lines.push(format!(
        "  Weight: {} kg  |  Pregnant: {}",
        rec.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0),
        if rec
            .get("pregnant")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            "Yes"
        } else {
            "No"
        },
    ));
    let allergies = rec
        .get("allergies")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|| "None known".into());
    lines.push(format!("  Allergies: {}", allergies));
    lines.push(String::new());
    lines.push("ADMISSION".into());
    lines.push(format!(
        "  Admitted: {}  |  Mechanism: {}",
        rec.get("admittedAt")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
        rec.get("mechanism")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
    ));
    lines.push(format!(
        "  Ward: {}  |  Room: {}  |  Status: {}",
        rec.get("wardId")
            .and_then(|v| v.as_str())
            .unwrap_or("Unassigned"),
        rec.get("roomNumber")
            .and_then(|v| v.as_str())
            .unwrap_or("None"),
        rec.get("status").and_then(|v| v.as_str()).unwrap_or("--"),
    ));
    lines.push(String::new());

    let triage = rec
        .get("triage")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    lines.push("TRIAGE".into());
    lines.push(format!(
        "  Priority: {} ({})  |  Hemo: {}  |  GCS: {}",
        triage
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
        triage
            .get("priorityLabel")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        triage
            .get("hemoClass")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
        triage
            .get("gcsCat")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
    ));
    lines.push(String::new());

    let vitals = rec
        .get("initialVitals")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    lines.push("INITIAL VITALS".into());
    lines.push(format!(
        "  HR: {}  |  SBP: {}  |  RR: {}  |  SpO2: {}%  |  GCS: {}",
        vitals.get("hr").and_then(|v| v.as_f64()).unwrap_or(0.0),
        vitals.get("sbp").and_then(|v| v.as_f64()).unwrap_or(0.0),
        vitals.get("rr").and_then(|v| v.as_f64()).unwrap_or(0.0),
        vitals.get("spo2").and_then(|v| v.as_f64()).unwrap_or(0.0),
        vitals.get("gcs").and_then(|v| v.as_f64()).unwrap_or(0.0),
    ));
    lines.push(String::new());

    // Events timeline
    if let Some(events) = rec.get("events").and_then(|v| v.as_array()) {
        if !events.is_empty() {
            lines.push("TIMELINE EVENTS".into());
            for ev in events {
                lines.push(format!(
                    "  [{}] {} — {}",
                    ev.get("type").and_then(|v| v.as_str()).unwrap_or(""),
                    ev.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""),
                    ev.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                ));
            }
            lines.push(String::new());
        }
    }

    lines.push(format!(
        "Notes: {}",
        rec.get("notes").and_then(|v| v.as_str()).unwrap_or("None")
    ));

    // Build minimal PDF (text-only, no external libs)
    // Direct translation of the PDF generation in patients.py
    let pdf_bytes = build_text_pdf(&lines);
    Ok(pdf_bytes)
}

/// Build a minimal PDF from text lines (stdlib-only, Courier font).
/// Direct translation of the PDF builder in patients.py.
fn build_text_pdf(lines: &[String]) -> Vec<u8> {
    const MAX_LINES: usize = 55;
    const MAX_CHARS: usize = 90;

    // Word-wrap
    let mut wrapped = Vec::new();
    for line in lines {
        let mut remaining = line.as_str();
        if remaining.is_empty() {
            wrapped.push(String::new());
            continue;
        }
        while remaining.len() > MAX_CHARS {
            wrapped.push(remaining[..MAX_CHARS].to_string());
            remaining = &remaining[MAX_CHARS..];
        }
        wrapped.push(remaining.to_string());
    }

    // Build PDF objects
    let mut objects: Vec<String> = Vec::new();

    // Obj 1: Catalog
    objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj".into());
    // Obj 2: Pages (placeholder, filled later)
    objects.push(String::new());
    // Obj 3: Font
    objects.push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj".into());

    let mut page_refs = Vec::new();

    for chunk in wrapped.chunks(MAX_LINES) {
        let mut stream_parts = vec![
            "BT".to_string(),
            "/F1 9 Tf".to_string(),
            "50 750 Td".to_string(),
            "12 TL".to_string(),
        ];
        for line in chunk {
            let safe = line
                .replace('\\', "\\\\")
                .replace('(', "\\(")
                .replace(')', "\\)");
            stream_parts.push(format!("({}) '", safe));
        }
        stream_parts.push("ET".to_string());
        let stream = stream_parts.join("\n");

        let stream_obj_num = objects.len() + 1;
        objects.push(format!(
            "{} 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj",
            stream_obj_num,
            stream.len(),
            stream
        ));

        let page_obj_num = objects.len() + 1;
        objects.push(format!("{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj",
            page_obj_num, stream_obj_num));
        page_refs.push(page_obj_num);
    }

    // Fill in Pages object
    let kids = page_refs
        .iter()
        .map(|p| format!("{} 0 R", p))
        .collect::<Vec<_>>()
        .join(" ");
    objects[1] = format!(
        "2 0 obj\n<< /Type /Pages /Kids [{}] /Count {} >>\nendobj",
        kids,
        page_refs.len()
    );

    // Assemble PDF
    let mut pdf = String::from("%PDF-1.4\n");
    let mut xrefs = Vec::new();

    for (i, obj) in objects.iter().enumerate() {
        xrefs.push(pdf.len());
        pdf.push_str(obj);
        pdf.push('\n');
    }

    let xref_start = pdf.len();
    pdf.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for xr in &xrefs {
        pdf.push_str(&format!("{:010} 00000 n \n", xr));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
        objects.len() + 1,
        xref_start
    ));

    pdf.into_bytes()
}

// ── HTML Export ─────────────────────────────────────────────────────────────

/// Generate print-ready HTML patient record.
/// Pass lang for locale-aware labels and dynamic content translation.
#[tauri::command]
pub fn export_patient_html(patient_id: String, lang: Option<String>) -> Result<String, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    let r = storage::read_json(&path)?;
    let tri = r
        .get("triage")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    let v = r
        .get("initialVitals")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    // Translate helper
    let tr = |text: &str| -> String {
        if lang == "en" || text.trim().is_empty() {
            text.to_string()
        } else {
            nllb::translate(text, "en", &lang).unwrap_or_else(|_| text.to_string())
        }
    };

    let pc = match tri.get("priority").and_then(|v| v.as_str()).unwrap_or("") {
        "T1" => "#e74c3c",
        "T2" => "#f0a500",
        "T3" => "#3fb950",
        "T4" => "#8b949e",
        _ => "#58a6ff",
    };

    let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown");
    let pri = tri.get("priority").and_then(|v| v.as_str()).unwrap_or("--");
    let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();

    let html = format!(
        r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Patient {id}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:monospace;font-size:11px;padding:12px;color:#111}}
  h1{{font-size:16px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:8px}}
  h2{{font-size:12px;background:#eee;padding:3px 6px;margin:8px 0 4px}}
  table{{width:100%;border-collapse:collapse;margin-bottom:8px}}
  td,th{{border:1px solid #999;padding:2px 4px;text-align:left;font-size:10px}}
  th{{background:#ddd}}
  .pri{{display:inline-block;padding:2px 8px;color:#fff;font-weight:bold;border-radius:3px}}
  .grid{{display:grid;grid-template-columns:1fr 1fr;gap:4px}}
  .grid span{{background:#f5f5f5;padding:2px 4px;border:1px solid #ddd}}
  @media print{{body{{padding:0}}}}
</style></head><body>
<h1>PATIENT RECORD — {name} <span class="pri" style="background:{pc}">{pri}</span></h1>
<p>ID: {id} | Generated: {now} | Status: {status}</p>
<h2>DEMOGRAPHICS</h2>
<div class="grid">
  <span>Age: {age} {age_unit}</span>
  <span>Sex: {sex}</span>
  <span>Weight: {weight} kg</span>
  <span>Pregnant: {pregnant}</span>
  <span>Language: {spoken_lang}</span>
  <span>Next of Kin: {nok}</span>
  <span>Allergies: {allergies}</span>
  <span>Ward: {ward} / Room: {room}</span>
</div>
<h2>TRIAGE</h2>
<div class="grid">
  <span>Priority: {pri} ({pri_label})</span>
  <span>Hemo: {hemo}</span>
  <span>GCS: {gcs_cat}</span>
</div>
<h2>INITIAL VITALS</h2>
<div class="grid">
  <span>HR: {hr}</span><span>SBP: {sbp}</span>
  <span>RR: {rr}</span><span>SpO2: {spo2}%</span>
  <span>GCS: {gcs}</span><span>Temp: {temp}°C</span>
  <span>Pain: {pain}/10</span>
</div>
<h2>NOTES</h2><p>{notes}</p>
<hr><p style="text-align:center;font-size:9px;color:#666">Medic Info — Air-Gapped Triage System — CONFIDENTIAL</p>
</body></html>"#,
        id = r.get("id").and_then(|v| v.as_str()).unwrap_or(""),
        name = name,
        pc = pc,
        pri = pri,
        now = now,
        status = status,
        age = r.get("age").and_then(|v| v.as_f64()).unwrap_or(0.0),
        age_unit = r.get("ageUnit").and_then(|v| v.as_str()).unwrap_or(""),
        sex = r.get("sex").and_then(|v| v.as_str()).unwrap_or("--"),
        weight = r.get("weight").and_then(|v| v.as_f64()).unwrap_or(0.0),
        pregnant = if r.get("pregnant").and_then(|v| v.as_bool()).unwrap_or(false) {
            "Yes"
        } else {
            "No"
        },
        spoken_lang = r
            .get("spokenLanguage")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
        nok = r.get("nextOfKin").and_then(|v| v.as_str()).unwrap_or("--"),
        allergies = r
            .get("allergies")
            .and_then(|v| v.as_array())
            .map(|a| a
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(", "))
            .unwrap_or_else(|| "None known".into()),
        ward = r.get("wardId").and_then(|v| v.as_str()).unwrap_or(""),
        room = r.get("roomNumber").and_then(|v| v.as_str()).unwrap_or(""),
        pri_label = tri
            .get("priorityLabel")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        hemo = tri
            .get("hemoClass")
            .and_then(|v| v.as_str())
            .unwrap_or("--"),
        gcs_cat = tri.get("gcsCat").and_then(|v| v.as_str()).unwrap_or("--"),
        hr = v.get("hr").and_then(|v| v.as_f64()).unwrap_or(0.0),
        sbp = v.get("sbp").and_then(|v| v.as_f64()).unwrap_or(0.0),
        rr = v.get("rr").and_then(|v| v.as_f64()).unwrap_or(0.0),
        spo2 = v.get("spo2").and_then(|v| v.as_f64()).unwrap_or(0.0),
        gcs = v.get("gcs").and_then(|v| v.as_f64()).unwrap_or(0.0),
        temp = v.get("temp").and_then(|v| v.as_f64()).unwrap_or(0.0),
        pain = v.get("pain").and_then(|v| v.as_f64()).unwrap_or(0.0),
        notes = tr(r.get("notes").and_then(|v| v.as_str()).unwrap_or("None")),
    );

    Ok(html)
}

// ── Shift Report ────────────────────────────────────────────────────────────

/// Generate shift handoff report — all active patients grouped by ward.
#[tauri::command]
pub fn shift_report_html(lang: Option<String>) -> Result<String, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    let data_dir = crate::config::data_dir();

    let mut patients: Vec<Value> = Vec::new();
    if data_dir.is_dir() {
        for entry in std::fs::read_dir(&data_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("PAT-") && n.ends_with(".json"))
                .unwrap_or(false)
            {
                if let Ok(data) = storage::read_json(&p) {
                    let status = data.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    if status != "discharged" && status != "transferred" {
                        patients.push(data);
                    }
                }
            }
        }
    }

    // Group by ward
    let mut wards: HashMap<String, Vec<Value>> = HashMap::new();
    for pt in &patients {
        let wid = pt
            .get("wardId")
            .and_then(|v| v.as_str())
            .unwrap_or("Unassigned")
            .to_string();
        wards.entry(wid).or_default().push(pt.clone());
    }

    // Sort by triage priority within each ward
    let pri_order = |p: &str| -> i32 {
        match p {
            "T1" => 0,
            "T2" => 1,
            "T3" => 2,
            "T4" => 3,
            _ => 4,
        }
    };
    for (_, pts) in wards.iter_mut() {
        pts.sort_by_key(|pt| {
            let pri = pt
                .get("triage")
                .and_then(|t| t.get("priority"))
                .and_then(|v| v.as_str())
                .unwrap_or("--");
            pri_order(pri)
        });
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let total = patients.len();

    let mut ward_html = String::new();
    let mut sorted_wards: Vec<_> = wards.iter().collect();
    sorted_wards.sort_by_key(|(k, _)| k.to_string());

    for (wid, pts) in sorted_wards {
        ward_html.push_str(&format!("<h2>{} ({} patients)</h2><table><tr><th>Name</th><th>Room</th><th>Pri</th><th>Status</th><th>HR/SBP/SpO2</th><th>Meds</th><th>Allergies</th></tr>", wid, pts.len()));
        for pt in pts {
            let t = pt
                .get("triage")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            let v = pt
                .get("initialVitals")
                .cloned()
                .unwrap_or(Value::Object(Default::default()));
            let pc = match t.get("priority").and_then(|v| v.as_str()).unwrap_or("") {
                "T1" => "#e74c3c",
                "T2" => "#f0a500",
                "T3" => "#3fb950",
                "T4" => "#8b949e",
                _ => "#58a6ff",
            };
            let drugs = pt
                .get("plan")
                .and_then(|p| p.get("drugs"))
                .and_then(|d| d.as_array())
                .map(|a| {
                    a.iter()
                        .take(3)
                        .filter_map(|d| d.get("name").and_then(|n| n.as_str()))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let allergies = pt
                .get("allergies")
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_else(|| "—".into());
            ward_html.push_str(&format!(
                "<tr><td style=\"border-left:4px solid {}\">{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}/{}/{}</td><td>{}</td><td>{}</td></tr>",
                pc,
                pt.get("name").and_then(|v| v.as_str()).unwrap_or("?"),
                pt.get("roomNumber").and_then(|v| v.as_str()).unwrap_or(""),
                t.get("priority").and_then(|v| v.as_str()).unwrap_or("--"),
                pt.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                v.get("hr").and_then(|v| v.as_f64()).unwrap_or(0.0),
                v.get("sbp").and_then(|v| v.as_f64()).unwrap_or(0.0),
                v.get("spo2").and_then(|v| v.as_f64()).unwrap_or(0.0),
                drugs, allergies,
            ));
        }
        ward_html.push_str("</table>");
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Shift Report</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:monospace;font-size:11px;padding:12px;color:#111}}
  h1{{font-size:16px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:8px}}
  h2{{font-size:12px;background:#eee;padding:3px 6px;margin:8px 0 4px}}
  table{{width:100%;border-collapse:collapse;margin-bottom:8px}}
  td,th{{border:1px solid #999;padding:2px 4px;text-align:left;font-size:10px}}
  th{{background:#ddd}}
  @media print{{body{{padding:0}}}}
</style></head><body>
<h1>SHIFT HANDOFF REPORT</h1>
<p>Generated: {now} | Active Patients: {total}</p>
{ward_html}
<hr><p style="text-align:center;font-size:9px;color:#666">Medic Info — Air-Gapped Triage System — CONFIDENTIAL</p>
</body></html>"#,
        now = now,
        total = total,
        ward_html = ward_html
    );

    Ok(html)
}
