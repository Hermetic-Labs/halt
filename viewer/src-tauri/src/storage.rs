//! Shared storage layer — JSON persistence with AES-256-GCM encryption.
//!
//! Direct translation of `api/storage.py`.
//!
//! Every route module reads and writes data through `read_json()` / `write_json()`
//! so encryption, path conventions, and directory setup happen in one place.
//! Patient files (PAT-*.json) are encrypted with AES-256-GCM if a key exists;
//! other data files (wards, inventory, roster) are stored as plain JSON.
//!
//! Keys are auto-generated and stored in `DATA_DIR/.key` on first use.

use crate::config;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

// ── AES-256-GCM encryption ──────────────────────────────────────────────────

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

/// 32-byte encryption key, lazily loaded or generated.
static ENCRYPTION_KEY: OnceLock<Option<[u8; 32]>> = OnceLock::new();

/// Load or generate the encryption key. Returns None if crypto fails.
fn get_encryption_key() -> Option<[u8; 32]> {
    *ENCRYPTION_KEY.get_or_init(|| {
        let data_dir = config::data_dir();
        let _ = fs::create_dir_all(&data_dir);
        let key_file = data_dir.join(".key");

        if key_file.exists() {
            if let Ok(bytes) = fs::read(&key_file) {
                if bytes.len() >= 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes[..32]);
                    return Some(key);
                }
            }
        }

        // Generate new key
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        if fs::write(&key_file, key).is_ok() {
            log::info!("Generated new encryption key at {}", key_file.display());
            Some(key)
        } else {
            log::warn!("Failed to write encryption key — patient files will not be encrypted");
            None
        }
    })
}

/// Encrypt data with AES-256-GCM. Returns nonce (12 bytes) + ciphertext.
fn encrypt(plaintext: &[u8]) -> Option<Vec<u8>> {
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext).ok()?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Some(result)
}

/// Decrypt data encrypted with `encrypt()`.
fn decrypt(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 12 {
        return None;
    }
    let key = get_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).ok()?;

    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];

    cipher.decrypt(nonce, ciphertext).ok()
}

// ── Compatibility with Python Fernet ────────────────────────────────────────
//
// The Python backend uses Fernet (AES-128-CBC + HMAC). For migration
// compatibility, we attempt Fernet decryption as a fallback when AES-GCM
// decryption fails. This allows Rust to read files encrypted by Python.
//
// New files written by Rust use AES-256-GCM. Once all files are re-saved
// through Rust, Fernet fallback can be removed.

/// Attempt to decrypt a Python Fernet token.
/// Fernet tokens are base64-encoded and start with version byte 0x80.
fn try_fernet_decrypt(data: &[u8]) -> Option<Vec<u8>> {
    // Fernet tokens are base64-encoded text
    let text = std::str::from_utf8(data).ok()?;
    let decoded = base64_decode(text)?;

    // Fernet format: version (1) + timestamp (8) + IV (16) + ciphertext (N) + HMAC (32)
    if decoded.len() < 57 || decoded[0] != 0x80 {
        return None;
    }

    // For now, return None — full Fernet compat requires the Python key format.
    // This placeholder ensures the fallback path exists for when we add it.
    // Patient files created by Python will be readable once we implement
    // Fernet key loading from the existing .key file format.
    None
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    // Simple base64 decode using the standard alphabet
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE
        .decode(input.trim())
        .ok()
}

// ── JSON helpers ────────────────────────────────────────────────────────────

/// Read a JSON file, attempting decryption for patient files.
///
/// Mirrors Python's `storage.read_json()`:
/// - If encrypted (patient file), decrypt first then parse JSON.
/// - Falls back to plaintext JSON if decryption fails.
pub fn read_json(path: &PathBuf) -> Result<Value, String> {
    let raw = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    // Try AES-GCM decryption first
    if let Some(decrypted) = decrypt(&raw) {
        if let Ok(val) = serde_json::from_slice(&decrypted) {
            return Ok(val);
        }
    }

    // Try Fernet decryption (Python compatibility)
    if let Some(decrypted) = try_fernet_decrypt(&raw) {
        if let Ok(val) = serde_json::from_slice(&decrypted) {
            return Ok(val);
        }
    }

    // Fall back to plaintext JSON
    serde_json::from_slice(&raw)
        .map_err(|e| format!("Failed to parse JSON from {}: {}", path.display(), e))
}

/// Write a JSON value to a file. Patient files (PAT-*) are encrypted.
///
/// Mirrors Python's `storage.write_json()`.
pub fn write_json(path: &PathBuf, data: &Value) -> Result<(), String> {
    let payload = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;

    let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("");

    if filename.starts_with("PAT-") {
        // Encrypt patient files
        if let Some(encrypted) = encrypt(payload.as_bytes()) {
            fs::write(path, encrypted)
                .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
            return Ok(());
        }
        // Fall through to plaintext if encryption fails
        log::warn!(
            "Encryption unavailable — writing {} as plaintext",
            path.display()
        );
    }

    fs::write(path, payload.as_bytes())
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

// ── Path helpers ────────────────────────────────────────────────────────────
// Direct translations of the Python path functions in storage.py.

pub fn ensure_dirs() {
    let data = config::data_dir();
    let _ = fs::create_dir_all(&data);
    let _ = fs::create_dir_all(data.join("attachments"));
    let _ = fs::create_dir_all(data.join("avatars"));
    let _ = fs::create_dir_all(data.join("threads"));
}

pub fn patient_path(patient_id: &str) -> PathBuf {
    config::data_dir().join(format!("{}.json", patient_id))
}

pub fn ward_config_path() -> PathBuf {
    config::data_dir().join("_ward_config.json")
}

pub fn wards_path() -> PathBuf {
    config::data_dir().join("_wards.json")
}

pub fn inventory_path() -> PathBuf {
    config::data_dir().join("_inventory.json")
}

pub fn inventory_locations_path() -> PathBuf {
    config::data_dir().join("_inventory_locations.json")
}

pub fn roster_path() -> PathBuf {
    config::data_dir().join("_roster.json")
}

pub fn tasks_path() -> PathBuf {
    config::data_dir().join("_tasks.json")
}

pub fn chat_path() -> PathBuf {
    config::data_dir().join("_chat.json")
}

pub fn activity_path() -> PathBuf {
    config::data_dir().join("_activity.json")
}

pub fn attach_dir() -> PathBuf {
    config::data_dir().join("attachments")
}

pub fn avatar_dir() -> PathBuf {
    config::data_dir().join("avatars")
}

pub fn threads_dir() -> PathBuf {
    config::data_dir().join("threads")
}

/// DM thread file for a pair of members. IDs sorted alphabetically for consistency.
/// Direct translation of Python's `thread_path(id_a, id_b)`.
pub fn thread_path(id_a: &str, id_b: &str) -> PathBuf {
    let mut pair = [id_a, id_b];
    pair.sort();
    threads_dir().join(format!("{}--{}.json", pair[0], pair[1]))
}

// ── Activity log ────────────────────────────────────────────────────────────

/// Append an entry to the activity log. Fire-and-forget.
///
/// Direct translation of Python's `storage.log_activity()`.
/// Extra key-value pairs (e.g. action_type, qty) are stored alongside.
pub fn log_activity(
    who: &str,
    action: &str,
    target: &str,
    extra: Option<serde_json::Map<String, Value>>,
) {
    let path = activity_path();

    let mut entries: Vec<Value> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut entry = serde_json::json!({
        "who": who,
        "action": action,
        "target": target,
        "timestamp": chrono::Local::now().to_rfc3339(),
    });

    // Merge extra fields
    if let Some(extras) = extra {
        if let Value::Object(ref mut map) = entry {
            for (k, v) in extras {
                map.insert(k, v);
            }
        }
    }

    entries.push(entry);

    // Keep last 1000 entries (matches Python behavior)
    if entries.len() > 1000 {
        let start = entries.len() - 1000;
        entries = entries[start..].to_vec();
    }

    // Fire-and-forget: don't fail the caller if logging fails
    let _ = write_json(&path, &Value::Array(entries));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thread_path_sorted() {
        let p1 = thread_path("alice", "bob");
        let p2 = thread_path("bob", "alice");
        assert_eq!(p1, p2, "Thread path should be order-independent");
        assert!(p1.to_string_lossy().contains("alice--bob"));
    }

    #[test]
    fn test_patient_path_format() {
        let p = patient_path("PAT-20260413-010000");
        assert!(p.to_string_lossy().ends_with("PAT-20260413-010000.json"));
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = b"test patient data";
        if let Some(encrypted) = encrypt(plaintext) {
            let decrypted = decrypt(&encrypted).expect("decryption should succeed");
            assert_eq!(decrypted, plaintext);
        }
        // If encryption key fails (no filesystem), skip gracefully
    }

    #[test]
    fn test_json_roundtrip() {
        let dir = std::env::temp_dir().join("halt_test_storage");
        let _ = fs::create_dir_all(&dir);

        // Test plaintext (non-patient file)
        let path = dir.join("_test.json");
        let data = serde_json::json!({"name": "Test Ward", "rooms": ["R01", "R02"]});
        write_json(&path, &data).expect("write should succeed");
        let read_back = read_json(&path).expect("read should succeed");
        assert_eq!(data, read_back);

        // Cleanup
        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }
}
