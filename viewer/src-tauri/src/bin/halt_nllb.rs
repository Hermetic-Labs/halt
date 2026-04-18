//! halt-nllb — standalone NLLB translation server.
//!
//! Runs as a separate process to avoid CTranslate2 debug CRT conflicts.
//! Listens on port 7781, exposes /health and /translate endpoints.

use axum::{routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use ct2rs::{Config, TranslationOptions, Translator};
use ct2rs::tokenizers::sentencepiece::Tokenizer as SpTokenizer;

static TRANSLATOR: OnceLock<Mutex<Translator<SpTokenizer>>> = OnceLock::new();

fn lang_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("en", "eng_Latn"); m.insert("es", "spa_Latn"); m.insert("fr", "fra_Latn");
    m.insert("ar", "arb_Arab"); m.insert("bn", "ben_Beng"); m.insert("de", "deu_Latn");
    m.insert("he", "heb_Hebr"); m.insert("hi", "hin_Deva"); m.insert("id", "ind_Latn");
    m.insert("it", "ita_Latn"); m.insert("ja", "jpn_Jpan"); m.insert("ko", "kor_Hang");
    m.insert("nl", "nld_Latn"); m.insert("pl", "pol_Latn"); m.insert("pt", "por_Latn");
    m.insert("ru", "rus_Cyrl"); m.insert("sw", "swh_Latn"); m.insert("th", "tha_Thai");
    m.insert("tl", "tgl_Latn"); m.insert("tr", "tur_Latn"); m.insert("ur", "urd_Arab");
    m.insert("vi", "vie_Latn"); m.insert("zh", "zho_Hans"); m.insert("uk", "ukr_Cyrl");
    m.insert("am", "amh_Ethi"); m.insert("ha", "hau_Latn"); m.insert("ku", "ckb_Arab");
    m.insert("ps", "pbt_Arab"); m.insert("so", "som_Latn"); m.insert("ta", "tam_Taml");
    m.insert("fa", "pes_Arab"); m.insert("km", "khm_Khmr"); m.insert("la", "lat_Latn");
    m.insert("ig", "ibo_Latn"); m.insert("jw", "jav_Latn"); m.insert("mg", "plt_Latn");
    m.insert("mr", "mar_Deva"); m.insert("my", "mya_Mymr"); m.insert("te", "tel_Telu");
    m.insert("yo", "yor_Latn"); m.insert("zu", "zul_Latn"); m.insert("xh", "xho_Latn");
    m
}

fn resolve_lang(code: &str) -> String {
    lang_map().get(code).map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}_Latn", code))
}

fn load_translator() -> Result<Translator<SpTokenizer>, String> {
    let models_dir = std::env::var("HALT_MODELS_DIR").unwrap_or_else(|_| "models".to_string());
    let model_dir = std::path::Path::new(&models_dir).join("nllb-200-distilled-600M-ct2");

    if !model_dir.is_dir() {
        return Err(format!("NLLB model not found at {}", model_dir.display()));
    }

    let sp_path = model_dir.join("sentencepiece.bpe.model");
    if !sp_path.exists() {
        return Err(format!("SentencePiece model not found at {}", sp_path.display()));
    }

    eprintln!("[halt-nllb] Loading model: {}", model_dir.display());
    let tokenizer = SpTokenizer::from_file(&sp_path, &sp_path)
        .map_err(|e| format!("SPM load: {}", e))?;
    let translator = Translator::with_tokenizer(
        model_dir.to_str().unwrap_or_default(),
        tokenizer,
        &Config::default(),
    ).map_err(|e| format!("Translator: {}", e))?;

    eprintln!("[halt-nllb] Model loaded OK");
    Ok(translator)
}

#[derive(Deserialize)]
struct TranslateRequest {
    text: String,
    source: String,
    target: String,
}

#[derive(Serialize)]
struct TranslateResponse {
    translated: String,
    source_lang: String,
    target_lang: String,
}

async fn health_handler() -> Json<serde_json::Value> {
    let ready = TRANSLATOR.get().is_some();
    Json(serde_json::json!({"ready": ready, "service": "halt-nllb"}))
}

async fn translate_handler(Json(req): Json<TranslateRequest>) -> Json<serde_json::Value> {
    let result = tokio::task::spawn_blocking(move || {
        translate_sync(&req.text, &req.source, &req.target)
    }).await;

    match result {
        Ok(Ok(r)) => Json(serde_json::to_value(r).unwrap_or_default()),
        Ok(Err(e)) => Json(serde_json::json!({"error": e})),
        Err(e) => Json(serde_json::json!({"error": format!("Task: {}", e)})),
    }
}

fn translate_sync(text: &str, source: &str, target: &str) -> Result<TranslateResponse, String> {
    let guard = TRANSLATOR.get().ok_or("Translator not loaded")?;
    let translator = guard.lock().map_err(|e| e.to_string())?;

    let src_tag = resolve_lang(source);
    let tgt_tag = resolve_lang(target);

    let opts = TranslationOptions {
        beam_size: 4,
        ..Default::default()
    };

    // Prepend the source language token to anchor the NLLB encoder
    let anchored_source = format!("{} {}", src_tag, text);
    let sources = vec![anchored_source];
    let target_prefix = vec![vec![tgt_tag.clone()]];

    let results = translator.translate_batch_with_target_prefix(
        &sources, &target_prefix, &opts, None,
    ).map_err(|e| format!("Translation: {}", e))?;

    let translated = results.into_iter()
        .next()
        .map(|(text, _score)| text)
        .unwrap_or_default();

    // Strip the target language tag if it appears at the start
    let cleaned = if translated.starts_with(&tgt_tag) {
        translated[tgt_tag.len()..].trim().to_string()
    } else {
        translated.trim().to_string()
    };

    Ok(TranslateResponse {
        translated: cleaned,
        source_lang: source.to_string(),
        target_lang: target.to_string(),
    })
}

#[tokio::main]
async fn main() {
    let port = std::env::var("HALT_NLLB_PORT").unwrap_or_else(|_| "7781".to_string());
    let addr = format!("0.0.0.0:{}", port);

    match load_translator() {
        Ok(t) => {
            let _ = TRANSLATOR.set(Mutex::new(t));
            eprintln!("[halt-nllb] Ready on {}", addr);
        }
        Err(e) => {
            eprintln!("[halt-nllb] FATAL: {}", e);
            std::process::exit(1);
        }
    }

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/translate", post(translate_handler));

    let listener = tokio::net::TcpListener::bind(&addr).await
        .expect("Failed to bind NLLB server");
    axum::serve(listener, app).await.expect("NLLB server failed");
}
