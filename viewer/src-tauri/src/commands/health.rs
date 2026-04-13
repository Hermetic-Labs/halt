//! Health check — model readiness and system status.
//!
//! Direct translation of `api/routes/health.py`.
//! Reports which AI models are present on disk and ready for inference.

use crate::config;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub models_dir: String,
    pub llm_ready: bool,
    pub llm_model: Option<String>,
    pub tts_ready: bool,
    pub stt_ready: bool,
    pub translation_ready: bool,
}

/// Check if a GGUF model file exists in MODELS_DIR.
fn find_gguf_model() -> Option<String> {
    let models = config::models_dir();
    if !models.is_dir() {
        return None;
    }

    // Look for any .gguf file
    if let Ok(entries) = std::fs::read_dir(&models) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("gguf") {
                return path.file_name().and_then(|n| n.to_str()).map(|s| s.to_string());
            }
        }
    }
    None
}

/// Check model readiness — called by the health check command.
///
/// Mirrors the Python `/health` endpoint response structure.
pub fn check_health() -> HealthStatus {
    let models_dir = config::models_dir();

    let gguf_model = find_gguf_model();
    let llm_ready = gguf_model.is_some();

    let tts_ready = models_dir.join("kokoro-v1.0.onnx").exists()
        && models_dir.join("voices-v1.0.bin").exists();

    let stt_ready = models_dir.join("faster-whisper-base").is_dir();

    let translation_ready = models_dir.join("nllb-200-distilled-600M-ct2").is_dir();

    HealthStatus {
        status: if llm_ready { "ready".into() } else { "waiting".into() },
        models_dir: models_dir.to_string_lossy().to_string(),
        llm_ready,
        llm_model: gguf_model,
        tts_ready,
        stt_ready,
        translation_ready,
    }
}

/// Tauri command — exposed to the frontend via `invoke('get_health')`.
#[tauri::command]
pub fn get_health() -> HealthStatus {
    check_health()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_returns_valid_status() {
        let status = check_health();
        // Status should be either "ready" or "waiting"
        assert!(
            status.status == "ready" || status.status == "waiting",
            "Unexpected status: {}",
            status.status
        );
        // models_dir should not be empty
        assert!(!status.models_dir.is_empty());
    }
}
