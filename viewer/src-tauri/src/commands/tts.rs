//! TTS — Text-to-speech via Kokoro ONNX.
//!
//! Direct translation of `api/routes/tts.py`.
//!
//! Key features ported:
//!   - Multi-voice synthesis keyed by language code
//!   - Japanese romaji preprocessing (katakana → latin for Kokoro)
//!   - Multi-segment synthesis for long text (1000 char chunks)
//!   - WAV output with proper headers
//!   - Queue/lock to serialize TTS requests (shared with translate_stream)

use crate::models::kokoro;
use crate::models::phonemizer;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global TTS lock — matches Python's `_tts_lock = asyncio.Lock()`.
/// Shared between tts.rs and translate_stream.rs to prevent concurrent
/// ONNX session access.
pub static TTS_BUSY: AtomicBool = AtomicBool::new(false);

pub struct TtsLockGuard;
impl TtsLockGuard {
    pub fn try_acquire() -> Result<Self, String> {
        if TTS_BUSY.swap(true, Ordering::SeqCst) {
            Err("TTS engine is busy".to_string())
        } else {
            Ok(Self)
        }
    }
}
impl Drop for TtsLockGuard {
    fn drop(&mut self) {
        TTS_BUSY.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Deserialize)]
pub struct SynthesizeRequest {
    pub text: String,
    #[serde(default = "default_voice")]
    pub voice: String,
    #[serde(default = "default_speed")]
    pub speed: f32,
    #[serde(default)]
    pub lang: String,
}

fn default_voice() -> String {
    "af_heart".to_string()
}
fn default_speed() -> f32 {
    1.0
}

#[derive(Debug, Deserialize)]
pub struct MultiSynthRequest {
    pub segments: Vec<SynthSegment>,
    #[serde(default = "default_speed")]
    pub speed: f32,
}

#[derive(Debug, Deserialize)]
pub struct SynthSegment {
    pub text: String,
    pub lang: String,
}

#[derive(Debug, Serialize)]
pub struct SynthesizeResponse {
    pub audio_base64: String,
    pub sample_rate: u32,
    pub duration_ms: u64,
}

#[tauri::command]
pub fn tts_health() -> Value {
    serde_json::json!({
        "ready": kokoro::is_loaded(),
    })
}

#[tauri::command]
pub fn tts_voices() -> Value {
    let map = kokoro::voice_map();
    let voices: Vec<Value> = map
        .iter()
        .map(|(lang, voice)| serde_json::json!({"lang": lang, "voice": voice}))
        .collect();
    serde_json::json!({"voices": voices})
}

#[tauri::command]
pub fn tts_queue_status() -> Value {
    serde_json::json!({
        "busy": TTS_BUSY.load(Ordering::Relaxed),
        "model_loaded": kokoro::is_loaded(),
    })
}

/// Single-language synthesis.
#[tauri::command]
pub fn tts_synthesize(request: SynthesizeRequest) -> Result<SynthesizeResponse, String> {
    let _guard = TtsLockGuard::try_acquire()?;

    let result = (|| {
        log::info!("[TTS] Starting synthesis: text='{}', voice='{}', lang='{}', speed={}", 
            request.text.chars().take(60).collect::<String>(), request.voice, request.lang, request.speed);

        let (_model, _voices) = kokoro::ensure_loaded()?;
        log::info!("[TTS] Model loaded OK");

        // Resolve voice from language if no explicit voice
        let _voice = if request.voice == "af_heart" && !request.lang.is_empty() {
            let map = kokoro::voice_map();
            map.get(request.lang.as_str())
                .copied()
                .unwrap_or("af_heart")
                .to_string()
        } else {
            request.voice.clone()
        };
        log::info!("[TTS] Voice resolved: {}", _voice);

        let (text, effective_lang) = preprocess_text(&request.text, &request.lang);
        let safe_text = text.chars().take(80).collect::<String>();
        log::info!("[TTS] Preprocessed text (lang {}→{}): '{}'", &request.lang, &effective_lang, safe_text);

        // Phonemize: text → espeak-ng IPA → Kokoro token IDs
        let tokens = phonemizer::text_to_tokens(&text, &effective_lang).unwrap_or_else(|e| {
            log::warn!("[TTS] Phonemization failed, using safe fallback: {}", e);
            vec![0; text.len().min(50).max(10)]
        });
        log::info!("[TTS] Phonemized: {} tokens", tokens.len());

        // Extract voice style vector: voice_array[len(tokens)] → [1, 256]
        // Matches Python: style = voice_array[len(tokens)]
        let style = kokoro::get_voice_style(&_voice, tokens.len()).unwrap_or_else(|e| {
            log::warn!("[TTS] Voice style extraction failed ({}), using zeros", e);
            vec![0.0f32; 256]
        });
        let speed = request.speed;

        log::info!("[TTS] Getting ORT session...");
        let session = kokoro::get_session()?;
        log::info!("[TTS] Building input tensors (tokens={}, style={}, speed={})...", tokens.len(), style.len(), speed);

        let t_tokens = ort::value::Tensor::from_array(
            ndarray::Array1::from_vec(tokens.clone())
                .into_shape_with_order((1, tokens.len()))
                .map_err(|e| format!("Tokens shape err: {}", e))?
        ).map_err(|e| format!("Tokens tensor err: {}", e))?;

        let t_style = ort::value::Tensor::from_array(
            ndarray::Array1::from_vec(style)
                .into_shape_with_order((1, 256))
                .map_err(|e| format!("Style shape err: {}", e))?
        ).map_err(|e| format!("Style tensor err: {}", e))?;

        let t_speed = ort::value::Tensor::from_array(
            ndarray::Array1::from_vec(vec![speed])
        ).map_err(|e| format!("Speed tensor err: {}", e))?;

        let input_values = ort::inputs![
            "tokens" => t_tokens,
            "style" => t_style,
            "speed" => t_speed,
        ];

        log::info!("[TTS] Running ORT inference...");
        let mut session = session.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let outputs = session
            .run(input_values)
            .map_err(|e| format!("ORT Run error: {}", e))?;
        log::info!("[TTS] ORT inference complete, extracting audio...");

        let audio_tensor = outputs["audio"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("Tensor error: {}", e))?;
        let pcm_f32: Vec<f32> = audio_tensor.1.to_vec();
        log::info!("[TTS] Audio extracted: {} samples ({:.1}s at 24kHz)", pcm_f32.len(), pcm_f32.len() as f32 / 24000.0);

        let b64 = f32_to_wav_base64(&pcm_f32, 24000);
        log::info!("[TTS] WAV encoded: {} bytes base64", b64.len());

        Ok(SynthesizeResponse {
            audio_base64: format!("data:audio/wav;base64,{}", b64),
            sample_rate: 24000,
            duration_ms: (pcm_f32.len() as u64 * 1000) / 24000,
        })
    })();

    result
}

/// Multi-language synthesis — stitches segments in different languages/voices.
/// Direct translation of `/tts/synthesize-multi` endpoint.
#[tauri::command]
pub fn tts_synthesize_multi(request: MultiSynthRequest) -> Result<SynthesizeResponse, String> {
    let _guard = TtsLockGuard::try_acquire()?;

    let result = (|| {
        let (_model, _voices) = kokoro::ensure_loaded()?;
        let map = kokoro::voice_map();

        let session = kokoro::get_session()?;
        let mut all_pcm = Vec::new();

        for seg in &request.segments {
            let _voice = map.get(seg.lang.as_str()).copied().unwrap_or("af_heart");
            let (text, effective_lang) = preprocess_text(&seg.text, &seg.lang);

            // Phonemize per-segment
            let tokens = phonemizer::text_to_tokens(&text, &effective_lang).unwrap_or_else(|e| {
                log::warn!("Phonemization failed for segment, using safe fallback: {}", e);
                vec![0; text.len().min(50).max(10)]
            });
            let style = kokoro::get_voice_style(_voice, tokens.len()).unwrap_or_else(|e| {
                log::warn!("[TTS-multi] Voice style failed ({}), using zeros", e);
                vec![0.0f32; 256]
            });

            let t_tokens = ort::value::Tensor::from_array(
                ndarray::Array1::from_vec(tokens.clone())
                    .into_shape_with_order((1, tokens.len()))
                    .map_err(|e| format!("Tokens shape err: {}", e))?
            ).map_err(|e| format!("Tokens tensor err: {}", e))?;

            let t_style = ort::value::Tensor::from_array(
                ndarray::Array1::from_vec(style)
                    .into_shape_with_order((1, 256))
                    .map_err(|e| format!("Style shape err: {}", e))?
            ).map_err(|e| format!("Style tensor err: {}", e))?;

            let t_speed = ort::value::Tensor::from_array(
                ndarray::Array1::from_vec(vec![request.speed])
            ).map_err(|e| format!("Speed tensor err: {}", e))?;

            let input_values = ort::inputs![
                "tokens" => t_tokens,
                "style" => t_style,
                "speed" => t_speed,
            ];

            let mut session_lock = session.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let outputs = session_lock
                .run(input_values)
                .map_err(|e| format!("ORT Run error: {}", e))?;
            let audio_tensor = outputs["audio"]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Tensor error: {}", e))?;
            let pcm_f32: Vec<f32> = audio_tensor.1.to_vec();

            all_pcm.extend_from_slice(&pcm_f32);

            // 300ms silence
            all_pcm.extend(vec![0.0f32; (24000.0 * 0.3) as usize]);
        }

        let b64 = f32_to_wav_base64(&all_pcm, 24000);
        Ok(SynthesizeResponse {
            audio_base64: format!("data:audio/wav;base64,{}", b64),
            sample_rate: 24000,
            duration_ms: (all_pcm.len() as u64 * 1000) / 24000,
        })
    })();

    result
}

/// Preprocess text for TTS — handles script conversion so espeak-ng always
/// receives Latin-readable text for unsupported languages.
///
/// Returns (processed_text, effective_lang).
pub fn preprocess_text(text: &str, lang: &str) -> (String, String) {
    let mut processed = if lang == "ja" {
        katakana_to_romaji(text)
    } else {
        text.to_string()
    };

    let effective_lang = lang.to_string();

    // Only romanize languages that espeak-ng completely chokes on.
    // Native voices (zh, ar, hi, ru, ko, th) handle raw utf-8 perfectly!
    // But unsupported languages (ku, ps, yo, ig) cause espeak to literally
    // spell out raw unicode character names "Arabic letter Seen, etc".
    if needs_romanization(lang) && !processed.is_empty() {
        let romanized = any_ascii::any_ascii(&processed);
        if !romanized.trim().is_empty() {
            log::info!(
                "[TTS preprocess] Transliterated unsupported script (lang={}): '{}' → '{}'",
                lang, processed.chars().take(40).collect::<String>(), romanized.chars().take(60).collect::<String>()
            );
            processed = romanized;
        }
    }

    // Trim to max 1000 chars per segment safely (Kokoro limit)
    if processed.chars().count() > 1000 {
        processed = processed.chars().take(1000).collect();
    }

    (processed, effective_lang)
}

/// Languages lacking espeak-ng profiles that will crash into letter-spelling.
fn needs_romanization(lang: &str) -> bool {
    matches!(lang,
        "ja" |                         // Japanese (Kanji/Hiragana bypasses katakana_to_romaji and crashes espeak-ng)
        "tl" | "jw" |                  // SEA fallbacks (no native espeak voice, mapped to en-us)
        "ig" | "yo" | "zu" | "xh" |    // African fallbacks (no native espeak voice, mapped to en-us)
        "mg"                           // Malagasy fallback
    )
}

/// Convert katakana to romaji for Kokoro TTS.
/// Direct port of `_KATA` lookup table + `_kata_to_romaji()` from tts.py.
fn katakana_to_romaji(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut result = String::with_capacity(text.len());
    let mut i = 0;

    while i < chars.len() {
        // Try two-char combo first (キャ, シャ, etc.)
        if i + 1 < chars.len() {
            let two: String = chars[i..=i + 1].iter().collect();
            if let Some(rom) = kata_lookup(&two) {
                result.push_str(rom);
                i += 2;
                continue;
            }
        }

        // Single-char lookup
        let one = chars[i].to_string();
        if let Some(rom) = kata_lookup(&one) {
            // Gemination: ッ doubles the next consonant
            if chars[i] == 'ッ' && i + 1 < chars.len() {
                let next = chars[i + 1].to_string();
                if let Some(nxt) = kata_lookup(&next) {
                    if let Some(c) = nxt.chars().next() {
                        result.push(c);
                    }
                }
            } else {
                result.push_str(rom);
            }
            i += 1;
        } else {
            // Pass through non-katakana (kanji, latin, punctuation)
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

/// Katakana → romaji lookup. Port of Python `_KATA` dict from tts.py.
fn kata_lookup(s: &str) -> Option<&'static str> {
    match s {
        // Combo mora (must be checked before singles)
        "キャ" => Some("kya"),
        "キュ" => Some("kyu"),
        "キョ" => Some("kyo"),
        "シャ" => Some("sha"),
        "シュ" => Some("shu"),
        "ショ" => Some("sho"),
        "チャ" => Some("cha"),
        "チュ" => Some("chu"),
        "チョ" => Some("cho"),
        "ニャ" => Some("nya"),
        "ニュ" => Some("nyu"),
        "ニョ" => Some("nyo"),
        "ヒャ" => Some("hya"),
        "ヒュ" => Some("hyu"),
        "ヒョ" => Some("hyo"),
        "ミャ" => Some("mya"),
        "ミュ" => Some("myu"),
        "ミョ" => Some("myo"),
        "リャ" => Some("rya"),
        "リュ" => Some("ryu"),
        "リョ" => Some("ryo"),
        "ギャ" => Some("gya"),
        "ギュ" => Some("gyu"),
        "ギョ" => Some("gyo"),
        "ジャ" => Some("ja"),
        "ジュ" => Some("ju"),
        "ジョ" => Some("jo"),
        "ビャ" => Some("bya"),
        "ビュ" => Some("byu"),
        "ビョ" => Some("byo"),
        "ピャ" => Some("pya"),
        "ピュ" => Some("pyu"),
        "ピョ" => Some("pyo"),
        // Vowels
        "ア" => Some("a"),
        "イ" => Some("i"),
        "ウ" => Some("u"),
        "エ" => Some("e"),
        "オ" => Some("o"),
        // K-row
        "カ" => Some("ka"),
        "キ" => Some("ki"),
        "ク" => Some("ku"),
        "ケ" => Some("ke"),
        "コ" => Some("ko"),
        // S-row
        "サ" => Some("sa"),
        "シ" => Some("shi"),
        "ス" => Some("su"),
        "セ" => Some("se"),
        "ソ" => Some("so"),
        // T-row
        "タ" => Some("ta"),
        "チ" => Some("chi"),
        "ツ" => Some("tsu"),
        "テ" => Some("te"),
        "ト" => Some("to"),
        // N-row
        "ナ" => Some("na"),
        "ニ" => Some("ni"),
        "ヌ" => Some("nu"),
        "ネ" => Some("ne"),
        "ノ" => Some("no"),
        // H-row
        "ハ" => Some("ha"),
        "ヒ" => Some("hi"),
        "フ" => Some("fu"),
        "ヘ" => Some("he"),
        "ホ" => Some("ho"),
        // M-row
        "マ" => Some("ma"),
        "ミ" => Some("mi"),
        "ム" => Some("mu"),
        "メ" => Some("me"),
        "モ" => Some("mo"),
        // Y-row
        "ヤ" => Some("ya"),
        "ユ" => Some("yu"),
        "ヨ" => Some("yo"),
        // R-row
        "ラ" => Some("ra"),
        "リ" => Some("ri"),
        "ル" => Some("ru"),
        "レ" => Some("re"),
        "ロ" => Some("ro"),
        // W-row + N
        "ワ" => Some("wa"),
        "ヲ" => Some("wo"),
        "ン" => Some("n"),
        // Dakuten (voiced)
        "ガ" => Some("ga"),
        "ギ" => Some("gi"),
        "グ" => Some("gu"),
        "ゲ" => Some("ge"),
        "ゴ" => Some("go"),
        "ザ" => Some("za"),
        "ジ" => Some("ji"),
        "ズ" => Some("zu"),
        "ゼ" => Some("ze"),
        "ゾ" => Some("zo"),
        "ダ" => Some("da"),
        "ヂ" => Some("di"),
        "ヅ" => Some("du"),
        "デ" => Some("de"),
        "ド" => Some("do"),
        "バ" => Some("ba"),
        "ビ" => Some("bi"),
        "ブ" => Some("bu"),
        "ベ" => Some("be"),
        "ボ" => Some("bo"),
        // Handakuten (p-row)
        "パ" => Some("pa"),
        "ピ" => Some("pi"),
        "プ" => Some("pu"),
        "ペ" => Some("pe"),
        "ポ" => Some("po"),
        // Special
        "ッ" => Some(""), // gemination handled in caller
        "ー" => Some(""), // long vowel mark — skip
        _ => None,
    }
}

fn f32_to_wav_base64(pcm: &[f32], sample_rate: u32) -> String {
    use base64::Engine;

    let mut buf = Vec::new();
    let audio_len = pcm.len() * 2;
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&((36 + audio_len) as u32).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size
    buf.extend_from_slice(&1u16.to_le_bytes()); // AudioFormat (PCM)
    buf.extend_from_slice(&1u16.to_le_bytes()); // NumChannels (1)
    buf.extend_from_slice(&sample_rate.to_le_bytes()); // SampleRate
    buf.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // ByteRate
    buf.extend_from_slice(&2u16.to_le_bytes()); // BlockAlign
    buf.extend_from_slice(&16u16.to_le_bytes()); // BitsPerSample
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&(audio_len as u32).to_le_bytes());

    for &sample in pcm {
        let s = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        buf.extend_from_slice(&s.to_le_bytes());
    }

    base64::engine::general_purpose::STANDARD.encode(&buf)
}
