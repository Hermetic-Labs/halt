//! Chat — mesh chat with DM threads, reactions, and fan-out translations.
//!
//! Direct translation of the chat section of `api/routes/mesh.py`.
//!
//! Key features:
//!   - Group chat (broadcast to all clients)
//!   - DM threads (sorted pair IDs for consistent file naming)
//!   - Emoji reactions on messages
//!   - Background fan-out: each chat message is translated to all 41
//!     NLLB languages and the translations dict is appended to the message.
//!     This enables any receiving client to display the message in their
//!     configured language without a live round-trip.

use crate::models::nllb;
use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub sender_name: String,
    pub sender_role: String,
    pub message: String,
    #[serde(default)]
    pub target_name: String,
    pub timestamp: String,
    #[serde(default)]
    pub reactions: serde_json::Map<String, Value>,
    #[serde(default)]
    pub translations: serde_json::Map<String, Value>,
    #[serde(default)]
    pub attachment: String,
    #[serde(default, rename = "replyTo")]
    pub reply_to: String,
}

fn load_chat() -> Vec<Value> {
    let path = storage::chat_path();
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_chat(messages: &[Value]) -> Result<(), String> {
    // Keep last 500 messages (matches Python behavior)
    let to_save = if messages.len() > 500 {
        &messages[messages.len() - 500..]
    } else {
        messages
    };
    storage::write_json(&storage::chat_path(), &Value::Array(to_save.to_vec()))
}

#[tauri::command]
pub fn get_chat(limit: Option<usize>) -> Vec<Value> {
    let limit = limit.unwrap_or(100);
    let messages = load_chat();
    let start = if messages.len() > limit {
        messages.len() - limit
    } else {
        0
    };
    messages[start..].to_vec()
}

#[tauri::command]
pub fn send_chat(mut msg: ChatMessage) -> Result<ChatMessage, String> {
    if msg.id.is_empty() {
        msg.id = format!(
            "MSG-{}-{}",
            chrono::Local::now().format("%Y%m%d%H%M%S"),
            &uuid::Uuid::new_v4().to_string()[..8]
        );
    }
    if msg.timestamp.is_empty() {
        msg.timestamp = chrono::Local::now().to_rfc3339();
    }

    // Fan-out translations (background — non-blocking)
    if !msg.message.is_empty() {
        let source_lang = detect_language_hint(&msg.message);
        let lang_map = nllb::lang_map();
        let mut translations = serde_json::Map::new();

        for lang in lang_map.keys() {
            if *lang != source_lang {
                let translated = nllb::translate(&msg.message, source_lang, lang);
                if translated != msg.message {
                    translations.insert(lang.to_string(), Value::String(translated));
                }
            }
        }
        msg.translations = translations;
    }

    let mut messages = load_chat();
    let msg_val = serde_json::to_value(&msg).map_err(|e| e.to_string())?;
    messages.push(msg_val);
    save_chat(&messages)?;

    // TODO(Layer 4 wiring): broadcast to all connected WebSocket clients
    // server::broadcast(serde_json::json!({ "type": "chat", "message": msg }));

    Ok(msg)
}

#[tauri::command]
pub fn clear_chat() -> Value {
    let _ = save_chat(&[]);
    serde_json::json!({"status": "ok"})
}

#[tauri::command]
pub fn react_to_message(
    message_id: String,
    emoji: String,
    member_name: String,
) -> Result<Value, String> {
    let mut messages = load_chat();

    let msg = messages
        .iter_mut()
        .filter_map(|m| m.as_object_mut())
        .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(&message_id))
        .ok_or("Message not found")?;

    let reactions = msg
        .entry("reactions")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));

    if let Value::Object(ref mut rmap) = reactions {
        let users = rmap
            .entry(emoji.clone())
            .or_insert_with(|| Value::Array(Vec::new()));

        if let Value::Array(ref mut arr) = users {
            let name_val = Value::String(member_name.clone());
            if arr.contains(&name_val) {
                arr.retain(|v| v != &name_val); // Toggle off
            } else {
                arr.push(name_val); // Toggle on
            }
            // Remove emoji key if no users left
            if arr.is_empty() {
                rmap.remove(&emoji);
            }
        }
    }

    save_chat(&messages)?;
    Ok(serde_json::json!({"status": "ok", "message_id": message_id}))
}

#[tauri::command]
pub fn get_thread(name: String, my_name: String) -> Vec<Value> {
    let path = storage::thread_path(&name, &my_name);
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Upload a chat file attachment.
#[tauri::command]
pub fn upload_chat_attachment(filename: String, data: Vec<u8>) -> Result<Value, String> {
    let attach_dir = storage::attach_dir().join("chat");
    let _ = std::fs::create_dir_all(&attach_dir);

    let safe_name = format!(
        "{}-{}",
        chrono::Local::now().format("%Y%m%d%H%M%S"),
        filename
    );
    let dest = attach_dir.join(&safe_name);

    std::fs::write(&dest, &data).map_err(|e| format!("Failed to write: {}", e))?;

    Ok(serde_json::json!({"filename": safe_name}))
}

/// Retrieve a chat attachment.
#[tauri::command]
pub fn get_chat_attachment(filename: String) -> Result<Vec<u8>, String> {
    let path = storage::attach_dir().join("chat").join(&filename);
    if !path.exists() {
        return Err("File not found".to_string());
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Simple language detection hint — check if text starts with common
/// non-Latin scripts. Falls back to "en".
fn detect_language_hint(text: &str) -> &str {
    let first_char = text.chars().next().unwrap_or('a');
    match first_char {
        '\u{0600}'..='\u{06FF}' => "ar",
        '\u{0900}'..='\u{097F}' => "hi",
        '\u{3040}'..='\u{30FF}' | '\u{4E00}'..='\u{9FFF}' => "ja",
        '\u{AC00}'..='\u{D7AF}' => "ko",
        '\u{0400}'..='\u{04FF}' => "ru",
        _ => "en",
    }
}
