//! Commands module — Tauri invoke handlers.
//!
//! Each submodule corresponds to a Python route module.
//! Commands are registered in lib.rs via `tauri::Builder::invoke_handler()`.

pub mod distribution;
pub mod export;
pub mod health;
pub mod inference;
pub mod inventory;
pub mod patients;
pub mod qr;
pub mod roster;
pub mod setup;
pub mod stt;
pub mod tasks;
pub mod translate;
pub mod tts;
pub mod wards;
