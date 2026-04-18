//! Whisper STT — proxy to standalone halt-whisper subprocess.
//!
//! whisper.cpp and llama.cpp both statically link ggml, causing symbol
//! conflicts when loaded in the same binary. To avoid this, Whisper runs
//! as a separate process (`halt-whisper`) on port 7780.
//!
//! This module manages the subprocess lifecycle and proxies STT requests.

use crate::config;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

static WHISPER_READY: AtomicBool = AtomicBool::new(false);
static WHISPER_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

const WHISPER_PORT: u16 = 7780;

fn whisper_url(path: &str) -> String {
    format!("http://127.0.0.1:{}{}", WHISPER_PORT, path)
}

/// Check if ggml model file exists (for health reporting).
fn has_ggml_model() -> bool {
    let dir = config::models_dir();
    let candidates = ["ggml-base.bin", "ggml-base.en.bin", "ggml-small.bin", "ggml-tiny.bin"];
    candidates.iter().any(|n| dir.join(n).exists())
}

/// Spawn the halt-whisper subprocess if not already running.
pub fn ensure_loaded() -> Result<PathBuf, String> {
    if WHISPER_READY.load(Ordering::SeqCst) {
        return Ok(PathBuf::from("halt-whisper:7780"));
    }

    if !has_ggml_model() {
        return Err("No ggml Whisper model found in MODELS_DIR".to_string());
    }

    spawn_subprocess()?;

    // Wait for subprocess to become ready (up to 30s)
    for i in 0..60 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if check_health() {
            WHISPER_READY.store(true, Ordering::SeqCst);
            return Ok(PathBuf::from("halt-whisper:7780"));
        }
        if i % 10 == 0 {
            log::info!("[whisper] Waiting for halt-whisper subprocess... ({}s)", i / 2);
        }
    }

    Err("halt-whisper subprocess did not become ready within 30s".to_string())
}

fn spawn_subprocess() -> Result<(), String> {
    let mut guard = WHISPER_PROCESS.lock().map_err(|e| e.to_string())?;

    // Already running?
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(None) => return Ok(()), // still running
            Ok(Some(status)) => {
                log::warn!("[whisper] Subprocess exited: {}", status);
            }
            Err(e) => {
                log::warn!("[whisper] Check failed: {}", e);
            }
        }
    }

    // Find the halt-whisper binary next to the main executable
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let bin_name = if cfg!(windows) { "halt-whisper.exe" } else { "halt-whisper" };

    // Search: same dir as main exe, then release, then debug
    let candidates = [
        exe_dir.join(bin_name),
        exe_dir.parent().unwrap_or(exe_dir).join("release").join(bin_name),
        exe_dir.parent().unwrap_or(exe_dir).join("debug").join(bin_name),
    ];
    let whisper_exe = candidates.iter().find(|p| p.exists())
        .ok_or_else(|| format!(
            "halt-whisper binary not found. Build with: cargo build --bin halt-whisper --release --features whisper_stt"
        ))?.clone();

    log::info!("[whisper] Spawning subprocess: {}", whisper_exe.display());

    let child = std::process::Command::new(&whisper_exe)
        .env("HALT_MODELS_DIR", config::models_dir())
        .env("HALT_WHISPER_PORT", WHISPER_PORT.to_string())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn halt-whisper: {}", e))?;

    log::info!("[whisper] Subprocess spawned (PID: {})", child.id());
    *guard = Some(child);
    Ok(())
}

fn check_health() -> bool {
    reqwest::blocking::get(whisper_url("/health"))
        .and_then(|r| r.json::<serde_json::Value>())
        .map(|v| v["ready"].as_bool().unwrap_or(false))
        .unwrap_or(false)
}

pub fn is_loaded() -> bool {
    WHISPER_READY.load(Ordering::SeqCst)
}

/// Proxy a transcription request to the halt-whisper subprocess.
pub fn transcribe(audio_data: &[u8], lang: &str) -> Result<(String, String, f32), String> {
    if !WHISPER_READY.load(Ordering::SeqCst) {
        ensure_loaded()?;
    }

    let client = reqwest::blocking::Client::new();
    let url_path = format!("/listen?lang={}", lang);
    let resp = client
        .post(whisper_url(&url_path))
        .body(audio_data.to_vec())
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .map_err(|e| format!("Whisper request failed: {}", e))?;

    let json: serde_json::Value = resp.json()
        .map_err(|e| format!("Whisper response parse: {}", e))?;

    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }

    let text = json["text"].as_str().unwrap_or("").to_string();
    let language = json["language"].as_str().unwrap_or("en").to_string();
    let duration = json["duration_seconds"].as_f64().unwrap_or(0.0) as f32;

    Ok((text, language, duration))
}

pub fn unload() {
    WHISPER_READY.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = WHISPER_PROCESS.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("[whisper] Subprocess terminated");
        }
        *guard = None;
    }
}
