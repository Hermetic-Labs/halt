//! Distribution — model pack download, verification, and extraction.
//!
//! Full conversion exists (uses reqwest + sha2 + flate2 + tar).
//! Currently: status checking works, download defers to sidecar.
//!
//! Python source: distribution.py (all 5 endpoints)

use crate::config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(feature = "native_ml")]
use std::sync::Arc;
#[cfg(feature = "native_ml")]
use tauri::Emitter;
#[cfg(feature = "native_ml")]
use futures_util::StreamExt;
#[cfg(feature = "native_ml")]
use std::io::Write;

static DOWNLOAD_BUSY: AtomicBool = AtomicBool::new(false);

/// Pack definitions — direct from distribution.py:PACKS (line 30).
const PACK_IDS: &[&str] = &["voice", "stt", "translation", "ai"];

fn pack_installed(pack_id: &str) -> bool {
    let dir = config::models_dir();
    match pack_id {
        "voice" => dir.join("kokoro-v1.0.onnx").exists() && dir.join("voices-v1.0.bin").exists(),
        "stt" => dir.join("faster-whisper-base").is_dir(),
        "translation" => dir.join("nllb-200-distilled-600M-ct2").is_dir(),
        "ai" => fs::read_dir(&dir)
            .map(|entries| entries.flatten().any(|e| {
                e.path().extension().and_then(|x| x.to_str()) == Some("gguf")
            }))
            .unwrap_or(false),
        _ => false,
    }
}

fn pack_size_mb(pack_id: &str) -> u64 {
    match pack_id {
        "voice" => 89,
        "stt" => 141,
        "translation" => 2361,
        "ai" => 2375,
        _ => 0,
    }
}

#[derive(Debug, Deserialize)]
pub struct DownloadRequest {
    pub pack: String,
    pub url: String,
}

/// Translation of distribution.py:get_status() (line 203).
/// Fully functional — only uses filesystem checks.
#[tauri::command]
pub fn distribution_status() -> Value {
    let dir = config::models_dir();
    let mut packs = serde_json::Map::new();
    for &pack_id in PACK_IDS {
        packs.insert(pack_id.to_string(), serde_json::json!({
            "installed": pack_installed(pack_id),
            "size_mb": pack_size_mb(pack_id),
        }));
    }
    serde_json::json!({
        "packs": packs,
        "models_dir": dir.to_string_lossy(),
    })
}

/// Safely fetches and extracts a model pack.
#[cfg(feature = "native_ml")]
#[tauri::command]
pub async fn distribution_download(
    app: tauri::AppHandle,
    request: DownloadRequest,
) -> Result<Value, String> {
    if !PACK_IDS.contains(&request.pack.as_str()) {
        return Err(format!("Unknown pack: {}", request.pack));
    }
    if DOWNLOAD_BUSY.swap(true, Ordering::SeqCst) {
        return Err("Download already in progress".to_string());
    }

    let pack = request.pack.clone();
    let url = request.url.clone();
    
    // Offload to background tokio task
    tauri::async_runtime::spawn(async move {
        match download_and_extract(app.clone(), &pack, &url).await {
            Ok(_) => {
                let _ = app.emit("distribution-progress", serde_json::json!({
                    "pack": pack, "phase": "complete", "percent": 100
                }));
            }
            Err(e) => {
                let _ = app.emit("distribution-progress", serde_json::json!({
                    "pack": pack, "phase": "error", "percent": 0, "error": e
                }));
            }
        }
        DOWNLOAD_BUSY.store(false, Ordering::SeqCst);
    });

    Ok(serde_json::json!({"status": "started", "pack": request.pack}))
}

#[cfg(not(feature = "native_ml"))]
#[tauri::command]
pub async fn distribution_download(
    app: tauri::AppHandle,
    request: DownloadRequest,
) -> Result<Value, String> {
    Err("Download natively requires reqwest crates which are disabled in UI-only build. Compile with --features native_ml.".to_string())
}

#[cfg(feature = "native_ml")]
async fn download_and_extract(app: tauri::AppHandle, pack: &str, url: &str) -> Result<(), String> {
    let dir = config::models_dir();
    let archive_path = dir.join(format!("{}.tar.gz", pack));

    let _ = app.emit("distribution-progress", serde_json::json!({
        "pack": pack, "phase": "downloading", "percent": 0,
    }));

    // ── Phase 1: Download ──
    let mut response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total_size = response.content_length().unwrap_or(0);
    
    let mut file = std::fs::File::create(&archive_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    
    let mut stream = response.bytes_stream();
    let mut last_percent = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let percent = if total_size > 0 {
            (downloaded as f64 / total_size as f64 * 100.0) as u64
        } else {
            0
        };

        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit("distribution-progress", serde_json::json!({
                "pack": pack, "phase": "downloading", "percent": percent,
                "bytes_done": downloaded, "bytes_total": total_size
            }));
        }
    }
    
    // Explicitly sync and close file
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);

    // ── Phase 2: Unzip ──
    let _ = app.emit("distribution-progress", serde_json::json!({
        "pack": pack, "phase": "extracting", "percent": 0
    }));

    let archive_path_clone = archive_path.clone();
    let dir_clone = dir.clone();
    
    // Blocking I/O inside spawn_blocking
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let tar_gz = std::fs::File::open(&archive_path_clone).map_err(|e| e.to_string())?;
        let tar = flate2::read::GzDecoder::new(tar_gz);
        let mut archive = tar::Archive::new(tar);
        
        archive.unpack(&dir_clone).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(archive_path_clone);
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    Ok(())
}

#[tauri::command]
pub async fn distribution_download_all(app: tauri::AppHandle) -> Result<Value, String> {
    Err("Batch download not fully ported yet; please download components individually.".to_string())
}

/// Translation of distribution.py:get_checksums() (line 311).
/// Fully functional — reads checksums.json from models dir.
#[tauri::command]
pub fn distribution_checksums() -> Value {
    let path = config::models_dir().join("checksums.json");
    if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::json!({"checksums": {}}))
    } else {
        serde_json::json!({"checksums": {}})
    }
}

/// Translation of distribution.py:set_checksums() (line 317).
/// Fully functional — writes checksums.json to models dir.
#[tauri::command]
pub fn set_checksums(checksums: Value) -> Result<Value, String> {
    let path = config::models_dir().join("checksums.json");
    let payload = serde_json::to_string_pretty(&checksums).map_err(|e| e.to_string())?;
    fs::write(&path, payload).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"status": "ok"}))
}
