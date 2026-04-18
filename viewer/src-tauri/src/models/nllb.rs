//! NLLB Translation — proxy to standalone halt-nllb subprocess.
//!
//! CTranslate2 causes debug CRT crashes when loaded alongside llama.cpp.
//! To avoid this, NLLB runs as a separate process (`halt-nllb`) on port 7781.

use crate::config;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

static NLLB_READY: AtomicBool = AtomicBool::new(false);
static NLLB_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);

const NLLB_PORT: u16 = 7781;

fn nllb_url(path: &str) -> String {
    format!("http://127.0.0.1:{}{}", NLLB_PORT, path)
}

/// Map UI language codes → NLLB BCP-47 codes.
pub fn lang_map() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("en", "eng_Latn"); m.insert("es", "spa_Latn"); m.insert("fr", "fra_Latn");
    m.insert("ar", "arb_Arab"); m.insert("bn", "ben_Beng"); m.insert("de", "deu_Latn");
    m.insert("he", "heb_Hebr"); m.insert("hi", "hin_Deva"); m.insert("id", "ind_Latn");
    m.insert("it", "ita_Latn"); m.insert("ja", "jpn_Jpan"); m.insert("ko", "kor_Hang");
    m.insert("la", "lat_Latn"); m.insert("nl", "nld_Latn"); m.insert("pl", "pol_Latn");
    m.insert("pt", "por_Latn"); m.insert("ru", "rus_Cyrl"); m.insert("sw", "swh_Latn");
    m.insert("th", "tha_Thai"); m.insert("tl", "tgl_Latn"); m.insert("tr", "tur_Latn");
    m.insert("ur", "urd_Arab"); m.insert("vi", "vie_Latn"); m.insert("zh", "zho_Hans");
    m.insert("am", "amh_Ethi"); m.insert("ha", "hau_Latn"); m.insert("ig", "ibo_Latn");
    m.insert("jw", "jav_Latn"); m.insert("ku", "ckb_Arab"); m.insert("mg", "plt_Latn");
    m.insert("mr", "mar_Deva"); m.insert("my", "mya_Mymr"); m.insert("ps", "pbt_Arab");
    m.insert("so", "som_Latn"); m.insert("ta", "tam_Taml"); m.insert("te", "tel_Telu");
    m.insert("uk", "ukr_Cyrl"); m.insert("yo", "yor_Latn"); m.insert("zu", "zul_Latn");
    m.insert("xh", "xho_Latn"); m.insert("fa", "pes_Arab"); m.insert("km", "khm_Khmr");
    m
}

fn has_nllb_model() -> bool {
    config::models_dir().join("nllb-200-distilled-600M-ct2").is_dir()
}

pub fn ensure_loaded() -> Result<PathBuf, String> {
    log::info!("[nllb::ensure] Check starting. Current NLLB_READY flag: {}", NLLB_READY.load(Ordering::SeqCst));
    if NLLB_READY.load(Ordering::SeqCst) {
        return Ok(PathBuf::from("halt-nllb:7781"));
    }

    if !has_nllb_model() {
        log::error!("[nllb::ensure] FATAL: model missing from MODELS_DIR.");
        return Err("NLLB model not found in MODELS_DIR".to_string());
    }

    // Check if the external batch script already spawned it successfully!
    if check_health() {
        log::info!("[nllb::ensure] Externally spawned halt-nllb detected on port 7781! Bypassing spawn.");
        NLLB_READY.store(true, Ordering::SeqCst);
        return Ok(PathBuf::from("halt-nllb:7781"));
    }

    log::info!("[nllb::ensure] Spawning or verifying subprocess...");
    spawn_subprocess()?;

    // Wait for subprocess to become ready (up to 30s)
    log::info!("[nllb::ensure] Entering 30s readiness loop...");
    for i in 0..60 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if check_health() {
            log::info!("[nllb::ensure] Health check PASSED on attempt {}", i);
            NLLB_READY.store(true, Ordering::SeqCst);
            return Ok(PathBuf::from("halt-nllb:7781"));
        }
        
        // Ensure child hasn't died
        if let Ok(mut guard) = NLLB_PROCESS.lock() {
            if let Some(ref mut child) = *guard {
                if let Ok(Some(status)) = child.try_wait() {
                    log::error!("[nllb::ensure] Child process died prematurely with status {}", status);
                    return Err(format!("halt-nllb subprocess exited prematurely: {}", status));
                }
            }
        } else {
            log::warn!("[nllb::ensure] Failed to lock NLLB_PROCESS for check!");
        }
        
        if i % 10 == 0 {
            log::info!("[nllb] Waiting for halt-nllb subprocess... ({}s)", i / 2);
        }
    }

    Err("halt-nllb subprocess did not become ready within 30s".to_string())
}

fn spawn_subprocess() -> Result<(), String> {
    let mut guard = NLLB_PROCESS.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(None) => return Ok(()),
            Ok(Some(status)) => log::warn!("[nllb] Subprocess exited: {}", status),
            Err(e) => log::warn!("[nllb] Check failed: {}", e),
        }
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().unwrap_or(std::path::Path::new("."));
    let bin_name = if cfg!(windows) { "halt-nllb.exe" } else { "halt-nllb" };

    let candidates = [
        exe_dir.join(bin_name),
        exe_dir.parent().unwrap_or(exe_dir).join("release").join(bin_name),
        exe_dir.parent().unwrap_or(exe_dir).join("debug").join(bin_name),
    ];
    let nllb_exe = candidates.iter().find(|p| p.exists())
        .ok_or_else(|| format!(
            "halt-nllb binary not found. Build with: cargo build --bin halt-nllb --release --features nllb_translate"
        ))?.clone();

    log::info!("[nllb] Spawning subprocess: {}", nllb_exe.display());

    let child = std::process::Command::new(&nllb_exe)
        .env("HALT_MODELS_DIR", config::models_dir())
        .env("HALT_NLLB_PORT", NLLB_PORT.to_string())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn halt-nllb: {}", e))?;

    log::info!("[nllb] Subprocess spawned (PID: {})", child.id());
    *guard = Some(child);
    Ok(())
}

fn check_health() -> bool {
    reqwest::blocking::get(nllb_url("/health"))
        .and_then(|r| r.json::<serde_json::Value>())
        .map(|v| v["ready"].as_bool().unwrap_or(false))
        .unwrap_or(false)
}

pub fn is_loaded() -> bool {
    NLLB_READY.load(Ordering::SeqCst)
}

/// Proxy a translation request to the halt-nllb subprocess.
pub fn translate(text: &str, source: &str, target: &str) -> Result<String, String> {
    log::info!("[nllb::translate] Requested proxy translation for text length {} from {} to {}", text.len(), source, target);
    
    if !NLLB_READY.load(Ordering::SeqCst) {
        log::info!("[nllb::translate] Subprocess not flagged ready, explicitly calling ensure_loaded()...");
        match ensure_loaded() {
            Ok(_) => log::info!("[nllb::translate] ensure_loaded succeeded."),
            Err(e) => {
                log::error!("[nllb::translate] ensure_loaded failed: {}", e);
                return Err(e);
            }
        }
    }

    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        log::debug!("[nllb::translate] Initializing blocking reqwest client with 30s timeout.");
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    });

    log::info!("[nllb::translate] Sending POST to halt-nllb:7781...");
    let req_start = std::time::Instant::now();

    let resp = client
        .post(nllb_url("/translate"))
        .json(&serde_json::json!({
            "text": text,
            "source": source,
            "target": target,
        }))
        .send();
        
    let resp = match resp {
        Ok(r) => {
            log::info!("[nllb::translate] Received HTTP response in {}ms. Status: {}", req_start.elapsed().as_millis(), r.status());
            r
        },
        Err(e) => {
            log::error!("[nllb::translate] HTTP network failure: {}", e);
            return Err(format!("NLLB request failed: {}", e));
        }
    };

    let json: serde_json::Value = resp.json()
        .map_err(|e| {
            log::error!("[nllb::translate] Failed to parse JSON body: {}", e);
            format!("NLLB response parse: {}", e)
        })?;

    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        log::error!("[nllb::translate] JSON Error returned from halt-nllb: {}", err);
        return Err(err.to_string());
    }

    let result = json["translated"].as_str().unwrap_or("").to_string();
    log::info!("[nllb::translate] Success. Returning translated text length {}.", result.len());
    Ok(result)
}

pub fn unload() {
    NLLB_READY.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = NLLB_PROCESS.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("[nllb] Subprocess terminated");
        }
        *guard = None;
    }
}
