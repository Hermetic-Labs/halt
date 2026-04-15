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
pub fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    let translated = nllb::translate(&request.text, &request.source, &request.target)?;
    Ok(TranslateResponse {
        translated,
        source: request.source,
        target: request.target,
    })
}

#[tauri::command]
pub fn translate_batch(request: BatchTranslateRequest) -> Result<BatchTranslateResponse, String> {
    let translations: Vec<String> = {
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
    };

    Ok(BatchTranslateResponse {
        translations,
        source: request.source,
        target: request.target,
    })
}
