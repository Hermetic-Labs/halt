//! Commands module — Tauri invoke handlers.
//!
//! Each submodule corresponds to a Python route module.
//! Commands are registered in lib.rs via `tauri::Builder::invoke_handler()`.

pub mod health;
pub mod wards;
pub mod tasks;
pub mod roster;
pub mod inventory;
pub mod patients;
pub mod inference;
pub mod stt;
pub mod tts;
pub mod translate;
pub mod export;
pub mod qr;
pub mod distribution;
pub mod setup;
