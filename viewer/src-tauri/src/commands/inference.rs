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
    #[serde(default)]
    pub image_b64: Option<String>,
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
        format!("<start_of_turn>user\n{}<end_of_turn>\n<start_of_turn>model\n", req.prompt)
    } else {
        format!(
            "<start_of_turn>user\nSYSTEM: {}\n\n{}<end_of_turn>\n<start_of_turn>model\n",
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

        if let Some(ref image_b64) = request.image_b64 {
            if !image_b64.is_empty() {
                log::info!("Routing multimodal inference to sidecar at :7782...");
                let client = reqwest::blocking::Client::builder()
                    .timeout(std::time::Duration::from_secs(120))
                    .build()
                    .unwrap_or_else(|_| reqwest::blocking::Client::new());

                let response = client
                    .post("http://127.0.0.1:7782/embed")
                    .json(&serde_json::json!({
                        "prompt": full_prompt,
                        "image_base64": image_b64
                    }))
                    .send()
                    .map_err(|e| format!("Vision network failed: {}", e))?;

                let json: serde_json::Value = response.json().map_err(|e| format!("Vision JSON parse: {}", e))?;
                
                if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                    return Err(format!("Vision error: {}", err));
                }
                
                let result_text = json["text"].as_str().unwrap_or("").to_string();
                let n_past = json["n_past"].as_i64().unwrap_or(0) as u32;
                
                return Ok(InferenceResponse {
                    text: result_text,
                    tokens_generated: n_past,
                    model: "halt_vision (sidecar)".to_string(),
                });
            }
        }

        let mut n_cur = 0;
        let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
        let mut result_text = String::new();
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let start_time = std::time::Instant::now();

        llm::with_model(|m| {
            let backend = llm::LLAMA_BACKEND.get().ok_or("Llama Backend missing")?;
            let mut ctx_params = llama_cpp_2::context::params::LlamaContextParams::default();
            ctx_params = ctx_params.with_n_ctx(Some(std::num::NonZeroU32::new(8192).unwrap()));
            let mut ctx = m.new_context(backend, ctx_params)
                .map_err(|e| format!("Ctx error: {}", e))?;

            let tokens_list = match m.str_to_token(&full_prompt, llama_cpp_2::model::AddBos::Always) {
                Ok(t) => t,
                Err(e) => return Err(format!("Tokenize err: {}", e)),
            };

            let last_index = tokens_list.len() - 1;
            for (i, token) in tokens_list.into_iter().enumerate() {
                let is_last = i == last_index;
                batch.add(token, n_cur + i as i32, &[0], is_last).unwrap();
            }
            if let Err(e) = ctx.decode(&mut batch) {
                return Err(format!("Decode err: {}", e));
            }

            n_cur += batch.n_tokens();

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
                    let trimmed = piece.trim();
                    if trimmed == "<|eot_id|>" || trimmed == "<end_of_turn>" || trimmed == "</s>" || trimmed == "<eos>" {
                        break;
                    }
                    result_text.push_str(&piece);
                }

                batch.clear();
                batch.add(new_token_id, n_cur, &[0], true).unwrap();
                if let Err(e) = ctx.decode(&mut batch) {
                    return Err(format!("Ctx error: {}", e));
                }
                n_cur += 1;
            }
            Ok(())
        })??;

        let elapsed = start_time.elapsed().as_secs_f32();
        log::info!("[Inference] Finished generation in {:.2}s", elapsed);

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

    if let Some(ref image_b64) = request.image_b64 {
        if !image_b64.is_empty() {
            log::info!("Streaming: Routing multimodal inference to sidecar at :7782...");
            
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());

            let response = client
                .post("http://127.0.0.1:7782/embed")
                .json(&serde_json::json!({
                    "prompt": full_prompt,
                    "image_base64": image_b64
                }))
                .send()
                .await
                .map_err(|e| format!("Vision sidecar network failed: {}", e))?;

            let json: serde_json::Value = response.json().await.map_err(|e| format!("Vision JSON parse: {}", e))?;
            
            if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                INFERENCE_BUSY.store(false, Ordering::SeqCst);
                return Err(format!("Vision error: {}", err));
            }
            
            let result_text = json["text"].as_str().unwrap_or("").to_string();
            
            // Quickly stream it to UI without artificial slow-downs. (True streaming is done on text inference).
            for piece in result_text.split_whitespace() {
                if STOP_REQUESTED.load(Ordering::Relaxed) { break; }
                let _ = app.emit("inference-token", serde_json::json!({"token": format!("{} ", piece)}));
            }
            
            let _ = app.emit("inference-token", serde_json::json!({
                "token": "",
                "done": true,
                "model": "halt_vision (sidecar)",
            }));

            INFERENCE_BUSY.store(false, Ordering::SeqCst);
            return Ok(serde_json::json!({
                "status": "complete",
                "model": "halt_vision (sidecar)",
            }));
        }
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Result<String, String>>();
    let full_prompt_clone = full_prompt.clone();
    let max_tokens = request.max_tokens as i32;

    std::thread::spawn(move || {
        let res = llm::with_model(|m| {
            let backend = llm::LLAMA_BACKEND.get().ok_or("Llama Backend missing")?;
            let mut ctx_params = llama_cpp_2::context::params::LlamaContextParams::default();
            ctx_params = ctx_params.with_n_ctx(Some(std::num::NonZeroU32::new(8192).unwrap()));
            let mut ctx = m.new_context(backend, ctx_params).map_err(|e| format!("Ctx error: {}", e))?;

            let mut n_cur = 0;
            let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
            
            let tokens_list = match m.str_to_token(&full_prompt_clone, llama_cpp_2::model::AddBos::Always) {
                Ok(t) => t,
                Err(e) => { let _ = tx.send(Err(format!("Tokenize err: {}", e))); return Ok(()); }
            };

            let last_index = tokens_list.len() - 1;
            for (i, token) in tokens_list.into_iter().enumerate() {
                let is_last = i == last_index;
                batch.add(token, n_cur + i as i32, &[0], is_last).unwrap();
            }
            if let Err(e) = ctx.decode(&mut batch) {
                let _ = tx.send(Err(format!("Decode err: {}", e))); return Ok(());
            }

            n_cur += batch.n_tokens();

            let mut decoder = encoding_rs::UTF_8.new_decoder();

            while n_cur <= max_tokens {
                if STOP_REQUESTED.load(Ordering::Relaxed) {
                    break;
                }
                let mut sampler = llama_cpp_2::sampling::LlamaSampler::greedy();
                let new_token_id = sampler.sample(&ctx, batch.n_tokens() - 1);

                if new_token_id == m.token_eos() {
                    break;
                }

                if let Ok(piece) = m.token_to_piece(new_token_id, &mut decoder, true, None) {
                    let trimmed = piece.trim();
                    if trimmed == "<|eot_id|>" || trimmed == "<end_of_turn>" || trimmed == "</s>" || trimmed == "<eos>" {
                        break;
                    }
                    if !piece.is_empty() && (piece.contains("<|eot_id|>") || piece.contains("<end_of_turn>")) {
                        break;
                    }
                    if tx.send(Ok(piece)).is_err() {
                        break;
                    }
                }

                batch.clear();
                batch.add(new_token_id, n_cur, &[0], true).unwrap();
                if let Err(e) = ctx.decode(&mut batch) {
                    let _ = tx.send(Err(format!("Ctx error: {}", e))); return Ok(());
                }
                n_cur += 1;
            }
            let _ = tx.send(Ok("".to_string())); // Signal completion
            Ok::<(), String>(())
        });

        if let Err(e) = res {
            log::error!("Inference context lock failed: {}", e);
        }
    });

    let start_time = std::time::Instant::now();
    let mut generated = 0;

    while let Some(res) = rx.recv().await {
        match res {
            Ok(piece) => {
                if piece.is_empty() {
                    break; // Completed
                }
                generated += 1;
                let _ = app.emit("inference-token", serde_json::json!({"token": piece}));
            }
            Err(e) => {
                INFERENCE_BUSY.store(false, Ordering::SeqCst);
                return Err(e);
            }
        }
    }

    let elapsed = start_time.elapsed().as_secs_f32();
    log::info!("[Inference] Streamed {} tokens in {:.2}s ({:.2} tok/s)", generated, elapsed, generated as f32 / elapsed);

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
