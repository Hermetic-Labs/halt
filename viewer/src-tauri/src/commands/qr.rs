//! QR Code generation — public lookup, discharge, and mesh join.
//!
//! Full conversion exists (uses qrcode + image crates).
//! Currently stubbed — re-enable when SmartScreen is bypassed.
//!
//! Python source: patients.py:125, patients.py:155, mesh.py:510

use crate::mesh::server::get_local_ip;
use serde_json::Value;

fn base_url() -> String {
    let ip = get_local_ip();
    let port = 7778;
    let proto = if std::env::var("HALT_USE_SSL").is_ok() { "https" } else { "http" };
    format!("{}://{}:{}", proto, ip, port)
}

/// Translation of patients.py:public_lookup_qr() (line 125).
/// QR image generation requires `qrcode` + `image` crates.
#[tauri::command]
pub fn public_lookup_qr() -> Value {
    let lookup_url = format!("{}/lookup", base_url());
    serde_json::json!({
        "url": lookup_url,
        "qr_image": null,
    })
}

/// Translation of patients.py:discharge_qr() (line 155).
#[tauri::command]
pub fn discharge_qr(patient_id: String, lang: Option<String>) -> Result<Value, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    let path = crate::config::data_dir().join(format!("{}.json", patient_id));
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    let export_url = format!("{}/lookup?id={}&lang={}", base_url(), patient_id, lang);
    Ok(serde_json::json!({
        "url": export_url,
        "qr_image": null,
    }))
}

/// Translation of mesh.py:mesh_qr() (line 510).
#[tauri::command]
pub fn mesh_qr(name: Option<String>, role: Option<String>) -> Value {
    let mut app_url = base_url();
    let mut params = Vec::new();
    if let Some(n) = &name { params.push(format!("name={}", n)); }
    if let Some(r) = &role { params.push(format!("role={}", r)); }
    if !params.is_empty() {
        app_url = format!("{}?{}", app_url, params.join("&"));
    }
    serde_json::json!({
        "app_url": app_url,
        "qr_image": null,
    })
}
