//! Setup — SSL certificate lifecycle management.
//!
//! Full conversion exists (uses rcgen + time crates).
//! Currently stubbed — re-enable when SmartScreen is bypassed.
//!
//! Python source: setup.py (all 4 endpoints)

use crate::config;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn ssl_dir() -> PathBuf {
    let dir = config::data_dir().join("ssl");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn cert_path() -> PathBuf { ssl_dir().join("cert.pem") }
fn key_path() -> PathBuf { ssl_dir().join("key.pem") }
fn ca_path() -> PathBuf { ssl_dir().join("rootCA.pem") }
fn ip_file() -> PathBuf { ssl_dir().join("last_ip.txt") }

/// Translation of setup.py:cert_status() (line 170).
#[tauri::command]
pub fn setup_status() -> Value {
    let ip = crate::mesh::server::get_local_ip();
    let last_ip = fs::read_to_string(ip_file()).ok().map(|s| s.trim().to_string());
    let cert_exists = cert_path().exists() && key_path().exists();
    let ca_exists = ca_path().exists();
    let ip_match = last_ip.as_deref() == Some(ip.as_str());
    let ssl_enabled = std::env::var("HALT_USE_SSL").ok().as_deref() == Some("1");

    serde_json::json!({
        "ssl_enabled": ssl_enabled,
        "current_ip": ip,
        "cert_ip": last_ip,
        "ip_match": ip_match,
        "cert_exists": cert_exists,
        "ca_exists": ca_exists,
        "https_url": format!("https://{}:7778", ip),
        "http_url": format!("http://{}:7778", ip),
        "needs_regeneration": !ip_match || !cert_exists,
    })
}

/// Translation of setup.py:download_ca_pem() (line 251).
#[tauri::command]
pub fn download_ca_pem() -> Result<Vec<u8>, String> {
    let path = ca_path();
    if !path.exists() {
        return Err("No root CA. Run regenerate first.".to_string());
    }
    fs::read(&path).map_err(|e| e.to_string())
}

/// Translation of setup.py:download_mobileconfig() (line 191).
/// Full .mobileconfig XML generation requires rcgen + time crates.
#[tauri::command]
pub fn download_mobileconfig() -> Result<String, String> {
    if !ca_path().exists() {
        return Err("No root CA. Run regenerate first.".to_string());
    }
    let ca_bytes = fs::read(ca_path()).map_err(|e| e.to_string())?;
    use base64::Engine;
    let ca_b64 = base64::engine::general_purpose::STANDARD.encode(&ca_bytes);
    let ip = crate::mesh::server::get_local_ip();
    let uuid1 = uuid::Uuid::new_v4();
    let uuid2 = uuid::Uuid::new_v4();

    // Matches the XML template in setup.py:download_mobileconfig()
    let mobileconfig = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadCertificateFileName</key>
            <string>halt-ca.pem</string>
            <key>PayloadContent</key>
            <data>{ca_b64}</data>
            <key>PayloadDescription</key>
            <string>HALT Medical Local CA ({ip})</string>
            <key>PayloadDisplayName</key>
            <string>HALT Medical CA</string>
            <key>PayloadIdentifier</key>
            <string>com.hermeticlabs.halt.ca.{uuid2}</string>
            <key>PayloadType</key>
            <string>com.apple.security.root</string>
            <key>PayloadUUID</key>
            <string>{uuid2}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>HALT Secure Connection</string>
    <key>PayloadIdentifier</key>
    <string>com.hermeticlabs.halt.profile.{uuid1}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>{uuid1}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>"#,
        ca_b64 = ca_b64, ip = ip, uuid1 = uuid1, uuid2 = uuid2);

    Ok(mobileconfig)
}

/// Translation of setup.py:ensure_certs() (line 102).
/// Full cert generation requires rcgen + time crates.
#[tauri::command]
pub fn regenerate_certs() -> Result<Value, String> {
    let ip = crate::mesh::server::get_local_ip();

    // Status check logic works without rcgen — we can detect state
    let last_ip = fs::read_to_string(ip_file()).ok().map(|s| s.trim().to_string());
    let need_regen = !ca_path().exists()
        || !cert_path().exists()
        || !key_path().exists()
        || last_ip.as_deref() != Some(&ip);

    if !need_regen {
        return Ok(serde_json::json!({
            "action": "none", "ip": ip, "ready": true,
        }));
    }

    // Cert generation needs rcgen crate — blocked by SmartScreen
    Err("Certificate generation requires rcgen crate (blocked by SmartScreen). Use Python sidecar for now.".to_string())
}
