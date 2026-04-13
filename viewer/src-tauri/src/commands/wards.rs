//! Wards — CRUD for ward layout configurations.
//!
//! Direct translation of `api/routes/wards.py`.
//!
//! Each ward defines a name, column count, and list of room IDs (e.g. R01–R20).
//! Patients are assigned to wards + rooms during intake. The ward board UI
//! renders these as a grid for quick visual triage status at a glance.
//! Legacy migration: single ward_config.json → multi-ward _wards.json.

use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WardConfig {
    pub id: String,
    pub name: String,
    pub columns: i32,
    pub rooms: Vec<String>,
}

impl Default for WardConfig {
    fn default() -> Self {
        Self {
            id: "ward-1".to_string(),
            name: "Ward Alpha".to_string(),
            columns: 4,
            rooms: (1..=20).map(|i| format!("R{:02}", i)).collect(),
        }
    }
}

/// Load all wards, migrating from legacy single-ward config if needed.
fn load_wards() -> Vec<WardConfig> {
    let path = storage::wards_path();
    if path.exists() {
        if let Ok(val) = storage::read_json(&path) {
            if let Ok(wards) = serde_json::from_value::<Vec<WardConfig>>(val) {
                return wards;
            }
        }
    }

    // Legacy migration: check single ward_config.json
    let legacy = storage::ward_config_path();
    let default_ward = if legacy.exists() {
        if let Ok(val) = storage::read_json(&legacy) {
            let mut ward: WardConfig = serde_json::from_value(val).unwrap_or_default();
            ward.id = "ward-1".to_string();
            ward
        } else {
            WardConfig::default()
        }
    } else {
        WardConfig::default()
    };

    let wards = vec![default_ward];
    let val = serde_json::to_value(&wards).unwrap_or(Value::Array(vec![]));
    let _ = storage::write_json(&path, &val);
    wards
}

#[tauri::command]
pub fn list_wards() -> Vec<WardConfig> {
    load_wards()
}

#[tauri::command]
pub fn get_ward_config(id: Option<String>) -> WardConfig {
    let target_id = id.unwrap_or_else(|| "ward-1".to_string());
    let wards = load_wards();
    wards
        .into_iter()
        .find(|w| w.id == target_id)
        .unwrap_or_else(|| WardConfig {
            id: target_id.clone(),
            name: format!("New Ward {}", target_id),
            ..Default::default()
        })
}

#[tauri::command]
pub fn save_ward_config(config: WardConfig, id: Option<String>) -> Result<WardConfig, String> {
    let target_id = id.unwrap_or_else(|| "ward-1".to_string());
    let mut config = config;
    config.id = target_id.clone();

    let mut wards = load_wards();
    let mut found = false;
    for w in &mut wards {
        if w.id == target_id {
            *w = config.clone();
            found = true;
            break;
        }
    }
    if !found {
        wards.push(config.clone());
    }

    let val = serde_json::to_value(&wards).map_err(|e| e.to_string())?;
    storage::write_json(&storage::wards_path(), &val)?;
    Ok(config)
}

#[tauri::command]
pub fn delete_ward(id: String) -> Result<serde_json::Value, String> {
    let wards = load_wards();
    let initial_len = wards.len();
    let filtered: Vec<WardConfig> = wards.into_iter().filter(|w| w.id != id).collect();

    if filtered.len() == initial_len {
        return Err("Ward not found".to_string());
    }

    let val = serde_json::to_value(&filtered).map_err(|e| e.to_string())?;
    storage::write_json(&storage::wards_path(), &val)?;
    Ok(serde_json::json!({"status": "ok", "deleted": id}))
}
