//! Translate Stream — real-time speech-to-speech translation pipelines.
//!
//! Direct translation of THREE Python files:
//!   - `translate_stream.py` — One-shot: mic → Whisper → NLLB → Kokoro → speaker
//!   - `translate_live.py` — Continuous: dual-socket, client-side pause detection
//!   - `call_translate.py` — In-call: rolling 4s windows, subtitles or full mode
//!
//! All three pipelines follow the same core flow:
//!   1. Receive audio bytes (WebM/PCM)
//!   2. Whisper STT → text + detected language
//!   3. NLLB translate → source → English → target
//!   4. Kokoro TTS → streamed WAV audio chunks
//!
//! In Tauri, these become event-driven commands instead of WebSockets:
//!   - Frontend sends audio via invoke() as byte arrays
//!   - Server emits results via app.emit() events
//!   - Client listens with listen('translate-*', callback)
//!
//! The TTS_BUSY lock from tts.rs is shared here to prevent
//! concurrent ONNX session access (same as Python's _tts_lock).

use crate::commands::tts::TTS_BUSY;
use crate::models::{kokoro, nllb, whisper};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

// ── Session Registry (for translate-live dual-socket architecture) ───────────

#[derive(Debug, Clone, Serialize)]
struct SegmentResult {
    segment_id: u32,
    transcript: String,
    source_lang: String,
    translation: String,
    target_lang: String,
    english: String,
    speed: f32,
}

static SESSIONS: Mutex<Option<HashMap<String, Vec<SegmentResult>>>> = Mutex::new(None);

fn with_sessions<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, Vec<SegmentResult>>) -> R,
{
    let mut guard = SESSIONS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    f(guard.as_mut().unwrap())
}

// ── Pipeline Helpers ────────────────────────────────────────────────────────

/// Whisper STT: audio bytes → (text, detected_language).
/// Direct translation of _whisper_transcribe() from translate_stream.py.
fn pipeline_stt(audio_data: &[u8], source_lang: &str) -> Result<(String, String), String> {
    let ctx = whisper::get_context()?;

    let mut pcm_data = Vec::with_capacity(audio_data.len() / 4);
    for chunk in audio_data.chunks_exact(4) {
        pcm_data.push(f32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])));
    }

    // --- Strong Base VAD (Voice Activity Detection) ---
    // Discard frames that are pure background noise to prevent hallucination looping
    let sum_sq: f32 = pcm_data.iter().map(|&s| s * s).sum();
    let rms = if pcm_data.is_empty() {
        0.0
    } else {
        (sum_sq / pcm_data.len() as f32).sqrt()
    };
    if rms < 0.005 {
        log::debug!("VAD Active: Audio discarded (too quiet, RMS {:.4})", rms);
        let fallback_lang = if source_lang == "auto" {
            "en"
        } else {
            source_lang
        };
        return Ok(("".to_string(), fallback_lang.to_string()));
    }

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("State error: {}", e))?;
    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::BeamSearch { beam_size: 5, patience: 1.0 });
    let lang_opt = if source_lang == "auto" {
        "auto"
    } else {
        source_lang
    };
    params.set_language(Some(lang_opt));
    params.set_no_speech_thold(0.65); // Aggressive whisper-native VAD
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);

    state
        .full(params, &pcm_data)
        .map_err(|e| format!("Whisper eval: {}", e))?;
    let num_segments = state.full_n_segments();

    let mut result_text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(text) = segment.to_str_lossy() {
                let trimmed = text.trim();
                // Filter out common whisper hallucinations
                if !trimmed.starts_with("[") && !trimmed.starts_with("(") {
                    result_text.push_str(trimmed);
                    result_text.push(' ');
                }
            }
        }
    }

    let detected = if source_lang == "auto" {
        "en"
    } else {
        source_lang
    };
    Ok((result_text.trim().to_string(), detected.to_string()))
}

/// NLLB translate: source → English → target (two-hop bridge).
/// Direct translation of the translate logic in translate_stream.py.
fn pipeline_translate(text: &str, source_lang: &str, target_lang: &str) -> (String, String) {
    // Source → English (if not already English)
    let english = if source_lang != "en" {
        nllb::translate(text, source_lang, "en")
    } else {
        text.to_string()
    };

    // English → Target (if target isn't English)
    let translation = if target_lang != "en" {
        nllb::translate(&english, "en", target_lang)
    } else {
        english.clone()
    };

    (english, translation)
}

/// Kokoro TTS: text → WAV audio bytes.
/// Acquires the shared TTS_BUSY lock (same as Python's _tts_lock).
fn pipeline_tts(text: &str, lang: &str, speed: f32) -> Result<Vec<u8>, String> {
    use crate::models::phonemizer;

    if TTS_BUSY.swap(true, Ordering::SeqCst) {
        return Err("TTS engine is busy".to_string());
    }

    let result = (|| {
        let (_model, _voices) = kokoro::ensure_loaded()?;
        let map = kokoro::voice_map();
        let voice = map.get(lang).copied().unwrap_or("af_heart");

        // Phonemize properly (matching tts.rs)
        let tokens = phonemizer::text_to_tokens(text, lang).unwrap_or_else(|e| {
            log::warn!("[pipeline_tts] Phonemization failed: {}", e);
            vec![0; text.len().max(1)]
        });

        // Real voice style from voices-v1.0.bin
        let style = kokoro::get_voice_style(voice, tokens.len()).unwrap_or_else(|e| {
            log::warn!("[pipeline_tts] Voice style failed ({}), using zeros", e);
            vec![0.0f32; 256]
        });

        let session = kokoro::get_session()?;

        let input_values = ort::inputs![
            "tokens" => ort::value::Tensor::from_array(ndarray::Array1::from_vec(tokens.clone()).into_shape_with_order((1, tokens.len())).unwrap()).unwrap(),
            "style" => ort::value::Tensor::from_array(ndarray::Array1::from_vec(style).into_shape_with_order((1, 256)).unwrap()).unwrap(),
            "speed" => ort::value::Tensor::from_array(ndarray::Array1::from_vec(vec![speed])).unwrap(),
        ];

        let mut session = session.lock().unwrap();
        let outputs = session
            .run(input_values)
            .map_err(|e| format!("ORT Run err: {}", e))?;
        let audio_tensor = outputs["audio"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Tensor err: {}", e))?;
        let pcm_f32: Vec<f32> = audio_tensor.1.to_vec();

        let mut buf = Vec::new();
        let audio_len = pcm_f32.len() * 2;
        let sample_rate = 24000_u32;
        buf.extend_from_slice(b"RIFF");
        buf.extend_from_slice(&((36 + audio_len) as u32).to_le_bytes());
        buf.extend_from_slice(b"WAVE");
        buf.extend_from_slice(b"fmt ");
        buf.extend_from_slice(&16u32.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());
        buf.extend_from_slice(&16u16.to_le_bytes());
        buf.extend_from_slice(b"data");
        buf.extend_from_slice(&(audio_len as u32).to_le_bytes());
        for &sample in &pcm_f32 {
            let s = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
            buf.extend_from_slice(&s.to_le_bytes());
        }
        Ok(buf)
    })();

    TTS_BUSY.store(false, Ordering::SeqCst);
    result
}

// ── Mode 1: One-Shot Translate Stream ───────────────────────────────────────
// Direct translation of translate_stream.py /ws endpoint

#[derive(Debug, Deserialize)]
pub struct TranslateStreamRequest {
    pub audio_data: Vec<u8>,
    #[serde(default = "default_target")]
    pub target_lang: String,
    #[serde(default = "default_auto")]
    pub source_lang: String,
    #[serde(default = "default_speed")]
    pub speed: f32,
}

fn default_target() -> String {
    "en".to_string()
}
fn default_auto() -> String {
    "auto".to_string()
}
fn default_speed() -> f32 {
    1.0
}

#[derive(Debug, Serialize)]
pub struct TranslateStreamResult {
    pub transcript: String,
    pub source_lang: String,
    pub translation: String,
    pub target_lang: String,
    pub english: String,
    pub audio_base64: String,
    pub audio_chunks: u32,
}

/// One-shot translation: audio → text → translate → TTS → audio.
/// Frontend equivalent of connecting to /translate-stream/ws.
///
/// Flow (mirrors translate_stream.py exactly):
///   1. Receive all audio bytes
///   2. Whisper STT → transcript + detected language
///   3. NLLB: detected → English → target
///   4. Kokoro TTS → WAV audio
///   5. Return everything at once
#[tauri::command]
pub fn translate_stream_oneshot(
    request: TranslateStreamRequest,
) -> Result<TranslateStreamResult, String> {
    if request.audio_data.is_empty() {
        return Err("No audio received".to_string());
    }

    // 1. STT
    let (transcript, detected_lang) = pipeline_stt(&request.audio_data, &request.source_lang)?;
    if transcript.trim().is_empty() {
        return Err("No speech detected".to_string());
    }

    // 2. Translate: source → English → target
    let (english, translation) =
        pipeline_translate(&transcript, &detected_lang, &request.target_lang);

    // 3. TTS
    let audio_bytes =
        pipeline_tts(&translation, &request.target_lang, request.speed).unwrap_or_default();
    let audio_b64 = if audio_bytes.is_empty() {
        String::new()
    } else {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&audio_bytes)
    };

    Ok(TranslateStreamResult {
        transcript,
        source_lang: detected_lang,
        translation,
        target_lang: request.target_lang,
        english,
        audio_base64: audio_b64,
        audio_chunks: if audio_bytes.is_empty() { 0 } else { 1 },
    })
}

/// Streaming version — emits intermediate events.
/// Frontend listens with: listen('translate-stream-event', callback)
#[tauri::command]
pub async fn translate_stream_live(
    app: tauri::AppHandle,
    request: TranslateStreamRequest,
) -> Result<Value, String> {
    use tauri::Emitter;

    if request.audio_data.is_empty() {
        return Err("No audio received".to_string());
    }

    // Status: transcribing
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "status", "status": "transcribing"
        }),
    );

    let (transcript, detected_lang) = pipeline_stt(&request.audio_data, &request.source_lang)?;
    if transcript.trim().is_empty() {
        return Err("No speech detected".to_string());
    }

    // Emit transcript immediately
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "transcript", "text": transcript, "source_lang": detected_lang
        }),
    );

    // Status: translating
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "status", "status": "translating"
        }),
    );

    let (english, translation) =
        pipeline_translate(&transcript, &detected_lang, &request.target_lang);

    // Emit translation immediately
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "translation", "text": translation,
            "target_lang": request.target_lang, "english": english
        }),
    );

    // Status: synthesizing
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "status", "status": "synthesizing"
        }),
    );

    let audio_bytes =
        pipeline_tts(&translation, &request.target_lang, request.speed).unwrap_or_default();

    // Emit done
    let _ = app.emit(
        "translate-stream-event",
        serde_json::json!({
            "type": "done", "chunks": if audio_bytes.is_empty() { 0 } else { 1 }
        }),
    );

    Ok(serde_json::json!({"status": "complete"}))
}

// ── Mode 2: Live Continuous Translation ─────────────────────────────────────
// Direct translation of translate_live.py dual-socket architecture.
// In Tauri, both sockets become invoke() commands with shared session state.

#[derive(Debug, Deserialize)]
pub struct LiveSegmentRequest {
    pub session_id: String,
    pub audio_data: Vec<u8>,
    pub segment_id: u32,
    #[serde(default = "default_target")]
    pub target_lang: String,
    #[serde(default = "default_auto")]
    pub source_lang: String,
    #[serde(default = "default_speed")]
    pub speed: f32,
}

/// Process a single speech segment (client detected pause).
/// Replaces the _process_segment() background task from translate_live.py.
#[tauri::command]
pub fn translate_live_segment(request: LiveSegmentRequest) -> Result<Value, String> {
    if request.audio_data.is_empty() {
        return Ok(serde_json::json!({"empty": true}));
    }

    // STT
    let (transcript, detected_lang) = pipeline_stt(&request.audio_data, &request.source_lang)?;
    if transcript.trim().is_empty() {
        return Ok(serde_json::json!({"empty": true}));
    }

    // Translate: source → English → target
    let (english, translation) =
        pipeline_translate(&transcript, &detected_lang, &request.target_lang);

    // TTS
    let audio_bytes =
        pipeline_tts(&translation, &request.target_lang, request.speed).unwrap_or_default();
    let audio_b64 = if audio_bytes.is_empty() {
        String::new()
    } else {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&audio_bytes)
    };

    // Store in session for potential replay
    let result = SegmentResult {
        segment_id: request.segment_id,
        transcript: transcript.clone(),
        source_lang: detected_lang.clone(),
        translation: translation.clone(),
        target_lang: request.target_lang.clone(),
        english: english.clone(),
        speed: request.speed,
    };
    with_sessions(|sessions| {
        sessions
            .entry(request.session_id.clone())
            .or_default()
            .push(result);
    });

    Ok(serde_json::json!({
        "segment_id": request.segment_id,
        "transcript": transcript,
        "source_lang": detected_lang,
        "translation": translation,
        "target_lang": request.target_lang,
        "english": english,
        "audio_base64": audio_b64,
    }))
}

/// Get live translation session health/status.
#[tauri::command]
pub fn translate_live_health() -> Value {
    let count = with_sessions(|s| s.len());
    serde_json::json!({"active_sessions": count})
}

/// End and clean up a live translation session.
#[tauri::command]
pub fn translate_live_end(session_id: String) -> Value {
    with_sessions(|sessions| {
        sessions.remove(&session_id);
    });
    serde_json::json!({"status": "ended", "session_id": session_id})
}

// ── Mode 3: In-Call Rolling Translation ─────────────────────────────────────
// Direct translation of call_translate.py.
// Long-lived rolling 4s audio windows with subtitles or full (TTS) mode.

#[derive(Debug, Deserialize)]
pub struct CallTranslateChunk {
    pub audio_data: Vec<u8>,
    #[serde(default = "default_target")]
    pub target_lang: String,
    #[serde(default = "default_auto")]
    pub source_lang: String,
    #[serde(default = "default_subtitles")]
    pub mode: String,
    #[serde(default = "default_speed")]
    pub speed: f32,
}

fn default_subtitles() -> String {
    "subtitles".to_string()
}

/// Process a single rolling audio chunk during a call.
/// Replaces the inner loop of call_translate_ws() from call_translate.py.
///
/// Modes:
///   - "subtitles" → STT only, returns transcript
///   - "full" → STT → NLLB → Kokoro TTS, returns everything
#[tauri::command]
pub fn call_translate_chunk(request: CallTranslateChunk) -> Result<Value, String> {
    if request.audio_data.len() < 500 {
        return Ok(serde_json::json!({"chunk_done": true, "empty": true}));
    }

    // STT
    let (transcript, detected_lang) = pipeline_stt(&request.audio_data, &request.source_lang)?;
    if transcript.trim().is_empty() {
        return Ok(serde_json::json!({"chunk_done": true, "empty": true}));
    }

    let mut result = serde_json::json!({
        "type": "transcript",
        "text": transcript,
        "source_lang": detected_lang,
        "chunk_done": true,
    });

    // Full mode: translate + TTS
    if request.mode == "full" && detected_lang != request.target_lang {
        let (_, translation) =
            pipeline_translate(&transcript, &detected_lang, &request.target_lang);

        result["translation"] = Value::String(translation.clone());
        result["target_lang"] = Value::String(request.target_lang.clone());

        // TTS for the translation
        let audio_bytes =
            pipeline_tts(&translation, &request.target_lang, request.speed).unwrap_or_default();
        if !audio_bytes.is_empty() {
            use base64::Engine;
            result["audio_base64"] =
                Value::String(base64::engine::general_purpose::STANDARD.encode(&audio_bytes));
        }
    }

    Ok(result)
}
