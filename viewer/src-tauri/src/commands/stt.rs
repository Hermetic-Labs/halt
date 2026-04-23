//! STT — Speech-to-text via whisper subprocess proxy.
//!
//! Direct translation of `api/routes/stt.py`.
//! Receives audio bytes (WAV, WebM, OGG, MP3), sends to halt-whisper
//! subprocess for transcription.

use crate::models::whisper;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_seconds: f32,
}

#[tauri::command]
pub fn stt_health() -> serde_json::Value {
    serde_json::json!({
        "ready": whisper::is_loaded(),
    })
}

/// Transcribe audio bytes to text.
/// The frontend sends the audio as a Vec<u8> (WebM/WAV blob).
/// Proxied to halt-whisper subprocess on port 7780.
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[tauri::command]
pub fn stt_listen(
    audio_data_b64: String,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    let audio_data = STANDARD.decode(&audio_data_b64)
        .map_err(|e| format!("STT Payload Decode Error: {}", e))?;
    
    stt_listen_raw(audio_data, language)
}

/// Internal pipeline core taking raw binary buffers.
pub fn stt_listen_raw(
    audio_data: Vec<u8>,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    let lang = language.unwrap_or_else(|| "en".to_string());

    let (text, detected_lang, duration) = whisper::transcribe(&audio_data, &lang)?;

    if !text.is_empty() {
        let safe_text = text.chars().take(80).collect::<String>();
        log::info!("[STT] Transcribed {:.1}s → '{}' (lang={})",
            duration, safe_text, detected_lang);
    }

    Ok(TranscriptionResult {
        text,
        language: detected_lang,
        duration_seconds: duration,
    })
}
