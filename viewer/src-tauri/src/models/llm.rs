//! LLM singleton — lazy-loaded GGUF model via llama.cpp.
//!
//! Direct translation of the model loading in `api/routes/inference.py`.
//! The model is loaded on first inference request and held in memory.
//! Uses llama-cpp-2 crate which wraps llama.cpp natively.

use crate::config;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(feature = "native_ml")]
use llama_cpp_2::llama_backend::LlamaBackend as Backend;
#[cfg(feature = "native_ml")]
use llama_cpp_2::model::params::LlamaModelParams;
#[cfg(feature = "native_ml")]
use llama_cpp_2::model::LlamaModel;

pub static MODEL_LOADING: AtomicBool = AtomicBool::new(false);

// ── Model State ─────────────────────────────────────────────────────────────

static LLM_STATE: Mutex<Option<LlmState>> = Mutex::new(None);

struct LlmState {
    model_path: PathBuf,
    model_id: String,
    loaded: bool,
    #[cfg(feature = "native_ml")]
    model: std::sync::Arc<LlamaModel>,
}

#[cfg(feature = "native_ml")]
pub static LLAMA_BACKEND: std::sync::OnceLock<Backend> = std::sync::OnceLock::new();

/// Find a .gguf file matching the prefix (e.g. "medgemma" or "arliai").
fn find_gguf(prefix: &str) -> Option<PathBuf> {
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
                !name.contains("mmproj") && !name.contains("clip") && name.contains(prefix)
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
pub fn ensure_loaded(requested_model_id: &str) -> Result<PathBuf, String> {
    let mut guard = LLM_STATE.lock().map_err(|e| e.to_string())?;

    if let Some(ref state) = *guard {
        if state.loaded && state.model_id == requested_model_id {
            return Ok(state.model_path.clone());
        }
    }

    MODEL_LOADING.store(true, Ordering::SeqCst);

    // If a DIFFERENT model is loaded, drop it to save RAM.
    if guard.is_some() {
        log::info!("Lazy Swap: Unloading previous model to save memory...");
        *guard = None;
    }

    let prefix = if requested_model_id == "arliai" { "arliai" } else { "medgemma" };
    
    // Attempt to find the model. If it fails, restore MODEL_LOADING so we don't lock forever.
    let model_path_opt = find_gguf(prefix);
    if model_path_opt.is_none() {
        MODEL_LOADING.store(false, Ordering::SeqCst);
        return Err(format!("No GGUF model found matching prefix '{}'", prefix));
    }
    let model_path = model_path_opt.unwrap();
    log::info!("Loading LLM model: {}", model_path.display());

    #[cfg(feature = "native_ml")]
    let model = {
        let backend = LLAMA_BACKEND.get_or_init(|| {
            Backend::init().unwrap_or_else(|e| panic!("Llama backend error: {}", e))
        });
        
        let params = LlamaModelParams::default();
        let m_res = LlamaModel::load_from_file(backend, &model_path, &params);
        
        match m_res {
            Ok(m) => std::sync::Arc::new(m),
            Err(e) => {
                MODEL_LOADING.store(false, Ordering::SeqCst);
                return Err(format!("Llama load error: {}", e));
            }
        }
    };

    *guard = Some(LlmState {
        model_path: model_path.clone(),
        model_id: requested_model_id.to_string(),
        loaded: true,
        #[cfg(feature = "native_ml")]
        model,
    });

    MODEL_LOADING.store(false, Ordering::SeqCst);
    log::info!("LLM model loaded successfully");
    Ok(model_path)
}

/// Check if ANY LLM is loaded.
pub fn is_loaded() -> bool {
    LLM_STATE
        .lock()
        .map(|g| g.as_ref().map(|s| s.loaded).unwrap_or(false))
        .unwrap_or(false)
}

/// Get the currently active model ID.
pub fn active_model_id() -> String {
    LLM_STATE
        .lock()
        .map(|g| g.as_ref().map(|s| s.model_id.clone()).unwrap_or_default())
        .unwrap_or_default()
}

#[cfg(feature = "native_ml")]
pub fn get_model() -> Result<std::sync::Arc<LlamaModel>, String> {
    let guard = LLM_STATE.lock().map_err(|e| e.to_string())?;
    let state = guard.as_ref().ok_or("LLM model not loaded")?;
    Ok(state.model.clone())
}

#[cfg(feature = "native_ml")]
pub fn with_model<F, R>(requested_model_id: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&std::sync::Arc<LlamaModel>) -> R,
{
    ensure_loaded(requested_model_id)?;
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
