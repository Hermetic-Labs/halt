// =============================================================================
// Native Multimodal Vision — Startup-Loaded (Same as LLM)
// =============================================================================
// Loaded at startup in the warmup sequence on the main thread (32MB stack).
// By inference time the context is ready — no lazy init, no thread tricks.
// =============================================================================

use std::sync::Mutex;
use std::path::Path;
use once_cell::sync::Lazy;

use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::mtmd::{
    MtmdContext, MtmdContextParams, MtmdBitmap, MtmdInputText,
};

// =============================================================================
// Global State
// =============================================================================

static VISION_LOADED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
static MTMD_INSTANCE: Lazy<Mutex<Option<MtmdContext>>> = Lazy::new(|| Mutex::new(None));

// =============================================================================
// Startup Initialization (called from lib.rs warmup)
// =============================================================================

/// Load the vision projection model on the main thread at startup.
/// Runs on the same 32MB stack that successfully loads the LLM tensors.
pub fn load_vision_native(mmproj: &Path, text_model: &LlamaModel) -> Result<(), String> {
    let mut loaded = VISION_LOADED.lock().unwrap();
    if *loaded {
        return Ok(());
    }

    log::info!("[vision] Loading mmproj: {} ({} MB)",
        mmproj.display(),
        std::fs::metadata(mmproj).map(|m| m.len() / 1_048_576).unwrap_or(0)
    );

    let path_str = mmproj.to_str().ok_or("Invalid vision model path")?;

    let params = MtmdContextParams {
        use_gpu: true,
        ..Default::default()
    };

    let ctx = MtmdContext::init_from_file(path_str, text_model, &params)
        .map_err(|e| {
            log::error!("[vision] init_from_file failed: {e}");
            format!("MTMD init error: {e}")
        })?;

    log::info!("[vision] Loaded (supports_vision={})", ctx.support_vision());

    let mut instance = MTMD_INSTANCE.lock().unwrap();
    *instance = Some(ctx);
    *loaded = true;

    Ok(())
}

/// Check if vision is ready for inference.
pub fn is_loaded() -> bool {
    *VISION_LOADED.lock().unwrap()
}

// =============================================================================
// Inference API
// =============================================================================

/// Decode a base64 image payload into raw bytes.
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
        if c == '=' || c.is_whitespace() { break; }
        let val = chars.find(c).ok_or("Invalid base64 payload in vision stream")? as u32;
        buffer = (buffer << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            result.push((buffer >> bits) as u8);
        }
    }
    Ok(result)
}

/// Run multimodal inference. Vision context must already be loaded at startup.
pub fn infer_with_vision(
    llama_ctx: &LlamaContext,
    _text_model: &LlamaModel,
    n_past: i32,
    n_batch: i32,
    prompt: &str,
    base64_image: &str,
) -> Result<i32, String> {
    if !is_loaded() {
        return Err("Vision engine not loaded — check startup logs".into());
    }

    let img_bytes = decode_base64(base64_image)?;

    let ctx_guard = MTMD_INSTANCE.lock().unwrap();
    let mtmd_ctx = ctx_guard.as_ref().ok_or("MTMD instance lost")?;

    // 1. Decode image bytes into bitmap
    let bitmap = MtmdBitmap::from_buffer(mtmd_ctx, &img_bytes)
        .map_err(|e| format!("Failed to decode image: {e:?}"))?;

    // 2. Build interleaved text+media prompt
    let combined_prompt = format!("Here is the patient's image: <__media__>\n{}", prompt);
    let input_text = MtmdInputText {
        text: combined_prompt,
        add_special: true,
        parse_special: true,
    };

    // 3. Tokenize chunks
    let chunks = mtmd_ctx.tokenize(input_text, &[&bitmap])
        .map_err(|e| format!("MTMD tokenization error: {e:?}"))?;

    // 4. Evaluate all chunks into KV cache
    let new_n_past = chunks.eval_chunks(
        mtmd_ctx,
        llama_ctx,
        n_past,
        0,       // seq_id
        n_batch,
        true,    // logits_last
    ).map_err(|e| format!("MTMD eval error: {e:?}"))?;

    Ok(new_n_past)
}
