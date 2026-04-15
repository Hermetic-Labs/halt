//! Setup — SSL certificate lifecycle management.
//!
//! Native Rust cert generation using `rcgen` (pure Rust, no OpenSSL).
//! Generates a self-signed root CA + server cert with the current LAN IP as SAN.
//! This enables HTTPS on the Vite dev server so mobile browsers allow getUserMedia.
//!
//! Python source: setup.py (all 4 endpoints)

use crate::config;
use crate::mesh::server::get_local_ip;
use base64::Engine;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// SSL certs live at dev/ssl/ — same path Vite checks.
fn ssl_dir() -> PathBuf {
    // When running from src-tauri/, ../dev/ssl/ is the right path.
    // When running from a built binary, fall back to config data dir.
    let dev_ssl = std::env::current_dir()
        .map(|d| d.join("../dev/ssl"))
        .unwrap_or_else(|_| PathBuf::from("../dev/ssl"));

    if dev_ssl.exists() || dev_ssl.parent().is_some_and(|p| p.exists()) {
        let _ = fs::create_dir_all(&dev_ssl);
        dev_ssl
    } else {
        let dir = config::data_dir().join("ssl");
        let _ = fs::create_dir_all(&dir);
        dir
    }
}

fn cert_path() -> PathBuf {
    ssl_dir().join("cert.pem")
}
fn key_path() -> PathBuf {
    ssl_dir().join("key.pem")
}
fn ca_path() -> PathBuf {
    ssl_dir().join("rootCA.pem")
}
fn ca_key_path() -> PathBuf {
    ssl_dir().join("rootCA-key.pem")
}
fn ip_file() -> PathBuf {
    ssl_dir().join("last_ip.txt")
}

/// Generate a root CA certificate and key using rcgen.
fn generate_ca() -> Result<(String, String), String> {
    use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};

    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, "Hermetic Labs");
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "HALT Medical Local CA");
    // 10 year validity
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let key_pair = KeyPair::generate().map_err(|e| format!("CA key generation failed: {}", e))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("CA cert generation failed: {}", e))?;

    Ok((cert.pem(), key_pair.serialize_pem()))
}

/// Generate a server certificate signed by our CA for the given IP.
fn generate_server_cert(
    ca_pem: &str,
    ca_key_pem: &str,
    ip: &str,
) -> Result<(String, String), String> {
    use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, SanType};

    // Reconstruct the CA from its key pair — rcgen signs with the key, not the cert PEM
    let ca_key =
        KeyPair::from_pem(ca_key_pem).map_err(|e| format!("Failed to load CA key: {}", e))?;

    // Build a CA params to get a signable certificate
    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, "Hermetic Labs");
    ca_params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "HALT Medical Local CA");
    ca_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    ca_params.not_after = rcgen::date_time_ymd(2034, 1, 1);
    let ca_cert = ca_params
        .self_signed(&ca_key)
        .map_err(|e| format!("Failed to reconstruct CA: {}", e))?;

    let mut params = CertificateParams::default();
    params
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, "Hermetic Labs");
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "HALT Triage Server");
    // SAN entries — localhost + the current LAN IP
    params.subject_alt_names = vec![
        SanType::DnsName(
            "localhost"
                .try_into()
                .map_err(|e| format!("SAN error: {}", e))?,
        ),
        SanType::IpAddress(
            ip.parse()
                .map_err(|e| format!("Invalid IP '{}': {}", ip, e))?,
        ),
        SanType::IpAddress("127.0.0.1".parse().unwrap()),
    ];
    // ~2 year validity
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2026, 12, 31);

    let server_key =
        KeyPair::generate().map_err(|e| format!("Server key generation failed: {}", e))?;
    let cert = params
        .signed_by(&server_key, &ca_cert, &ca_key)
        .map_err(|e| format!("Server cert signing failed: {}", e))?;

    Ok((cert.pem(), server_key.serialize_pem()))
}

/// Ensure SSL certs exist and match the current IP. Regenerate if needed.
pub fn ensure_certs() -> Result<Value, String> {
    let ip = get_local_ip();
    let dir = ssl_dir();
    let _ = fs::create_dir_all(&dir);

    // Check if regeneration needed
    let last_ip = fs::read_to_string(ip_file())
        .ok()
        .map(|s| s.trim().to_string());
    let need_regen = !ca_path().exists()
        || !ca_key_path().exists()
        || !cert_path().exists()
        || !key_path().exists()
        || last_ip.as_deref() != Some(&ip);

    if !need_regen {
        return Ok(serde_json::json!({
            "action": "none", "ip": ip, "ready": true,
        }));
    }

    let reason = if !ca_path().exists() {
        "No root CA found"
    } else if !cert_path().exists() {
        "No server cert found"
    } else {
        "IP changed"
    };

    // Generate or load CA
    let (ca_pem, ca_key_pem) = if !ca_path().exists() || !ca_key_path().exists() {
        let (cert, key) = generate_ca()?;
        fs::write(ca_path(), &cert).map_err(|e| format!("Write CA cert: {}", e))?;
        fs::write(ca_key_path(), &key).map_err(|e| format!("Write CA key: {}", e))?;
        log::info!("Generated new root CA");
        (cert, key)
    } else {
        let cert = fs::read_to_string(ca_path()).map_err(|e| format!("Read CA cert: {}", e))?;
        let key = fs::read_to_string(ca_key_path()).map_err(|e| format!("Read CA key: {}", e))?;
        (cert, key)
    };

    // Generate server cert for current IP
    let (srv_cert, srv_key) = generate_server_cert(&ca_pem, &ca_key_pem, &ip)?;
    fs::write(cert_path(), &srv_cert).map_err(|e| format!("Write server cert: {}", e))?;
    fs::write(key_path(), &srv_key).map_err(|e| format!("Write server key: {}", e))?;
    fs::write(ip_file(), &ip).map_err(|e| format!("Write IP: {}", e))?;

    log::info!("SSL certs regenerated for {} ({})", ip, reason);

    Ok(serde_json::json!({
        "action": "regenerated",
        "reason": reason,
        "ip": ip,
        "ready": true,
    }))
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

/// Translation of setup.py:cert_status() (line 170).
#[tauri::command]
pub fn setup_status() -> Value {
    let ip = get_local_ip();
    let last_ip = fs::read_to_string(ip_file())
        .ok()
        .map(|s| s.trim().to_string());
    let cert_exists = cert_path().exists() && key_path().exists();
    let ca_exists = ca_path().exists();
    let ip_match = last_ip.as_deref() == Some(ip.as_str());
    let has_ssl = cert_exists && ca_exists;

    serde_json::json!({
        "ssl_enabled": has_ssl,
        "current_ip": ip,
        "cert_ip": last_ip,
        "ip_match": ip_match,
        "cert_exists": cert_exists,
        "ca_exists": ca_exists,
        "https_url": format!("https://{}:7777", ip),
        "http_url": format!("http://{}:7777", ip),
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
#[tauri::command]
pub fn download_mobileconfig() -> Result<String, String> {
    if !ca_path().exists() {
        return Err("No root CA. Run regenerate first.".to_string());
    }
    let ca_bytes = fs::read(ca_path()).map_err(|e| e.to_string())?;
    let ca_b64 = base64::engine::general_purpose::STANDARD.encode(&ca_bytes);
    let ip = get_local_ip();
    let uuid1 = uuid::Uuid::new_v4();
    let uuid2 = uuid::Uuid::new_v4();

    let mobileconfig = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
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
            <string>Enables secure video calls for HALT Medical Triage on your local network ({ip}).</string>
            <key>PayloadDisplayName</key>
            <string>HALT Medical — Network Security</string>
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
    <string>HALT Medical — Secure Video</string>
    <key>PayloadIdentifier</key>
    <string>com.hermeticlabs.halt.profile.{uuid1}</string>
    <key>PayloadOrganization</key>
    <string>Hermetic Labs</string>
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
        ca_b64 = ca_b64,
        ip = ip,
        uuid1 = uuid1,
        uuid2 = uuid2
    );

    Ok(mobileconfig)
}

/// Translation of setup.py:regenerate_certs() (line 264).
#[tauri::command]
pub fn regenerate_certs() -> Result<Value, String> {
    // Delete IP record to force regeneration
    let _ = fs::remove_file(ip_file());
    ensure_certs()
}
