mod config;
mod storage;
mod commands;
mod models;
mod mesh;

use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Ensure data directories exist on startup
  storage::ensure_dirs();

  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::new().build())
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
    ])
    .setup(|app| {
      // Python sidecar — desktop only (iOS cannot run Python)
      #[cfg(not(target_os = "ios"))]
      {
          use std::process::Command;

          let mut cmd = if cfg!(windows) {
              Command::new("python")
          } else {
              Command::new("python3")
          };

          // Spawn the backend API orchestrator as a headless sidecar
          match cmd.args(["../../start.py", "--no-browser"]).spawn() {
              Ok(child) => {
                  app.manage(BackendProcess(Mutex::new(Some(child))));
              }
              Err(e) => {
                  eprintln!("Failed to start python backend: {}", e);
              }
          }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| match event {
        RunEvent::Exit => {
            #[cfg(not(target_os = "ios"))]
            {
                if let Some(state) = app_handle.try_state::<BackendProcess>() {
                    let mut child_guard = state.0.lock().unwrap();
                    if let Some(mut child) = child_guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
        _ => {}
    });
}
