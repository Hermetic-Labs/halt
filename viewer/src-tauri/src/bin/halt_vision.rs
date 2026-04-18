//! halt-vision — standalone vision embedding server.
//!
//! Runs as a separate release-compiled process to avoid /GS stack cookie
//! crashes in debug builds. Loads the mmproj + LLM model, exposes /health
//! and /embed endpoints on port 7782.
//! The main halt-triage process calls this for image → embedding conversion.

use axum::{routing::{get, post}, Json, Router, extract::DefaultBodyLimit};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, OnceLock};

use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::mtmd::{MtmdContext, MtmdContextParams, MtmdBitmap, MtmdInputText};

static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();

struct VisionState {
    model: Arc<LlamaModel>,
    mtmd: MtmdContext,
}

static VISION: OnceLock<Mutex<VisionState>> = OnceLock::new();

fn get_or_load() -> Result<(), String> {
    if VISION.get().is_some() {
        return Ok(());
    }

    let models_dir = std::env::var("HALT_MODELS_DIR")
        .unwrap_or_else(|_| "models".to_string());
    let dir = std::path::Path::new(&models_dir);

    // Find gguf model
    let gguf = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read MODELS_DIR: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.extension().map(|e| e == "gguf").unwrap_or(false)
                && !p.file_name().unwrap().to_str().unwrap().contains("mmproj")
        })
        .ok_or("No GGUF model found")?;

    // Find mmproj
    let mmproj = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read MODELS_DIR: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.contains("mmproj") && n.ends_with(".gguf"))
                .unwrap_or(false)
        })
        .ok_or("No mmproj model found")?;

    eprintln!("[halt-vision] Loading LLM: {}", gguf.display());
    let backend = BACKEND.get_or_init(|| LlamaBackend::init().expect("Backend init"));
    let params = LlamaModelParams::default();
    let model = LlamaModel::load_from_file(backend, &gguf, &params)
        .map_err(|e| format!("LLM load: {e}"))?;
    let model = Arc::new(model);

    eprintln!("[halt-vision] Loading mmproj: {}", mmproj.display());
    let mmproj_str = mmproj.to_str().ok_or("Invalid mmproj path")?;
    let mtmd_params = MtmdContextParams {
        use_gpu: true,
        ..Default::default()
    };
    let mtmd = MtmdContext::init_from_file(mmproj_str, &model, &mtmd_params)
        .map_err(|e| format!("MTMD init: {e}"))?;

    eprintln!("[halt-vision] Vision loaded (supports_vision={})", mtmd.support_vision());

    let _ = VISION.set(Mutex::new(VisionState { model, mtmd }));
    Ok(())
}

async fn health_handler() -> Json<serde_json::Value> {
    let ready = VISION.get().is_some();
    Json(serde_json::json!({"ready": ready, "service": "halt-vision"}))
}

#[derive(Deserialize)]
struct EmbedRequest {
    prompt: String,
    image_base64: String,
}

use tokio::sync::mpsc;

#[derive(Serialize)]
struct EmbedResponse {
    n_past: i32,
    text: String,
}

async fn embed_handler(Json(req): Json<EmbedRequest>) -> Json<serde_json::Value> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Option<String>>();

    let _result = tokio::task::spawn_blocking(move || {
        let _ = run_vision_inference(&req.prompt, &req.image_base64, tx);
    });

    let mut full_text = String::new();
    while let Some(msg) = rx.recv().await {
        if let Some(piece) = msg {
            full_text.push_str(&piece);
        } else {
            break;
        }
    }

    Json(serde_json::json!({
        "n_past": 0,
        "text": full_text
    }))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let data = if input.starts_with("data:image") {
        input.split(',').last().unwrap_or(input)
    } else {
        input
    };

    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0;

    for c in data.chars() {
        if c == '=' || c.is_whitespace() { continue; }
        let val = chars.find(c).ok_or("Invalid base64")? as u32;
        buffer = (buffer << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            result.push((buffer >> bits) as u8);
        }
    }
    Ok(result)
}

fn run_vision_inference(prompt: &str, image_base64: &str, tx: mpsc::UnboundedSender<Option<String>>) -> Result<(), String> {
    let guard = VISION.get().ok_or("Vision not loaded")?;
    let state = guard.lock().map_err(|e| format!("Lock: {e}"))?;

    let img_bytes = decode_base64(image_base64)?;

    // Create LLM context for this request
    let backend = BACKEND.get().ok_or("Backend not initialized")?;
    let ctx_params = LlamaContextParams::default();
    let mut llama_ctx = state.model
        .new_context(backend, ctx_params)
        .map_err(|e| format!("Context create: {e}"))?;

    // Decode image
    let bitmap = MtmdBitmap::from_buffer(&state.mtmd, &img_bytes)
        .map_err(|e| format!("Bitmap decode: {e:?}"))?;

    // Build prompt
    let combined = format!("Here is the patient's image: <__media__>\n{}", prompt);
    let input_text = MtmdInputText {
        text: combined,
        add_special: true,
        parse_special: true,
    };

    // Tokenize
    let chunks = state.mtmd.tokenize(input_text, &[&bitmap])
        .map_err(|e| format!("Tokenize: {e:?}"))?;

    // Eval into KV cache
    let mut n_cur = chunks.eval_chunks(
        &state.mtmd,
        &llama_ctx,
        0,    // n_past
        0,    // seq_id
        512,  // n_batch
        true, // logits_last
    ).map_err(|e| format!("Eval: {e:?}"))?;

    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(512, 1);
    let max_tokens = 512;
    
    while n_cur <= max_tokens {
        let mut sampler = llama_cpp_2::sampling::LlamaSampler::greedy();
        let new_token_id = sampler.sample(&llama_ctx, -1);
        
        if new_token_id == state.model.token_eos() {
            break;
        }

        if let Ok(piece) = state.model.token_to_piece(new_token_id, &mut decoder, true, None) {
            let trimmed = piece.trim();
            if trimmed == "<|eot_id|>" || trimmed == "<end_of_turn>" || trimmed == "</s>" || trimmed == "<eos>" {
                break;
            }
            if !piece.is_empty() && (piece.contains("<|eot_id|>") || piece.contains("<end_of_turn>")) {
                break;
            }
            let _ = tx.send(Some(piece)); // Send dynamically
        }

        batch.clear();
        batch.add(new_token_id, n_cur, &[0], true).unwrap();
        llama_ctx.decode(&mut batch).map_err(|e| format!("Ctx error: {}", e))?;
        n_cur += 1;
    }

    let _ = tx.send(None);
    Ok(())
}

#[tokio::main]
async fn main() {
    let port = std::env::var("HALT_VISION_PORT").unwrap_or_else(|_| "7782".to_string());
    let addr = format!("0.0.0.0:{}", port);

    match get_or_load() {
        Ok(_) => eprintln!("[halt-vision] Ready on {}", addr),
        Err(e) => {
            eprintln!("[halt-vision] FATAL: {}", e);
            std::process::exit(1);
        }
    }

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/embed", post(embed_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)); // 50MB images

    let listener = tokio::net::TcpListener::bind(&addr).await
        .expect("Failed to bind vision server");
    axum::serve(listener, app).await.expect("Vision server failed");
}
