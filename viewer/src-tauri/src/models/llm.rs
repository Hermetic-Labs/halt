//! LLM singleton — lazy-loaded GGUF model via llama.cpp.
//!
//! Direct translation of the model loading in `api/routes/inference.py`.
//! The model is loaded on first inference request and held in memory.
//! Uses llama-cpp-2 crate which wraps llama.cpp natively.

use crate::config;
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(feature = "native_ml")]
use llama_cpp_2::llama_backend::LlamaBackend as Backend;
#[cfg(feature = "native_ml")]
use llama_cpp_2::model::params::LlamaModelParams;
#[cfg(feature = "native_ml")]
use llama_cpp_2::model::LlamaModel;

// ── Model State ─────────────────────────────────────────────────────────────

static LLM_STATE: Mutex<Option<LlmState>> = Mutex::new(None);

struct LlmState {
    model_path: PathBuf,
    loaded: bool,
    #[cfg(feature = "native_ml")]
    model: std::sync::Arc<LlamaModel>,
}

#[cfg(feature = "native_ml")]
pub static LLAMA_BACKEND: std::sync::OnceLock<Backend> = std::sync::OnceLock::new();

/// Find the first .gguf file in MODELS_DIR (skipping mmproj/clip vision projectors).
fn find_gguf() -> Option<PathBuf> {
    let dir = config::models_dir();
    if !dir.is_dir() {
        return None;
    }
    std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.extension().and_then(|e| e.to_str()) == Some("gguf") && {
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                !name.contains("mmproj") && !name.contains("clip")
            }
        })
}

/// Find the vision mmproj.gguf file.
#[cfg(feature = "native_ml")]
pub fn find_mmproj() -> Option<PathBuf> {
    let dir = config::models_dir();
    if !dir.is_dir() { return None; }
    std::fs::read_dir(&dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path())
        .find(|p| {
            p.extension().and_then(|e| e.to_str()) == Some("gguf") && {
                let name = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                name.contains("mmproj") || name.contains("clip")
            }
        })
}

/// Attempt to load the LLM model. Returns the model path if successful.
pub fn ensure_loaded() -> Result<PathBuf, String> {
    let mut guard = LLM_STATE.lock().map_err(|e| e.to_string())?;

    if let Some(ref state) = *guard {
        if state.loaded {
            return Ok(state.model_path.clone());
        }
    }

    let model_path = find_gguf().ok_or("No GGUF model found in MODELS_DIR")?;
    log::info!("Loading LLM model: {}", model_path.display());

    #[cfg(feature = "native_ml")]
    let model = {
        let backend = LLAMA_BACKEND.get_or_init(|| {
            Backend::init().unwrap_or_else(|e| panic!("Llama backend error: {}", e))
        });
        
        let params = LlamaModelParams::default();
        let m = LlamaModel::load_from_file(backend, &model_path, &params)
            .map_err(|e| format!("Llama load error: {}", e))?;
            
        std::sync::Arc::new(m)
    };

    *guard = Some(LlmState {
        model_path: model_path.clone(),
        loaded: true,
        #[cfg(feature = "native_ml")]
        model,
    });

    log::info!("LLM model loaded successfully");
    Ok(model_path)
}

/// Check if the LLM is loaded.
pub fn is_loaded() -> bool {
    LLM_STATE
        .lock()
        .map(|g| g.as_ref().map(|s| s.loaded).unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(feature = "native_ml")]
pub fn get_model() -> Result<std::sync::Arc<LlamaModel>, String> {
    let guard = LLM_STATE.lock().map_err(|e| e.to_string())?;
    let state = guard.as_ref().ok_or("LLM model not loaded")?;
    Ok(state.model.clone())
}

#[cfg(feature = "native_ml")]
pub fn with_model<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&std::sync::Arc<LlamaModel>) -> R,
{
    let guard = LLM_STATE.lock().map_err(|e| e.to_string())?;
    let state = guard.as_ref().ok_or("LLM model not loaded")?;
    Ok(f(&state.model))
}

/// Unload the model (free memory).
pub fn unload() {
    if let Ok(mut guard) = LLM_STATE.lock() {
        *guard = None;
        log::info!("LLM model unloaded");
    }
}
