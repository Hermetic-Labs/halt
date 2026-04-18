//! Translation — text translation via NLLB-200.
//!
//! Direct translation of `api/routes/translate.py`.
//!
//! Supports single text and batch translation. The NLLB model handles
//! 200 language pairs. Language codes are mapped from UI codes (en, es, ja)
//! to NLLB BCP-47 codes (eng_Latn, spa_Latn, jpn_Jpan).

use crate::models::nllb;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    #[serde(default = "default_source")]
    pub source: String,
    pub target: String,
}

#[derive(Debug, Deserialize)]
pub struct BatchTranslateRequest {
    pub texts: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    pub target: String,
}

fn default_source() -> String {
    "en".to_string()
}

#[derive(Debug, Serialize)]
pub struct TranslateResponse {
    pub translated: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Serialize)]
pub struct BatchTranslateResponse {
    pub translations: Vec<String>,
    pub source: String,
    pub target: String,
}

#[tauri::command]
pub fn translate_status() -> Value {
    serde_json::json!({
        "ready": nllb::is_loaded(),
    })
}

#[tauri::command]
pub async fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    log::info!("[api::translate_text] Received native command request: source={} target={}", request.source, request.target);
    let source_clone = request.source.clone();
    let target_clone = request.target.clone();

    let text_len = request.text.len();
    let translated = tauri::async_runtime::spawn_blocking(move || {
        log::debug!("[api::translate_text] Delegating to blocking nllb::translate...");
        nllb::translate(&request.text, &request.source, &request.target)
    })
    .await;
    
    log::info!("[api::translate_text] Threadpool join complete. Formatting result...");
    let translated = match translated {
        Ok(res) => res.map_err(|e| format!("NLLB native translate failed: {}", e))?,
        Err(e) => {
            log::error!("[api::translate_text] Blocking task pool panicked: {}", e);
            return Err(format!("Task paniced: {}", e));
        }
    };

    log::info!("[api::translate_text] Fully resolved. Dispatched translation of length {}.", translated.len());

    Ok(TranslateResponse {
        translated,
        source: source_clone,
        target: target_clone,
    })
}

#[tauri::command]
pub async fn translate_batch(request: BatchTranslateRequest) -> Result<BatchTranslateResponse, String> {
    let source_clone = request.source.clone();
    let target_clone = request.target.clone();

    let translations: Vec<String> = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "native_ml")]
        {
            use rayon::prelude::*;
            request
                .texts
                .par_iter()
                .map(|t| nllb::translate(t, &request.source, &request.target).unwrap_or_else(|_| t.clone()))
                .collect()
        }

        #[cfg(not(feature = "native_ml"))]
        {
            request
                .texts
                .iter()
                .map(|t| nllb::translate(t, &request.source, &request.target).unwrap_or_else(|_| t.clone()))
                .collect()
        }
    })
    .await
    .map_err(|e| format!("Task paniced: {}", e))?;

    Ok(BatchTranslateResponse {
        translations,
        source: source_clone,
        target: target_clone,
    })
}
