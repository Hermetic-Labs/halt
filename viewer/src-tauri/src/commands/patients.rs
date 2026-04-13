//! Patients — CRUD, attachments, snapshot/restore, and public lookup.
//!
//! Direct translation of `api/routes/patients.py` (CRUD section).
//!
//! Five sections ported here:
//!   1. CRUD — Create / read / update / delete patient records.
//!   2. Attachments — File uploads (photos, X-rays) stored per-patient on disk.
//!   3. Public Lookup — Family-facing, opt-in only patient search.
//!   4. Snapshot/Restore — Full data dump and bulk import for mesh replication.
//!   5. QR — Discharge and public lookup QR codes.

use crate::storage;
use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;

// ── Data Models ─────────────────────────────────────────────────────────────
// Direct translations of the Pydantic models in patients.py.
// Using serde defaults to match Python's Field(default_factory=...) patterns.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientEvent {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub summary: String,
    #[serde(default)]
    pub data: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientTriage {
    pub priority: String,
    #[serde(rename = "priorityLabel", default)]
    pub priority_label: String,
    #[serde(rename = "hemoClass", default)]
    pub hemo_class: String,
    #[serde(rename = "gcsCat", default)]
    pub gcs_cat: String,
}

impl Default for PatientTriage {
    fn default() -> Self {
        Self {
            priority: "--".into(),
            priority_label: String::new(),
            hemo_class: "--".into(),
            gcs_cat: "--".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatientVitals {
    #[serde(default)]
    pub hr: f64,
    #[serde(default)]
    pub sbp: f64,
    #[serde(default)]
    pub rr: f64,
    #[serde(default)]
    pub spo2: f64,
    #[serde(default)]
    pub gcs: f64,
    #[serde(default)]
    pub temp: f64,
    #[serde(default)]
    pub pain: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatientPlan {
    #[serde(default)]
    pub march: Vec<Value>,
    #[serde(default)]
    pub drugs: Vec<Value>,
    #[serde(default)]
    pub rx: Vec<String>,
    #[serde(default)]
    pub recovery: Vec<String>,
    #[serde(default)]
    pub escalate: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientRecord {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub age: f64,
    #[serde(default = "default_age_unit", rename = "ageUnit")]
    pub age_unit: String,
    #[serde(default = "default_sex")]
    pub sex: String,
    #[serde(default = "default_weight")]
    pub weight: f64,
    #[serde(default)]
    pub pregnant: bool,
    #[serde(default)]
    pub allergies: Vec<String>,
    #[serde(default, rename = "admittedAt")]
    pub admitted_at: String,
    #[serde(default, rename = "injuryTime")]
    pub injury_time: String,
    #[serde(default)]
    pub mechanism: String,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default, rename = "wardId")]
    pub ward_id: String,
    #[serde(default, rename = "roomNumber")]
    pub room_number: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub triage: PatientTriage,
    #[serde(default, rename = "initialVitals")]
    pub initial_vitals: PatientVitals,
    #[serde(default)]
    pub plan: PatientPlan,
    #[serde(default)]
    pub events: Vec<PatientEvent>,
    #[serde(default)]
    pub notes: String,
    #[serde(default, rename = "noteEntries")]
    pub note_entries: Vec<Value>,
    #[serde(default, rename = "attachmentNames")]
    pub attachment_names: Vec<String>,
    #[serde(default, rename = "nextOfKin")]
    pub next_of_kin: String,
    #[serde(default = "default_language", rename = "spokenLanguage")]
    pub spoken_language: String,
    #[serde(default, rename = "publicOptIn")]
    pub public_opt_in: bool,
}

fn default_age_unit() -> String { "years".into() }
fn default_sex() -> String { "U".into() }
fn default_weight() -> f64 { 70.0 }
fn default_status() -> String { "active".into() }
fn default_language() -> String { "English".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientSummary {
    pub id: String,
    pub name: String,
    pub age: f64,
    pub sex: String,
    #[serde(rename = "wardId")]
    pub ward_id: String,
    #[serde(rename = "roomNumber")]
    pub room_number: String,
    pub status: String,
    pub priority: String,
    #[serde(rename = "admittedAt")]
    pub admitted_at: String,
    pub mechanism: String,
    pub allergies: Vec<String>,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn data_dir() -> std::path::PathBuf {
    config::data_dir()
}

fn glob_patients() -> Vec<std::path::PathBuf> {
    let dir = data_dir();
    if !dir.is_dir() {
        return Vec::new();
    }
    fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("PAT-") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect()
}

fn patient_attach_dir(patient_id: &str) -> std::path::PathBuf {
    storage::attach_dir().join(patient_id)
}

// ── CRUD Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_patients(status: Option<String>, full: Option<bool>) -> Vec<Value> {
    let full = full.unwrap_or(false);
    let mut results: Vec<Value> = Vec::new();

    for path in glob_patients() {
        if let Ok(data) = storage::read_json(&path) {
            if let Some(ref s) = status {
                if data.get("status").and_then(|v| v.as_str()) != Some(s.as_str()) {
                    continue;
                }
            }
            if full {
                results.push(data);
            } else {
                let triage = data.get("triage").cloned().unwrap_or(Value::Object(Default::default()));
                results.push(serde_json::json!({
                    "id": data.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                    "name": data.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    "age": data.get("age").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    "sex": data.get("sex").and_then(|v| v.as_str()).unwrap_or("U"),
                    "wardId": data.get("wardId").and_then(|v| v.as_str()).unwrap_or(""),
                    "roomNumber": data.get("roomNumber").and_then(|v| v.as_str()).unwrap_or(""),
                    "status": data.get("status").and_then(|v| v.as_str()).unwrap_or("active"),
                    "priority": triage.get("priority").and_then(|v| v.as_str()).unwrap_or("--"),
                    "admittedAt": data.get("admittedAt").and_then(|v| v.as_str()).unwrap_or(""),
                    "mechanism": data.get("mechanism").and_then(|v| v.as_str()).unwrap_or(""),
                    "allergies": data.get("allergies").cloned().unwrap_or(Value::Array(vec![])),
                }));
            }
        }
    }

    // Sort by admittedAt descending
    results.sort_by(|a, b| {
        let at_a = a.get("admittedAt").and_then(|v| v.as_str()).unwrap_or("");
        let at_b = b.get("admittedAt").and_then(|v| v.as_str()).unwrap_or("");
        at_b.cmp(at_a)
    });
    results
}

#[tauri::command]
pub fn create_patient(mut record: PatientRecord) -> Result<PatientRecord, String> {
    if record.id.is_empty() || !record.id.starts_with("PAT-") {
        record.id = format!("PAT-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    }
    if record.admitted_at.is_empty() {
        record.admitted_at = chrono::Local::now().to_rfc3339();
    }

    let path = storage::patient_path(&record.id);
    if path.exists() {
        return Err("Patient ID already exists. Use update to modify.".to_string());
    }

    let val = serde_json::to_value(&record).map_err(|e| e.to_string())?;
    storage::write_json(&path, &val)?;
    Ok(record)
}

#[tauri::command]
pub fn get_patient(patient_id: String) -> Result<Value, String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    storage::read_json(&path)
}

#[tauri::command]
pub fn update_patient(patient_id: String, mut record: PatientRecord) -> Result<PatientRecord, String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    record.id = patient_id;
    let val = serde_json::to_value(&record).map_err(|e| e.to_string())?;
    storage::write_json(&path, &val)?;
    Ok(record)
}

#[tauri::command]
pub fn add_patient_event(patient_id: String, event: PatientEvent) -> Result<Value, String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    let mut data = storage::read_json(&path)?;

    let events = data.get_mut("events")
        .and_then(|v| v.as_array_mut());

    let event_val = serde_json::to_value(&event).map_err(|e| e.to_string())?;

    match events {
        Some(arr) => arr.insert(0, event_val),
        None => {
            data["events"] = Value::Array(vec![event_val]);
        }
    }

    storage::write_json(&path, &data)?;
    Ok(data)
}

#[tauri::command]
pub fn update_patient_status(patient_id: String, status: String) -> Result<Value, String> {
    let valid = ["active", "stable", "critical", "transferred", "discharged"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("Status must be one of: {:?}", valid));
    }

    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }

    let mut data = storage::read_json(&path)?;
    data["status"] = Value::String(status.clone());
    storage::write_json(&path, &data)?;

    Ok(serde_json::json!({"id": patient_id, "status": status}))
}

#[tauri::command]
pub fn delete_patient(patient_id: String) -> Result<(), String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())?;

    // Also purge attachments (photos, X-rays, etc.)
    let attach = patient_attach_dir(&patient_id);
    if attach.is_dir() {
        let _ = fs::remove_dir_all(&attach);
    }
    Ok(())
}

// ── Attachments ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn upload_attachment(patient_id: String, filename: String, data: Vec<u8>) -> Result<Value, String> {
    let path = storage::patient_path(&patient_id);
    if !path.exists() {
        return Err("Patient not found".to_string());
    }

    let attach = patient_attach_dir(&patient_id);
    let _ = fs::create_dir_all(&attach);

    let dest = attach.join(&filename);
    fs::write(&dest, &data).map_err(|e| format!("Failed to write attachment: {}", e))?;

    // Update attachmentNames in patient record
    let mut patient_data = storage::read_json(&path)?;
    let names = patient_data.get_mut("attachmentNames")
        .and_then(|v| v.as_array_mut());

    match names {
        Some(arr) => {
            let name_val = Value::String(filename.clone());
            if !arr.contains(&name_val) {
                arr.push(name_val);
            }
        }
        None => {
            patient_data["attachmentNames"] = Value::Array(vec![Value::String(filename.clone())]);
        }
    }

    storage::write_json(&path, &patient_data)?;
    Ok(serde_json::json!({"filename": filename, "patientId": patient_id}))
}

#[tauri::command]
pub fn get_attachment(patient_id: String, filename: String) -> Result<Vec<u8>, String> {
    let file_path = patient_attach_dir(&patient_id).join(&filename);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }
    fs::read(&file_path).map_err(|e| format!("Failed to read attachment: {}", e))
}

// ── Public Lookup ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn public_patient_lookup(name: Option<String>, all: Option<i32>) -> Vec<Value> {
    let name = name.unwrap_or_default();
    let all = all.unwrap_or(0);

    if name.trim().is_empty() && all == 0 {
        return Vec::new();
    }

    let mut results = Vec::new();
    for path in glob_patients() {
        if let Ok(record) = storage::read_json(&path) {
            // Only show opted-in patients
            let opt_in = record.get("publicOptIn").and_then(|v| v.as_bool()).unwrap_or(false)
                || record.get("public_opt_in").and_then(|v| v.as_bool()).unwrap_or(false);
            if !opt_in {
                continue;
            }

            // Name filter
            if !name.trim().is_empty() {
                let patient_name = record.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if !patient_name.to_lowercase().contains(&name.to_lowercase()) {
                    continue;
                }
            }

            let attachment_names = record.get("attachmentNames")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let photo_name = attachment_names.iter()
                .filter_map(|n| n.as_str())
                .find(|n| n.starts_with("photo."))
                .map(|s| s.to_string());

            let pid = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
            results.push(serde_json::json!({
                "id": pid,
                "name": record.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "wardId": record.get("wardId").and_then(|v| v.as_str()).unwrap_or(""),
                "roomNumber": record.get("roomNumber").and_then(|v| v.as_str()).unwrap_or(""),
                "status": record.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                "admittedAt": record.get("admittedAt").and_then(|v| v.as_str()).unwrap_or(""),
                "hasPhoto": photo_name.is_some(),
                "photoUrl": photo_name.as_ref().map(|p| format!("/api/patients/{}/attachments/{}", pid, p)),
            }));
        }
    }
    results
}

// ── Snapshot / Restore ──────────────────────────────────────────────────────

#[tauri::command]
pub fn patient_snapshot() -> Vec<Value> {
    glob_patients()
        .iter()
        .filter_map(|p| storage::read_json(p).ok())
        .collect()
}

#[tauri::command]
pub fn patient_restore(records: Vec<Value>) -> Value {
    let mut restored = 0;
    for rec in &records {
        let pid = rec.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if !pid.starts_with("PAT-") {
            continue;
        }
        let path = storage::patient_path(pid);
        if storage::write_json(&path, rec).is_ok() {
            restored += 1;
        }
    }
    serde_json::json!({"restored": restored, "total": records.len()})
}
