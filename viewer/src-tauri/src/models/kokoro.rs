//! Kokoro singleton — lazy-loaded TTS via ONNX Runtime.
//!
//! Direct translation of `kokoro_onnx.Kokoro` from Python.
//! Uses the `ort` crate (ONNX Runtime for Rust).
//!
//! The Kokoro model consists of:
//!   - `kokoro-v1.0.onnx` — The TTS model
//!   - `voices-v1.0.bin` — Voice embeddings (NPZ: per-voice [510, 1, 256] f32)
//!
//! Style vector selection (from Python source):
//!   voice_array = voices[voice_name]     # shape (510, 1, 256)
//!   style = voice_array[len(tokens)]     # index by token count → shape (1, 256)

use crate::config;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(feature = "native_ml")]
use ort::session::Session;

static KOKORO_STATE: Mutex<Option<KokoroState>> = Mutex::new(None);

struct KokoroState {
    model_path: PathBuf,
    voices_path: PathBuf,
    loaded: bool,
    #[cfg(feature = "native_ml")]
    session: std::sync::Arc<std::sync::Mutex<Session>>,
    /// Parsed voice embeddings: voice_name → flat Vec<f32> of shape (510, 1, 256) = 130560 floats
    #[cfg(feature = "native_ml")]
    voice_data: HashMap<String, Vec<f32>>,
}

/// Voice mapping — direct translation of LANG_VOICE_MAP from tts.py.
/// Maps language codes to Kokoro voice IDs.
pub fn voice_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("en", "af_heart");
    m.insert("es", "ef_dora");
    m.insert("fr", "ff_siwis");
    m.insert("ja", "jf_alpha");
    m.insert("ko", "af_heart"); // fallback
    m.insert("zh", "zf_xiaobei");
    m.insert("hi", "hf_alpha");
    m.insert("it", "if_sara");
    m.insert("pt", "pf_dora");
    m.insert("de", "af_heart"); // fallback
    m.insert("ar", "af_heart"); // fallback
    m.insert("ru", "af_heart"); // fallback
    m
}

/// Parse a .npy file from raw bytes, returning the f32 data.
/// NPY format: 6-byte magic + 2-byte version + 2-byte header_len + ASCII header + data
#[cfg(feature = "native_ml")]
fn parse_npy_f32(data: &[u8]) -> Result<Vec<f32>, String> {
    if data.len() < 10 || &data[0..6] != b"\x93NUMPY" {
        return Err("Not a valid .npy file".into());
    }
    let header_len = u16::from_le_bytes([data[8], data[9]]) as usize;
    let data_start = 10 + header_len;
    if data_start > data.len() {
        return Err("NPY header exceeds file size".into());
    }
    let raw = &data[data_start..];
    // Each float is 4 bytes
    let floats: Vec<f32> = raw
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    Ok(floats)
}

/// Parse voices-v1.0.bin (NPZ = zip of .npy files).
/// Returns HashMap<voice_name, Vec<f32>> where each Vec is (510*1*256) = 130560 floats.
#[cfg(feature = "native_ml")]
fn parse_voices_npz(path: &std::path::Path) -> Result<HashMap<String, Vec<f32>>, String> {
    use std::io::Read;

    let file = std::fs::File::open(path)
        .map_err(|e| format!("Cannot open voices file: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Cannot parse voices NPZ: {}", e))?;

    let mut voices = HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("NPZ entry error: {}", e))?;
        let name = entry.name().to_string();
        // Each entry is "voice_name.npy"
        let voice_name = name.trim_end_matches(".npy").to_string();

        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)
            .map_err(|e| format!("NPZ read error: {}", e))?;

        match parse_npy_f32(&buf) {
            Ok(floats) => {
                voices.insert(voice_name, floats);
            }
            Err(e) => {
                log::warn!("Skipping voice '{}': {}", name, e);
            }
        }
    }
    log::info!("Parsed {} voices from {}", voices.len(), path.display());
    Ok(voices)
}

pub fn ensure_loaded() -> Result<(PathBuf, PathBuf), String> {
    let mut guard = KOKORO_STATE.lock().map_err(|e| e.to_string())?;

    if let Some(ref state) = *guard {
        if state.loaded {
            return Ok((state.model_path.clone(), state.voices_path.clone()));
        }
    }

    let models_dir = config::models_dir();
    let model_path = models_dir.join("kokoro-v1.0.onnx");
    let voices_path = models_dir.join("voices-v1.0.bin");

    if !model_path.exists() {
        return Err("Kokoro ONNX model not found".to_string());
    }
    if !voices_path.exists() {
        return Err("Kokoro voices file not found".to_string());
    }

    log::info!("Loading Kokoro TTS model: {}", model_path.display());

    #[cfg(feature = "native_ml")]
    let (session, voice_data) = {
        let _ = ort::init().with_name("kokoro").commit(); // Ignore if already initialized
        let session = Session::builder()
            .map_err(|e| format!("ORT builder error: {}", e))?
            .commit_from_file(&model_path)
            .map_err(|e| format!("ORT load error: {}", e))?;

        let voice_data = parse_voices_npz(&voices_path)?;

        (std::sync::Arc::new(std::sync::Mutex::new(session)), voice_data)
    };

    *guard = Some(KokoroState {
        model_path: model_path.clone(),
        voices_path: voices_path.clone(),
        loaded: true,
        #[cfg(feature = "native_ml")]
        session,
        #[cfg(feature = "native_ml")]
        voice_data,
    });

    log::info!("Kokoro TTS model loaded successfully");
    Ok((model_path, voices_path))
}

pub fn is_loaded() -> bool {
    KOKORO_STATE
        .lock()
        .map(|g| g.as_ref().map(|s| s.loaded).unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(feature = "native_ml")]
pub fn get_session() -> Result<std::sync::Arc<std::sync::Mutex<Session>>, String> {
    let guard = KOKORO_STATE.lock().map_err(|e| e.to_string())?;
    let state = guard.as_ref().ok_or("Kokoro model not loaded")?;
    Ok(state.session.clone())
}

/// Extract the style vector for a given voice and token count.
/// Matches Python: `style = voice_array[len(tokens)]` → shape [1, 256]
///
/// voice_array is (510, 1, 256) stored flat as 130560 floats.
/// Index = min(token_count, 509) * 256
#[cfg(feature = "native_ml")]
pub fn get_voice_style(voice_name: &str, token_count: usize) -> Result<Vec<f32>, String> {
    let guard = KOKORO_STATE.lock().map_err(|e| e.to_string())?;
    let state = guard.as_ref().ok_or("Kokoro model not loaded")?;

    let voice_data = state.voice_data.get(voice_name)
        .ok_or_else(|| format!("Voice '{}' not found. Available: {:?}",
            voice_name,
            state.voice_data.keys().take(5).collect::<Vec<_>>()
        ))?;

    // voice_data is flat (510 * 1 * 256) = 130560 floats
    // Index by token_count, clamped to max 509
    let idx = token_count.min(509);
    let start = idx * 256;
    let end = start + 256;

    if end > voice_data.len() {
        return Err(format!("Voice data too short: {} floats, need index {}", voice_data.len(), end));
    }

    Ok(voice_data[start..end].to_vec())
}

/// Get list of available voice names.
#[cfg(feature = "native_ml")]
pub fn available_voices() -> Vec<String> {
    KOKORO_STATE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.voice_data.keys().cloned().collect()))
        .unwrap_or_default()
}
