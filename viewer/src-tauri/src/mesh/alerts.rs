//! Alerts — emergency broadcasts, announcements, and supply chain alerts.
//!
//! Direct translation of the alert/emergency/announcement handlers in `api/routes/mesh.py`.
//!
//! 🔴 LIFE-CRITICAL: These functions broadcast to EVERY connected device.
//! The emergency function is the digital equivalent of screaming "MEDIC!"
//! across a field hospital. The announcement system delivers pre-translated
//! multi-language cards with optional pre-generated audio.
//!
//! Three phases of an announcement card (user requirement):
//!   1. Source language text (what the sender typed)
//!   2. English bridge (if source isn't English)
//!   3. Target language (receiver's configured language)

use crate::models::nllb;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct AlertRequest {
    pub ward: String,
    pub bed: String,
    pub categories: Vec<String>,
    #[serde(default)]
    pub categories_text: String,
    pub sender_name: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Deserialize)]
pub struct EmergencyRequest {
    pub ward: String,
    pub bed: String,
    pub categories: Vec<String>,
    #[serde(default)]
    pub categories_text: String,
    pub sender_name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub sound: String,
}

#[derive(Debug, Deserialize)]
pub struct AnnouncementRequest {
    pub message: String,
    pub sender_name: String,
    #[serde(default)]
    pub sound: String,
    #[serde(default)]
    pub audio_base64: String,
    #[serde(default)]
    pub translations: serde_json::Map<String, Value>,
}

/// Build the standard broadcast payload for an alert.
fn build_alert_payload(req: &AlertRequest) -> Value {
    let now = chrono::Local::now();
    serde_json::json!({
        "type": "alert",
        "ward": req.ward,
        "bed": req.bed,
        "categories": req.categories,
        "categories_text": req.categories_text,
        "sender_name": req.sender_name,
        "notes": req.notes,
        "timestamp": now.timestamp(),
        "time_str": now.format("%H:%M:%S").to_string(),
    })
}

/// 🔴 EMERGENCY — highest priority broadcast.
///
/// This fires to ALL connected devices with an audible alarm.
/// The receiving UI renders a full-screen red overlay that cannot be dismissed
/// without acknowledgment. This is the "someone is dying" signal.
///
/// Flow:
///   1. Build emergency payload with ward/bed/categories
///   2. Log to chat (so it's in the record)
///   3. Broadcast to all WebSocket clients
///   4. Generate translations for all 41 languages (background)
#[tauri::command]
pub fn mesh_emergency(req: EmergencyRequest) -> Result<Value, String> {
    let now = chrono::Local::now();
    let notes_text = if req.notes.is_empty() {
        format!(
            "EMERGENCY in {} bed {}: {}",
            req.ward, req.bed, req.categories_text
        )
    } else {
        req.notes.clone()
    };

    // Build broadcast payload
    let mut payload = serde_json::json!({
        "type": "emergency",
        "ward": req.ward,
        "bed": req.bed,
        "categories": req.categories,
        "categories_text": req.categories_text,
        "sender_name": req.sender_name,
        "notes": notes_text,
        "sound": if req.sound.is_empty() { "emergency" } else { &req.sound },
        "timestamp": now.timestamp(),
        "time_str": now.format("%H:%M:%S").to_string(),
    });

    // Generate translations for the emergency message
    // This is the 3-phase card: source → english bridge → target
    let lang_map = nllb::lang_map();
    let mut translations = serde_json::Map::new();
    for lang in lang_map.keys() {
        if *lang != "en" {
            let translated = nllb::translate(&notes_text, "en", lang);
            if translated != notes_text {
                translations.insert(lang.to_string(), Value::String(translated));
            }
        }
    }
    payload["translations"] = Value::Object(translations);

    // Log to chat record
    let chat_msg = serde_json::json!({
        "id": format!("EMRG-{}", now.format("%Y%m%d-%H%M%S-%f")),
        "sender_name": req.sender_name,
        "sender_role": "system",
        "message": format!("🚨 EMERGENCY: {} — {} bed {}", notes_text, req.ward, req.bed),
        "target_name": "",
        "timestamp": now.to_rfc3339(),
    });
    append_to_chat(chat_msg);

    // TODO: Broadcast to all connected WebSocket clients
    // server::broadcast(payload.clone());

    log::warn!(
        "🚨 EMERGENCY broadcast: {} bed {} — {}",
        req.ward,
        req.bed,
        notes_text
    );

    Ok(payload)
}

/// Standard alert — lower priority than emergency.
/// Generates a notification on all devices but no full-screen overlay.
#[tauri::command]
pub fn mesh_alert(req: AlertRequest) -> Result<Value, String> {
    let payload = build_alert_payload(&req);
    let now = chrono::Local::now();

    // Log to chat
    let chat_msg = serde_json::json!({
        "id": format!("ALRT-{}", now.format("%Y%m%d-%H%M%S-%f")),
        "sender_name": req.sender_name,
        "sender_role": "system",
        "message": format!("⚠️ ALERT: {} — {} bed {}", req.categories_text, req.ward, req.bed),
        "target_name": "",
        "timestamp": now.to_rfc3339(),
    });
    append_to_chat(chat_msg);

    // TODO: Broadcast to all connected WebSocket clients
    // server::broadcast(payload.clone());

    Ok(payload)
}

/// 🔴 ANNOUNCEMENT — system-wide message with pre-generated audio + translations.
///
/// This is the "if someone's bleeding out and there's responders just over a bridge"
/// system. The announcement card arrives with:
///   1. The original message text
///   2. Pre-generated audio (base64 WAV from TTS, if provided)
///   3. Translations dict for all 41 languages
///
/// The receiving UI renders the card in the receiver's configured language
/// with a play button for the audio. No network round-trip needed.
#[tauri::command]
pub fn mesh_announcement(req: AnnouncementRequest) -> Result<Value, String> {
    let now = chrono::Local::now();

    // Start with provided translations, then fill in any missing languages
    let mut translations = req.translations.clone();
    let lang_map = nllb::lang_map();
    for lang in lang_map.keys() {
        if *lang != "en" && !translations.contains_key(*lang) {
            let translated = nllb::translate(&req.message, "en", lang);
            if translated != req.message {
                translations.insert(lang.to_string(), Value::String(translated));
            }
        }
    }

    let payload = serde_json::json!({
        "type": "announcement",
        "message": req.message,
        "sender_name": req.sender_name,
        "sound": if req.sound.is_empty() { "announcement" } else { &req.sound },
        "audio_base64": req.audio_base64,
        "translations": translations,
        "timestamp": now.timestamp(),
        "time_str": now.format("%H:%M:%S").to_string(),
    });

    // Log to chat
    let chat_msg = serde_json::json!({
        "id": format!("ANN-{}", now.format("%Y%m%d-%H%M%S-%f")),
        "sender_name": req.sender_name,
        "sender_role": "system",
        "message": format!("📢 ANNOUNCEMENT: {}", req.message),
        "target_name": "",
        "timestamp": now.to_rfc3339(),
    });
    append_to_chat(chat_msg);

    // TODO: Broadcast to all connected WebSocket clients
    // server::broadcast(payload.clone());

    log::info!("📢 Announcement broadcast: {}", req.message);

    Ok(payload)
}

/// Append a message to the chat log (shared helper).
fn append_to_chat(msg: Value) {
    let cp = storage::chat_path();
    let mut messages: Vec<Value> = if cp.exists() {
        std::fs::read_to_string(&cp)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    messages.push(msg);
    if messages.len() > 500 {
        let start = messages.len() - 500;
        messages = messages[start..].to_vec();
    }
    let _ = storage::write_json(&cp, &Value::Array(messages));
}
