#![allow(dead_code, unused_variables, unused_imports, suspicious_double_ref_op)]
pub mod commands;
mod config;
mod http_server;
mod mesh;
pub mod models;
mod storage;

use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── NATIVE PANIC TRAP ──
    std::panic::set_hook(Box::new(|info| {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("C:\\Halt\\dev\\panic_dump.txt")
        {
            let _ = writeln!(file, "=== PANIC DETECTED ===");
            let _ = writeln!(file, "{}", info);
        }
        eprintln!("=== PANIC DETECTED ===");
        eprintln!("{}", info);
    }));

    // (Debug CRT handles and dialog popups no longer conflict since NLLB runs out-of-process)
    // Ensure data directories exist on startup
    storage::ensure_dirs();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Warn)
                .level_for("halt_triage", log::LevelFilter::Debug)
                .level_for("app_lib", log::LevelFilter::Debug)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // Layer 1: Foundation
            commands::health::get_health,
            // Layer 2: Data CRUD
            commands::wards::list_wards,
            commands::wards::get_ward_config,
            commands::wards::save_ward_config,
            commands::wards::delete_ward,
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::claim_task,
            commands::roster::list_roster,
            commands::roster::add_roster_member,
            commands::roster::update_roster_member,
            commands::roster::delete_roster_member,
            commands::roster::upload_avatar,
            commands::roster::get_avatar,
            commands::inventory::get_inventory,
            commands::inventory::get_inventory_locations,
            commands::inventory::add_inventory_location,
            commands::inventory::update_inventory_location,
            commands::inventory::delete_inventory_location,
            commands::inventory::add_inventory_item,
            commands::inventory::delete_inventory_item,
            commands::inventory::consume_inventory,
            commands::inventory::restock_inventory,
            commands::inventory::get_inventory_activity,
            commands::inventory::clear_inventory_activity,
            commands::patients::list_patients,
            commands::patients::create_patient,
            commands::patients::get_patient,
            commands::patients::update_patient,
            commands::patients::add_patient_event,
            commands::patients::update_patient_status,
            commands::patients::delete_patient,
            commands::patients::upload_attachment,
            commands::patients::get_attachment,
            commands::patients::public_patient_lookup,
            commands::patients::patient_snapshot,
            commands::patients::patient_restore,
            // Layer 3: Inference Engines
            commands::inference::list_models,
            commands::inference::inference_queue_status,
            commands::inference::inference_complete,
            commands::inference::inference_stream,
            commands::inference::inference_stop,
            commands::stt::stt_health,
            commands::stt::stt_listen,
            commands::tts::tts_health,
            commands::tts::tts_voices,
            commands::tts::tts_queue_status,
            commands::tts::tts_synthesize,
            commands::tts::tts_synthesize_multi,
            commands::translate::translate_status,
            commands::translate::translate_text,
            commands::translate::translate_batch,
            // Layer 4: Mesh + Real-time
            mesh::server::mesh_status,
            mesh::server::mesh_clients,
            mesh::server::mesh_promote,
            mesh::server::mesh_snapshot,
            mesh::chat::get_chat,
            mesh::chat::send_chat,
            mesh::chat::clear_chat,
            mesh::chat::react_to_message,
            mesh::chat::get_thread,
            mesh::chat::upload_chat_attachment,
            mesh::chat::get_chat_attachment,
            mesh::alerts::mesh_alert,
            mesh::alerts::mesh_emergency,
            mesh::alerts::mesh_announcement,
            mesh::video::active_video_calls,
            // Layer 5: Utilities
            commands::export::export_patient_pdf,
            commands::export::export_patient_html,
            commands::export::shift_report_html,
            commands::qr::public_lookup_qr,
            commands::qr::discharge_qr,
            commands::qr::mesh_qr,
            commands::distribution::distribution_status,
            commands::distribution::distribution_download,
            commands::distribution::distribution_download_all,
            commands::distribution::distribution_checksums,
            commands::distribution::set_checksums,
            commands::setup::setup_status,
            commands::setup::download_ca_pem,
            commands::setup::download_mobileconfig,
            commands::setup::regenerate_certs,
            // Layer 4b: Real-time Translation Pipelines
            mesh::translate_stream::translate_stream_oneshot,
            mesh::translate_stream::translate_stream_live,
            mesh::translate_stream::translate_live_segment,
            mesh::translate_stream::translate_live_health,
            mesh::translate_stream::translate_live_end,
            mesh::translate_stream::call_translate_chunk,
            
            // Layer 6: Platform Telemetry & Diagnostics
            commands::diagnostics::run_neural_sweep,
            commands::diagnostics::run_language_probe,
        ])
        .setup(|app| {
            // Auto-generate/refresh SSL certs for current LAN IP
            match commands::setup::ensure_certs() {
                Ok(status) => {
                    let action = status
                        .get("action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("none");
                    let ip = status.get("ip").and_then(|v| v.as_str()).unwrap_or("?");
                    if action == "regenerated" {
                        log::info!("SSL certs regenerated for {}", ip);
                    } else {
                        log::info!("SSL certs ready for {}", ip);
                    }
                }
                Err(e) => log::warn!("SSL cert setup skipped: {}", e),
            }

            // Spawn native servers on a dedicated tokio runtime
            // (Tauri's setup runs on its own async runtime, not tokio)
            std::thread::spawn(|| {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
                rt.block_on(async {
                    // Mesh WebSocket server on port 7779
                    tokio::spawn(async {
                        mesh::ws_listener::start(7779).await;
                    });

                    // HTTP REST server on port 7778
                    let app = http_server::build_router();
                    let addr = "0.0.0.0:7778";
                    log::info!("HTTP REST server listening on http://{}", addr);
                    let listener = tokio::net::TcpListener::bind(addr)
                        .await
                        .expect("Failed to bind HTTP server");
                    axum::serve(listener, app)
                        .await
                        .expect("HTTP server failed");
                });
            });

            // Python sidecar removed — Phase 5E complete.
            // Native Rust servers now handle all HTTP (port 7779) and WS (port 7778).

            // Sequential model warmup — load models one at a time on a background thread.
            // Each load is wrapped in catch_unwind so a C-level crash in one model
            // doesn't kill the app. Failed models load lazily on first use.
            // Whisper runs as a separate process (halt-whisper:7780) to avoid ggml conflicts.
            std::thread::spawn(|| {
                log::info!("[warmup] Starting sequential model warmup...");

                // Helper: load a model on a dedicated thread with catch_unwind
                fn safe_load<F: FnOnce() + Send + 'static>(name: &str, f: F) {
                    let label = name.to_string();
                    let handle = std::thread::Builder::new()
                        .name(format!("warmup-{}", label))
                        .stack_size(8 * 1024 * 1024)
                        .spawn(move || std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)))
                        .expect("spawn warmup thread");
                    match handle.join() {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => log::warn!("[warmup] {} panicked — will load lazily", label),
                        Err(_) => log::warn!("[warmup] {} thread crashed — will load lazily", label),
                    }
                }

                // 1. Whisper STT — spawns halt-whisper subprocess on port 7780
                safe_load("whisper", || {
                    match models::whisper::ensure_loaded() {
                        Ok(_) => log::info!("[warmup] Whisper STT subprocess ready"),
                        Err(e) => log::warn!("[warmup] Whisper unavailable: {}", e),
                    }
                });

                // 2. NLLB Translation (load BEFORE LLM — ct2rs crashes if loaded after llama.cpp)
                safe_load("nllb", || {
                    match models::nllb::ensure_loaded() {
                        Ok(_) => log::info!("[warmup] NLLB translation loaded"),
                        Err(e) => log::warn!("[warmup] NLLB unavailable: {}", e),
                    }
                });

                // 3. Kokoro TTS (ORT — load before LLM too)
                safe_load("kokoro", || {
                    match models::kokoro::ensure_loaded() {
                        Ok(_) => log::info!("[warmup] Kokoro TTS loaded"),
                        Err(e) => log::warn!("[warmup] Kokoro unavailable: {}", e),
                    }
                });

                // 4. LLM (llama.cpp — load last, its ggml poisons the CRT for other C libs)
                safe_load("llm", || {
                    match models::llm::ensure_loaded() {
                        Ok(_) => log::info!("[warmup] LLM loaded"),
                        Err(e) => log::warn!("[warmup] LLM unavailable: {}", e),
                    }
                });

                // 5. Vision — runs as sidecar (halt-vision on port 7782)
                safe_load("vision", || {
                    match std::net::TcpStream::connect_timeout(
                        &"127.0.0.1:7782".parse().unwrap(),
                        std::time::Duration::from_secs(30),
                    ) {
                        Ok(_) => log::info!("[warmup] Vision sidecar reachable on :7782"),
                        Err(_) => log::info!("[warmup] Vision sidecar not yet ready (will retry on first image)"),
                    }
                });

                log::info!("[warmup] Model warmup complete.");
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {});
}

pub fn benchmark_llm() {
    println!("Starting Rust native_ml benchmark...");
    let start = std::time::Instant::now();
    match models::llm::ensure_loaded() {
        Ok(_) => {
            let load_time = start.elapsed().as_secs_f32();
            println!("Model loaded in {:.2}s", load_time);

            let req = commands::inference::InferenceRequest {
                prompt: "What are the 5 phases of triage?".to_string(),
                system: "You are a combat medic. Keep it very short.".to_string(),
                max_tokens: 128,
                temperature: 0.1,
                persona: "".to_string(),
                stream: false,
                image_b64: None,
            };

            let inf_start = std::time::Instant::now();
            match commands::inference::inference_complete(req) {
                Ok(res) => {
                    let dur = inf_start.elapsed().as_secs_f32();
                    let tps = res.tokens_generated as f32 / dur;
                    println!(
                        "Generated {} tokens in {:.2}s ({:.2} tokens/sec)",
                        res.tokens_generated, dur, tps
                    );
                    println!("Response: {}", res.text.trim());
                }
                Err(e) => println!("Inference failed: {}", e),
            }
        }
        Err(e) => println!("Failed to load model: {}", e),
    }
    models::llm::unload();
}
