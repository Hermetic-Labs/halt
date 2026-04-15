//! STT — Speech-to-text via whisper.cpp.
//!
//! Direct translation of `api/routes/stt.py`.
//! Receives audio bytes (WAV, WebM, OGG, MP3), decodes to PCM f32 via
//! symphonia, resamples to 16kHz mono, then transcribes via Whisper.

use crate::models::whisper;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_seconds: f32,
}

#[tauri::command]
pub fn stt_health() -> serde_json::Value {
    serde_json::json!({
        "ready": whisper::is_loaded(),
    })
}

/// Decode audio bytes (any supported format) to mono f32 PCM at 16kHz.
/// Uses symphonia for codec-agnostic decoding.
#[cfg(feature = "native_ml")]
fn decode_audio_to_pcm(audio_data: &[u8]) -> Result<Vec<f32>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let cursor = std::io::Cursor::new(audio_data.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let hint = Hint::new();
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let decoder_opts = DecoderOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Audio probe failed: {}", e))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("No audio track found")?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(16000);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Codec init failed: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue, // skip corrupt packets
        };

        let spec = *decoded.spec();
        let num_frames = decoded.capacity();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);

        let samples = sample_buf.samples();

        // Downmix to mono if stereo+
        if channels > 1 {
            for frame in samples.chunks(channels) {
                let mono: f32 = frame.iter().sum::<f32>() / channels as f32;
                all_samples.push(mono);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    // Resample to 16kHz if needed (Whisper expects 16kHz)
    if sample_rate != 16000 && !all_samples.is_empty() {
        all_samples = resample_linear(&all_samples, sample_rate, 16000);
    }

    if all_samples.is_empty() {
        return Err("No audio samples decoded".to_string());
    }

    log::info!(
        "Decoded {} samples ({:.1}s at 16kHz) from {} input bytes",
        all_samples.len(),
        all_samples.len() as f32 / 16000.0,
        audio_data.len()
    );

    Ok(all_samples)
}

/// Simple linear interpolation resampler.
/// Good enough for speech (not music). Zero dependencies.
#[cfg(feature = "native_ml")]
fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx as usize;
        let frac = (src_idx - idx0 as f64) as f32;

        let s0 = input.get(idx0).copied().unwrap_or(0.0);
        let s1 = input.get(idx0 + 1).copied().unwrap_or(s0);
        output.push(s0 + frac * (s1 - s0));
    }

    output
}

/// Fallback: treat raw bytes as f32 PCM (legacy behavior).
#[cfg(not(feature = "native_ml"))]
fn decode_audio_to_pcm(audio_data: &[u8]) -> Result<Vec<f32>, String> {
    let mut pcm_data = Vec::with_capacity(audio_data.len() / 4);
    for chunk in audio_data.chunks_exact(4) {
        pcm_data.push(f32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])));
    }
    Ok(pcm_data)
}

/// Transcribe audio bytes to text.
/// The frontend sends the audio as a Vec<u8> (WebM/WAV blob).
#[tauri::command]
pub fn stt_listen(
    audio_data: Vec<u8>,
    language: Option<String>,
) -> Result<TranscriptionResult, String> {
    let _model = whisper::ensure_loaded()?;
    let lang = language.unwrap_or_else(|| "en".to_string());

    // Decode audio (WebM/WAV/OGG/MP3) → mono f32 PCM at 16kHz
    let pcm_data = decode_audio_to_pcm(&audio_data)?;

    // VAD: discard audio that's too quiet (prevents hallucination on silence)
    // Matches Python's vad_filter=True and translate_stream.rs RMS check
    let sum_sq: f32 = pcm_data.iter().map(|&s| s * s).sum();
    let rms = if pcm_data.is_empty() {
        0.0
    } else {
        (sum_sq / pcm_data.len() as f32).sqrt()
    };
    if rms < 0.005 {
        log::debug!("[STT] VAD: Audio discarded (too quiet, RMS {:.4})", rms);
        return Ok(TranscriptionResult {
            text: String::new(),
            language: lang,
            duration_seconds: pcm_data.len() as f32 / 16000.0,
        });
    }

    let ctx = whisper::get_context()?;

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("State error: {}", e))?;

    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::BeamSearch { beam_size: 5, patience: 1.0 });
    params.set_language(Some(&lang));
    params.set_no_speech_thold(0.65); // Whisper-native VAD (matches translate_stream)
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);

    state
        .full(params, &pcm_data)
        .map_err(|e| format!("Whisper eval error: {}", e))?;
    let num_segments = state.full_n_segments();

    let mut result_text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(text) = segment.to_str_lossy() {
                let trimmed = text.trim();
                // Filter hallucinations: [music], (background noise), etc.
                if !trimmed.starts_with('[') && !trimmed.starts_with('(') {
                    result_text.push_str(trimmed);
                    result_text.push(' ');
                }
            }
        }
    }

    log::info!("[STT] Transcribed {:.1}s → '{}' (lang={})",
        pcm_data.len() as f32 / 16000.0, &result_text[..result_text.len().min(80)], lang);

    Ok(TranscriptionResult {
        text: result_text.trim().to_string(),
        language: lang,
        duration_seconds: pcm_data.len() as f32 / 16000.0,
    })
}
