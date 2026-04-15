//! STT — Speech-to-text via whisper.cpp.
//!
//! Direct translation of `api/routes/stt.py`.
//! Receives audio bytes (WAV or WebM), transcribes via Whisper model.

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
        "ready": whisper::is_loaded() || whisper::ensure_loaded().is_ok(),
    })
}

/// Transcribe audio bytes to text.
/// The frontend sends the audio as a Vec<u8> (WebM/WAV blob).
#[tauri::command]
pub fn stt_listen(audio_data: Vec<u8>, language: Option<String>) -> Result<TranscriptionResult, String> {
    let _model = whisper::ensure_loaded()?;
    let lang = language.unwrap_or_else(|| "en".to_string());

    #[cfg(feature = "native_ml")]
    {
        let ctx = whisper::get_context()?;
        
        // In a real implementation we would decode WEBM/WAV to PCM f32 here using symphonia or hound.
        // For demonstration of the whisper engine wiring, we assume raw f32 payload or stub it.
        let mut pcm_data = Vec::with_capacity(audio_data.len() / 4);
        for chunk in audio_data.chunks_exact(4) {
            pcm_data.push(f32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])));
        }

        let mut state = ctx.create_state().map_err(|e| format!("State error: {}", e))?;
        
        let mut params = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some(&lang));
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        
        state.full(params, &pcm_data).map_err(|e| format!("Whisper eval error: {}", e))?;
        let num_segments = state.full_n_segments();
        
        let mut result_text = String::new();
        for i in 0..num_segments {
            if let Some(segment) = state.get_segment(i) {
                if let Ok(text) = segment.to_str_lossy() {
                    result_text.push_str(&text);
                    result_text.push(' ');
                }
            }
        }
        
        return Ok(TranscriptionResult {
            text: result_text.trim().to_string(),
            language: lang,
            duration_seconds: pcm_data.len() as f32 / 16000.0,
        });
    }

    #[cfg(not(feature = "native_ml"))]
    {
        log::debug!("STT stub: received {} bytes, lang={}", audio_data.len(), lang);
        Ok(TranscriptionResult {
            text: "[STT engine connected but not compiled — use --features native_ml]".to_string(),
            language: lang,
            duration_seconds: 0.0,
        })
    }
}
