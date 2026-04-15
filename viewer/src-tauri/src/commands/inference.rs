//! Inference — LLM chat completion with streaming.
//!
//! Direct translation of `api/routes/inference.py`.
//!
//! Supports both one-shot and streaming responses via Tauri events.
//! Queue system: one inference at a time (matches Python's asyncio.Lock).

use crate::models::llm;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

static INFERENCE_BUSY: AtomicBool = AtomicBool::new(false);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
pub struct InferenceRequest {
    pub prompt: String,
    #[serde(default)]
    pub system: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub persona: String,
    #[serde(default)]
    pub stream: bool,
}

fn default_max_tokens() -> u32 {
    2048
}
fn default_temperature() -> f32 {
    0.7
}

#[derive(Debug, Serialize)]
pub struct InferenceResponse {
    pub text: String,
    pub tokens_generated: u32,
    pub model: String,
}

/// Build the full prompt with system/persona injection.
fn build_prompt(req: &InferenceRequest) -> String {
    let system = if !req.system.is_empty() {
        req.system.clone()
    } else if !req.persona.is_empty() {
        match req.persona.as_str() {
            "medic" => "You are an experienced combat medic assistant. Provide clear, \
                        evidence-based medical guidance for field triage situations. \
                        Be concise and prioritize life-saving actions."
                .to_string(),
            "translator" => "You are a medical translation assistant. Accurately translate \
                           medical terminology while preserving clinical meaning."
                .to_string(),
            _ => String::new(),
        }
    } else {
        String::new()
    };

    if system.is_empty() {
        req.prompt.clone()
    } else {
        format!(
            "[INST] <<SYS>>\n{}\n<</SYS>>\n\n{} [/INST]",
            system, req.prompt
        )
    }
}

#[tauri::command]
pub fn list_models() -> Value {
    let model_path = llm::ensure_loaded().ok();
    let model_name = model_path
        .as_ref()
        .and_then(|p: &std::path::PathBuf| p.file_name())
        .and_then(|n: &std::ffi::OsStr| n.to_str())
        .unwrap_or("none");

    serde_json::json!({
        "models": [{
            "id": model_name,
            "loaded": llm::is_loaded(),
        }]
    })
}

#[tauri::command]
pub fn inference_queue_status() -> Value {
    serde_json::json!({
        "busy": INFERENCE_BUSY.load(Ordering::Relaxed),
        "model_loaded": llm::is_loaded(),
    })
}

/// Stop a running inference.
#[tauri::command]
pub fn inference_stop() -> Value {
    STOP_REQUESTED.store(true, Ordering::SeqCst);
    log::info!("Inference stop requested");
    serde_json::json!({ "stopped": true })
}

/// One-shot inference (non-streaming).
#[tauri::command]
pub fn inference_complete(request: InferenceRequest) -> Result<InferenceResponse, String> {
    if INFERENCE_BUSY.swap(true, Ordering::SeqCst) {
        return Err("Inference engine is busy. Please wait.".to_string());
    }
    STOP_REQUESTED.store(false, Ordering::SeqCst);

    let result = (|| {
        let model_path = llm::ensure_loaded()?;
        let full_prompt = build_prompt(&request);

        let model_name = model_path
            .file_name()
            .and_then(|n: &std::ffi::OsStr| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let m = llm::get_model()?;
        let backend = llm::LLAMA_BACKEND.get().ok_or("Llama Backend missing")?;
        let mut ctx_params = llama_cpp_2::context::params::LlamaContextParams::default();
        ctx_params = ctx_params.with_n_ctx(Some(std::num::NonZeroU32::new(8192).unwrap()));
        let mut ctx = m
            .new_context(backend, ctx_params)
            .map_err(|e| format!("Ctx err: {}", e))?;

        let tokens_list = m
            .str_to_token(&full_prompt, llama_cpp_2::model::AddBos::Always)
            .map_err(|e| format!("Tokenize err: {}", e))?;

        let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
        let last_index = tokens_list.len() - 1;
        for (i, token) in tokens_list.into_iter().enumerate() {
            let is_last = i == last_index;
            batch.add(token, i as i32, &[0], is_last).unwrap();
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Decode err: {}", e))?;

        let mut n_cur = batch.n_tokens();
        let mut result_text = String::new();
        let mut decoder = encoding_rs::UTF_8.new_decoder();

        while n_cur <= request.max_tokens as i32 {
            if STOP_REQUESTED.load(Ordering::Relaxed) {
                log::info!("Inference stopped by user");
                break;
            }
            let mut sampler = llama_cpp_2::sampling::LlamaSampler::greedy();
            let new_token_id = sampler.sample(&ctx, batch.n_tokens() - 1);

            if new_token_id == m.token_eos() {
                break;
            }

            if let Ok(piece) = m.token_to_piece(new_token_id, &mut decoder, true, None) {
                result_text.push_str(&piece);
            }

            batch.clear();
            batch.add(new_token_id, n_cur, &[0], true).unwrap();
            ctx.decode(&mut batch)
                .map_err(|e| format!("Ctx error: {}", e))?;
            n_cur += 1;
        }

        Ok(InferenceResponse {
            text: result_text,
            tokens_generated: n_cur as u32,
            model: model_name,
        })
    })();

    INFERENCE_BUSY.store(false, Ordering::SeqCst);
    result
}

/// Streaming inference via Tauri events.
/// The frontend listens with `listen('inference-token', callback)`.
#[tauri::command]
pub async fn inference_stream(
    app: tauri::AppHandle,
    request: InferenceRequest,
) -> Result<Value, String> {
    use tauri::Emitter;

    if INFERENCE_BUSY.swap(true, Ordering::SeqCst) {
        return Err("Inference engine is busy".to_string());
    }
    STOP_REQUESTED.store(false, Ordering::SeqCst);

    let model_path = llm::ensure_loaded()?;
    let full_prompt = build_prompt(&request);
    let model_name = model_path
        .file_name()
        .and_then(|n: &std::ffi::OsStr| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let m = llm::get_model()?;
    let backend = llm::LLAMA_BACKEND.get().ok_or("Llama Backend missing")?;
    let mut ctx_params = llama_cpp_2::context::params::LlamaContextParams::default();
    ctx_params = ctx_params.with_n_ctx(Some(std::num::NonZeroU32::new(8192).unwrap()));
    let mut ctx = m
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Ctx error: {}", e))?;

    let tokens_list = m
        .str_to_token(&full_prompt, llama_cpp_2::model::AddBos::Always)
        .map_err(|e| format!("Tokenize err: {}", e))?;

    let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
    let last_index = tokens_list.len() - 1;
    for (i, token) in tokens_list.into_iter().enumerate() {
        let is_last = i == last_index;
        batch.add(token, i as i32, &[0], is_last).unwrap();
    }
    ctx.decode(&mut batch)
        .map_err(|e| format!("Decode err: {}", e))?;

    let mut n_cur = batch.n_tokens();
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    while n_cur <= request.max_tokens as i32 {
        if STOP_REQUESTED.load(Ordering::Relaxed) {
            log::info!("Streaming inference stopped by user");
            break;
        }
        let mut sampler = llama_cpp_2::sampling::LlamaSampler::greedy();
        let new_token_id = sampler.sample(&ctx, batch.n_tokens() - 1);

        if new_token_id == m.token_eos() {
            break;
        }

        if let Ok(piece) = m.token_to_piece(new_token_id, &mut decoder, true, None) {
            let _ = app.emit("inference-token", serde_json::json!({"token": piece}));
        }

        batch.clear();
        batch.add(new_token_id, n_cur, &[0], true).unwrap();
        ctx.decode(&mut batch)
            .map_err(|e| format!("Ctx error: {}", e))?;
        n_cur += 1;
    }

    let _ = app.emit(
        "inference-token",
        serde_json::json!({
            "token": "",
            "done": true,
            "model": model_name,
        }),
    );

    INFERENCE_BUSY.store(false, Ordering::SeqCst);

    Ok(serde_json::json!({
        "status": "complete",
        "model": model_name,
    }))
}
