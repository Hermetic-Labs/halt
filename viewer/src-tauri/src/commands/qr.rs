//! QR Code generation — public lookup, discharge, and mesh join.
//!
//! Native Rust QR generation using the `qrcode` crate.
//! Renders to SVG data URIs for zero-dependency image output.
//!
//! Python source: patients.py:125, patients.py:155, mesh.py:510

use crate::mesh::server::get_local_ip;
use base64::Engine;
use qrcode::QrCode;
use serde_json::Value;

/// Build the base URL for the app (protocol://ip:port).
/// Auto-detects HTTPS if dev/ssl/cert.pem exists (matching Vite config).
fn base_url() -> String {
    let ip = get_local_ip();
    let port = std::env::var("HALT_FRONTEND_PORT").unwrap_or_else(|_| "7777".to_string());

    // Check if SSL certs exist — same path Vite checks
    let has_ssl = std::env::var("HALT_USE_SSL").is_ok()
        || std::path::Path::new("../dev/ssl/cert.pem").exists()
        || std::env::current_exe()
            .ok()
            .and_then(|p| {
                p.parent()
                    .map(|d| d.join("../../dev/ssl/cert.pem").exists())
            })
            .unwrap_or(false);

    let proto = if has_ssl { "https" } else { "http" };
    format!("{}://{}:{}", proto, ip, port)
}

/// Render a URL into a base64-encoded PNG data URI via the qrcode crate.
/// Falls back to SVG data URI if PNG encoding isn't available.
fn render_qr_data_uri(url: &str) -> String {
    match QrCode::new(url.as_bytes()) {
        Ok(code) => {
            // Render as SVG string (no image crate needed)
            let svg = code
                .render::<qrcode::render::svg::Color>()
                .min_dimensions(220, 220)
                .quiet_zone(true)
                .build();
            let b64 = base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());
            format!("data:image/svg+xml;base64,{}", b64)
        }
        Err(e) => {
            log::warn!(
                "QR generation failed for '{}': {}",
                &url[..url.len().min(60)],
                e
            );
            String::new()
        }
    }
}

/// Public patient lookup QR.
/// Direct translation of patients.py:public_lookup_qr().
#[tauri::command]
pub fn public_lookup_qr() -> Value {
    let lookup_url = format!("{}/lookup", base_url());
    let qr_image = render_qr_data_uri(&lookup_url);
    serde_json::json!({
        "url": lookup_url,
        "qr_image": if qr_image.is_empty() { Value::Null } else { Value::String(qr_image) },
    })
}

/// Discharge QR for a specific patient.
/// Direct translation of patients.py:discharge_qr().
#[tauri::command]
pub fn discharge_qr(patient_id: String, lang: Option<String>) -> Result<Value, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    let path = crate::config::data_dir().join(format!("{}.json", patient_id));
    if !path.exists() {
        return Err("Patient not found".to_string());
    }
    let export_url = format!("{}/lookup?id={}&lang={}", base_url(), patient_id, lang);
    let qr_image = render_qr_data_uri(&export_url);
    Ok(serde_json::json!({
        "url": export_url,
        "qr_image": if qr_image.is_empty() { Value::Null } else { Value::String(qr_image) },
    }))
}

/// Mesh join QR — generates a QR code with the app URL and optional name/role params.
/// Direct translation of mesh.py:mesh_qr().
#[tauri::command]
pub fn mesh_qr(name: Option<String>, role: Option<String>) -> Value {
    let mut app_url = base_url();
    let mut params = Vec::new();
    if let Some(n) = &name {
        params.push(format!("name={}", n));
    }
    if let Some(r) = &role {
        params.push(format!("role={}", r));
    }
    if !params.is_empty() {
        app_url = format!("{}?{}", app_url, params.join("&"));
    }
    let qr_image = render_qr_data_uri(&app_url);
    serde_json::json!({
        "app_url": app_url,
        "qr_image": if qr_image.is_empty() { Value::Null } else { Value::String(qr_image) },
    })
}
