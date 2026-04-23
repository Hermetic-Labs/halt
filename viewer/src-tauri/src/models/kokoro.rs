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

/// Voice mapping — maps language codes to closest Kokoro voice.
/// Native voices: en=af_heart, es=ef_dora, fr=ff_siwis, ja=jf_alpha,
/// zh=zf_xiaobei, hi=hf_alpha, it=if_sara, pt=pf_dora.
/// All others mapped to their closest linguistic cousin.
pub fn voice_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    // ── Native voices (male where available) ──
    m.insert("en", "am_adam");
    m.insert("es", "em_alex");
    m.insert("fr", "ff_siwis");       // No French male available
    m.insert("ja", "jm_kumo");
    m.insert("zh", "zm_yunjian");
    m.insert("hi", "hm_omega");
    m.insert("it", "im_nicola");
    m.insert("pt", "pm_alex");
    // ── CJK / Tonal → Chinese male ──
    m.insert("ko", "zm_yunjian");
    m.insert("th", "zm_yunjian");
    m.insert("vi", "zm_yunjian");
    m.insert("km", "zm_yunjian");
    m.insert("my", "zm_yunjian");
    // ── Arabic script / Middle Eastern → Hindi male (Indo-Iranian cousin) ──
    m.insert("ar", "hm_omega");
    m.insert("ur", "hm_omega");        // Urdu IS Hindi, just Arabic script
    m.insert("fa", "hm_omega");        // Persian — Indo-Iranian
    m.insert("ps", "hm_omega");        // Pashto — Indo-Iranian
    m.insert("ku", "hm_omega");        // Kurdish — Indo-Iranian
    m.insert("he", "hm_omega");        // Hebrew — Semitic, best available
    // ── Indic languages → Hindi male ──
    m.insert("bn", "hm_omega");        // Bengali
    m.insert("mr", "hm_omega");        // Marathi
    m.insert("ta", "hm_omega");        // Tamil
    m.insert("te", "hm_omega");        // Telugu
    // ── Romance cousins ──
    m.insert("la", "im_nicola");       // Latin → Italian
    m.insert("tl", "em_alex");         // Tagalog → Spanish (colonial)
    // ── Germanic → British male ──
    m.insert("de", "bm_george");
    m.insert("nl", "bm_george");
    // ── Slavic → British male (closest stress-timed European) ──
    m.insert("ru", "bm_george");
    m.insert("uk", "bm_george");
    m.insert("pl", "bm_george");
    // ── Turkic → Italian male (vowel harmony) ──
    m.insert("tr", "im_nicola");
    // ── African ──
    m.insert("sw", "am_adam");         // Swahili → American male
    m.insert("ha", "am_adam");         // Hausa
    m.insert("ig", "am_adam");         // Igbo
    m.insert("yo", "am_adam");         // Yoruba
    m.insert("zu", "am_adam");         // Zulu
    m.insert("xh", "am_adam");         // Xhosa
    m.insert("am", "hm_omega");       // Amharic → Hindi male (Semitic cousin)
    m.insert("so", "hm_omega");       // Somali → Hindi male (Afro-Asiatic)
    m.insert("mg", "ff_siwis");       // Malagasy → French (Francophone)
    // ── Indonesian/Malay → Spanish male (syllable-timed) ──
    m.insert("id", "em_alex");
    m.insert("jw", "em_alex");         // Javanese
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
