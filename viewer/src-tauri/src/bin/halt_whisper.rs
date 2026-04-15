//! halt-whisper — standalone Whisper STT server.
//!
//! Runs as a separate process to avoid ggml symbol conflicts with llama.cpp.
//! Listens on port 7780, exposes /health and /listen endpoints.
//! The main halt-triage process spawns this and proxies STT requests.

use axum::{extract::DefaultBodyLimit, routing::{get, post}, Json, Router};
use serde::Serialize;
use std::sync::{Arc, OnceLock};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

static WHISPER_CTX: OnceLock<Arc<WhisperContext>> = OnceLock::new();

fn get_or_load_ctx() -> Result<Arc<WhisperContext>, String> {
    if let Some(ctx) = WHISPER_CTX.get() {
        return Ok(ctx.clone());
    }

    let models_dir = std::env::var("HALT_MODELS_DIR")
        .unwrap_or_else(|_| "models".to_string());
    let dir = std::path::Path::new(&models_dir);

    // Find ggml model
    let candidates = ["ggml-base.bin", "ggml-base.en.bin", "ggml-small.bin", "ggml-tiny.bin"];
    let model_path = candidates.iter()
        .map(|n| dir.join(n))
        .find(|p| p.exists())
        .ok_or_else(|| "No ggml-*.bin found in HALT_MODELS_DIR".to_string())?;

    eprintln!("[halt-whisper] Loading model: {}", model_path.display());
    let params = WhisperContextParameters::default();
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().unwrap_or(""),
        params,
    ).map_err(|e| format!("Whisper load failed: {}", e))?;

    let ctx = Arc::new(ctx);
    let _ = WHISPER_CTX.set(ctx.clone());
    eprintln!("[halt-whisper] Model loaded OK");
    Ok(ctx)
}

#[derive(Serialize)]
struct TranscriptionResult {
    text: String,
    language: String,
    duration_seconds: f32,
}

async fn health_handler() -> Json<serde_json::Value> {
    let ready = WHISPER_CTX.get().is_some();
    Json(serde_json::json!({"ready": ready, "service": "halt-whisper"}))
}

async fn listen_handler(body: axum::body::Bytes) -> Json<serde_json::Value> {
    let result = tokio::task::spawn_blocking(move || {
        transcribe(&body, "en")
    }).await;

    match result {
        Ok(Ok(r)) => Json(serde_json::json!({
            "text": r.text,
            "language": r.language,
            "duration_seconds": r.duration_seconds,
        })),
        Ok(Err(e)) => Json(serde_json::json!({"error": e})),
        Err(e) => Json(serde_json::json!({"error": format!("Task failed: {}", e)})),
    }
}

fn transcribe(audio_data: &[u8], lang: &str) -> Result<TranscriptionResult, String> {
    let ctx = get_or_load_ctx()?;

    // Decode audio to PCM f32 16kHz mono via symphonia
    let pcm_data = decode_audio_to_pcm(audio_data)?;

    // VAD: discard silence
    let sum_sq: f32 = pcm_data.iter().map(|&s| s * s).sum();
    let rms = if pcm_data.is_empty() { 0.0 } else { (sum_sq / pcm_data.len() as f32).sqrt() };
    if rms < 0.005 {
        return Ok(TranscriptionResult {
            text: String::new(),
            language: lang.to_string(),
            duration_seconds: pcm_data.len() as f32 / 16000.0,
        });
    }

    let mut state = ctx.create_state().map_err(|e| format!("State: {}", e))?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: 1.0 });
    params.set_language(Some(lang));
    params.set_no_speech_thold(0.65);
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);

    state.full(params, &pcm_data).map_err(|e| format!("Eval: {}", e))?;

    let mut result_text = String::new();
    for i in 0..state.full_n_segments() {
        if let Some(seg) = state.get_segment(i) {
            if let Ok(text) = seg.to_str_lossy() {
                let trimmed = text.trim();
                if !trimmed.starts_with('[') && !trimmed.starts_with('(') {
                    result_text.push_str(trimmed);
                    result_text.push(' ');
                }
            }
        }
    }

    Ok(TranscriptionResult {
        text: result_text.trim().to_string(),
        language: lang.to_string(),
        duration_seconds: pcm_data.len() as f32 / 16000.0,
    })
}

fn decode_audio_to_pcm(audio_data: &[u8]) -> Result<Vec<f32>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let cursor = std::io::Cursor::new(audio_data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());
    let probed = symphonia::default::get_probe()
        .format(&Hint::new(), mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Probe: {}", e))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("No track")?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(16000);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Codec: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id { continue; }
        let decoded = match decoder.decode(&packet) { Ok(d) => d, Err(_) => continue };
        let spec = *decoded.spec();
        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();
        if channels > 1 {
            for frame in samples.chunks(channels) {
                all_samples.push(frame.iter().sum::<f32>() / channels as f32);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    // Resample to 16kHz if needed
    if sample_rate != 16000 && !all_samples.is_empty() {
        let ratio = sample_rate as f64 / 16000.0;
        let out_len = (all_samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(out_len);
        for i in 0..out_len {
            let src = i as f64 * ratio;
            let idx = src as usize;
            let frac = (src - idx as f64) as f32;
            let s0 = all_samples.get(idx).copied().unwrap_or(0.0);
            let s1 = all_samples.get(idx + 1).copied().unwrap_or(s0);
            resampled.push(s0 + frac * (s1 - s0));
        }
        all_samples = resampled;
    }

    if all_samples.is_empty() {
        return Err("No audio samples".to_string());
    }
    Ok(all_samples)
}

#[tokio::main]
async fn main() {
    let port = std::env::var("HALT_WHISPER_PORT").unwrap_or_else(|_| "7780".to_string());
    let addr = format!("0.0.0.0:{}", port);

    // Pre-load model
    match get_or_load_ctx() {
        Ok(_) => eprintln!("[halt-whisper] Ready on {}", addr),
        Err(e) => {
            eprintln!("[halt-whisper] FATAL: {}", e);
            std::process::exit(1);
        }
    }

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/listen", post(listen_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)); // 50MB

    let listener = tokio::net::TcpListener::bind(&addr).await
        .expect("Failed to bind whisper server");
    axum::serve(listener, app).await.expect("Whisper server failed");
}
