use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
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

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| match event {
        RunEvent::Exit => {
            let state = app_handle.state::<BackendProcess>();
            let mut child_guard = state.0.lock().unwrap();
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
            }
        }
        _ => {}
    });
}
