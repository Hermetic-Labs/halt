//! Centralized configuration for the HALT triage system.
//!
//! Direct translation of `api/config.py`.
//! Resolves MODELS_DIR and DATA_DIR from environment variables,
//! falling back to `<project_root>/models` and `<project_root>/patients`.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Resolve the project root relative to the compiled binary.
///
/// In the Tauri layout:
///   - Dev:     `viewer/src-tauri/target/debug/halt-triage` → root is `../../..` from exe dir
///   - Release: binary is bundled, so we fall back to exe parent or env vars
///
/// The env vars `HALT_MODELS_DIR` and `HALT_DATA_DIR` always take priority,
/// making this resolution a fallback for bare dev runs only.
fn project_root() -> PathBuf {
    // iOS: no project root — use the app's home directory.
    // Tauri's setup hook should set HALT_DATA_DIR / HALT_MODELS_DIR,
    // but this is the safety net if env vars aren't set.
    #[cfg(target_os = "ios")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let docs = PathBuf::from(home).join("Documents").join("HALT");
            let _ = std::fs::create_dir_all(&docs);
            return docs;
        }
        return PathBuf::from(".");
    }

    // Desktop: walk up from exe looking for project root
    #[cfg(not(target_os = "ios"))]
    {
        if let Ok(exe) = std::env::current_exe() {
            let mut dir = exe.parent().map(|p| p.to_path_buf());
            for _ in 0..6 {
                if let Some(ref d) = dir {
                    if d.join("models").is_dir() || d.join("api").is_dir() {
                        return d.clone();
                    }
                    dir = d.parent().map(|p| p.to_path_buf());
                }
            }
        }
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }
}

static PROJECT_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Directory containing AI models (GGUF, ONNX, Whisper, NLLB).
///
/// Resolved from `HALT_MODELS_DIR` env var, falling back to `<project>/models`.
pub fn models_dir() -> PathBuf {
    match std::env::var("HALT_MODELS_DIR") {
        Ok(val) if !val.is_empty() => PathBuf::from(val),
        _ => {
            let root = PROJECT_ROOT.get_or_init(project_root);
            root.join("models")
        }
    }
}

/// Directory for patient records, inventory, roster, and other persistent data.
///
/// Resolved from `HALT_DATA_DIR` env var, falling back to `<project>/patients`.
pub fn data_dir() -> PathBuf {
    match std::env::var("HALT_DATA_DIR") {
        Ok(val) if !val.is_empty() => PathBuf::from(val),
        _ => {
            let root = PROJECT_ROOT.get_or_init(project_root);
            root.join("patients")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_dir_fallback() {
        // Without env var, should return a path ending in "models"
        std::env::remove_var("HALT_MODELS_DIR");
        let dir = models_dir();
        assert!(dir.to_string_lossy().ends_with("models"));
    }

    #[test]
    fn data_dir_fallback() {
        std::env::remove_var("HALT_DATA_DIR");
        let dir = data_dir();
        assert!(dir.to_string_lossy().ends_with("patients"));
    }

    #[test]
    fn env_var_override() {
        std::env::set_var("HALT_MODELS_DIR", "/custom/models");
        assert_eq!(models_dir(), PathBuf::from("/custom/models"));
        std::env::remove_var("HALT_MODELS_DIR");
    }
}
