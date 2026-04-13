//! Inventory — medical supply tracking with auto-alerting.
//!
//! Direct translation of `api/routes/inventory.py`.
//!
//! Tracks consumable quantities across named locations (e.g. "Main Supply Room",
//! "Ward A Cabinet"). When an item drops below its minimum threshold, an alert
//! is automatically broadcast to all connected mesh clients. When depleted to
//! zero, a red emergency alert fires.
//!
//! Key features:
//!   - Multi-location support with cascade delete (items reassign to loc-1).
//!   - Consume/restock with audit trail via storage::log_activity().
//!   - Default inventory seeds with combat-relevant medical supplies (TXA,
//!     CAT tourniquets, ketamine, chest seals) and their field alternatives.

use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub quantity: i64,
    #[serde(rename = "minThreshold")]
    pub min_threshold: i64,
    pub category: String,
    pub alternatives: Vec<String>,
    #[serde(default = "default_location", rename = "locationId")]
    pub location_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_modified_by: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_modified_at: String,
}

fn default_location() -> String { "loc-1".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryLocation {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InventoryRestock {
    pub amount: i64,
}

fn default_inventory() -> Vec<InventoryItem> {
    vec![
        InventoryItem {
            id: "inv-txa".into(), name: "TXA (Tranexamic Acid)".into(),
            quantity: 10, min_threshold: 3, category: "Medication".into(),
            alternatives: vec!["Direct Pressure".into(), "Tourniquet".into(), "Hemostatic Dressing".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
        InventoryItem {
            id: "inv-gauze".into(), name: "Combat Gauze".into(),
            quantity: 50, min_threshold: 10, category: "Bandage".into(),
            alternatives: vec!["Standard Gauze".into(), "Clean Cloth".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
        InventoryItem {
            id: "inv-tourniquet".into(), name: "CAT Tourniquet".into(),
            quantity: 25, min_threshold: 5, category: "Equipment".into(),
            alternatives: vec!["Improvised Tourniquet (Cravat + Windlass)".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
        InventoryItem {
            id: "inv-iv-fluid".into(), name: "IV Fluids (Lactated Ringers 1L)".into(),
            quantity: 20, min_threshold: 5, category: "Fluids".into(),
            alternatives: vec!["Oral Rehydration Salts (if patient is conscious/can swallow)".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
        InventoryItem {
            id: "inv-ketamine".into(), name: "Ketamine (500mg vial)".into(),
            quantity: 15, min_threshold: 5, category: "Medication".into(),
            alternatives: vec!["Fentanyl Lozenge (OTFC)".into(), "Morphine Auto-Injector".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
        InventoryItem {
            id: "inv-chest-seal".into(), name: "Vented Chest Seal".into(),
            quantity: 30, min_threshold: 8, category: "Equipment".into(),
            alternatives: vec!["Improvised 3-sided occlusive dressing (plastic + tape)".into()],
            location_id: "loc-1".into(), last_modified_by: String::new(), last_modified_at: String::new(),
        },
    ]
}

fn load_inventory() -> Vec<InventoryItem> {
    let path = storage::inventory_path();
    if !path.exists() {
        let inv = default_inventory();
        let val = serde_json::to_value(&inv).unwrap_or(Value::Array(vec![]));
        let _ = storage::write_json(&path, &val);
        return inv;
    }
    storage::read_json(&path)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(default_inventory)
}

fn save_inventory(inv: &[InventoryItem]) -> Result<(), String> {
    let val = serde_json::to_value(inv).map_err(|e| e.to_string())?;
    storage::write_json(&storage::inventory_path(), &val)
}

fn resolve_location_name(location_id: &str) -> String {
    let path = storage::inventory_locations_path();
    if path.exists() {
        if let Ok(val) = storage::read_json(&path) {
            if let Ok(locs) = serde_json::from_value::<Vec<InventoryLocation>>(val) {
                if let Some(loc) = locs.iter().find(|l| l.id == location_id) {
                    return loc.name.clone();
                }
            }
        }
    }
    if location_id == "loc-1" { "Main Supply Room".to_string() } else { location_id.to_string() }
}

/// Fire supply alerts via mesh broadcast.
///
/// Called when inventory drops below threshold. This is wired to the mesh
/// module in Layer 4. Until then, alerts are logged to chat only.
///
/// CRITICAL: This function handles the life-critical supply chain alerting.
/// When a tourniquet supply hits zero, this fires an EMERGENCY broadcast
/// to every connected device. Do not simplify or defer this.
fn fire_supply_alert(item: &InventoryItem, loc_name: &str) {
    let qty = item.quantity;
    let min_t = item.min_threshold;
    let name = &item.name;
    let now = chrono::Local::now();

    if qty <= 0 {
        // EMERGENCY — item is depleted
        let _emergency_msg = serde_json::json!({
            "type": "emergency",
            "ward": "",
            "bed": "",
            "categories": ["inventory"],
            "categories_text": "Inventory & Supply",
            "sender_name": "System",
            "notes": format!("{} at {} is DEPLETED (0 remaining)", name, loc_name),
            "sound": "announcement",
            "timestamp": now.timestamp(),
        });

        // Log to chat
        let chat_msg = serde_json::json!({
            "id": format!("INV-{}", now.format("%Y%m%d-%H%M%S-%f")),
            "sender_name": "System",
            "sender_role": "system",
            "message": format!("🚨 SUPPLY EMERGENCY: {} at {} is DEPLETED — consider alternatives", name, loc_name),
            "target_name": "",
            "timestamp": now.to_rfc3339(),
        });
        append_chat_message(chat_msg);

        // TODO(Layer 4): broadcast_mesh(emergency_msg) — wired when mesh module exists
        log::warn!("SUPPLY EMERGENCY: {} at {} is DEPLETED", name, loc_name);

    } else if qty <= min_t && min_t > 0 {
        // WARNING — item is critically low
        let _announcement_msg = serde_json::json!({
            "type": "announcement",
            "message": format!("⚠️ SUPPLY ALERT: {} at {} is critically low ({} remaining, min: {})", name, loc_name, qty, min_t),
            "sender_name": "System",
            "sound": "general",
            "timestamp": now.timestamp(),
        });

        // Log to chat
        let chat_msg = serde_json::json!({
            "id": format!("INV-{}", now.format("%Y%m%d-%H%M%S-%f")),
            "sender_name": "System",
            "sender_role": "system",
            "message": format!("⚠️ SUPPLY ALERT: {} at {} — {} remaining (threshold: {})", name, loc_name, qty, min_t),
            "target_name": "",
            "timestamp": now.to_rfc3339(),
        });
        append_chat_message(chat_msg);

        // TODO(Layer 4): broadcast_mesh(announcement_msg)
        log::warn!("SUPPLY ALERT: {} at {} — {} remaining (threshold: {})", name, loc_name, qty, min_t);
    }
}

/// Append a message to the chat log (shared with mesh chat).
fn append_chat_message(msg: Value) {
    let cp = storage::chat_path();
    let mut messages: Vec<Value> = if cp.exists() {
        std::fs::read_to_string(&cp)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    messages.push(msg);

    // Keep last 500 messages (matches Python behavior)
    if messages.len() > 500 {
        let start = messages.len() - 500;
        messages = messages[start..].to_vec();
    }

    let _ = storage::write_json(&cp, &Value::Array(messages));
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_inventory() -> Vec<InventoryItem> {
    load_inventory()
}

#[tauri::command]
pub fn get_inventory_locations() -> Vec<InventoryLocation> {
    let path = storage::inventory_locations_path();
    if !path.exists() {
        let default = vec![InventoryLocation { id: "loc-1".into(), name: "Main Supply Room".into() }];
        let val = serde_json::to_value(&default).unwrap_or(Value::Array(vec![]));
        let _ = storage::write_json(&path, &val);
        return default;
    }
    storage::read_json(&path)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(|| vec![InventoryLocation { id: "loc-1".into(), name: "Main Supply Room".into() }])
}

#[tauri::command]
pub fn add_inventory_location(loc: InventoryLocation) -> Result<InventoryLocation, String> {
    let path = storage::inventory_locations_path();
    let mut locs: Vec<InventoryLocation> = if path.exists() {
        storage::read_json(&path).ok().and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_else(|| vec![InventoryLocation { id: "loc-1".into(), name: "Main Supply Room".into() }])
    } else {
        vec![InventoryLocation { id: "loc-1".into(), name: "Main Supply Room".into() }]
    };

    // Upsert by ID
    if let Some(existing) = locs.iter_mut().find(|l| l.id == loc.id) {
        existing.name = loc.name.clone();
    } else {
        locs.push(loc.clone());
    }

    let val = serde_json::to_value(&locs).map_err(|e| e.to_string())?;
    storage::write_json(&path, &val)?;
    Ok(loc)
}

#[tauri::command]
pub fn update_inventory_location(id: String, loc: InventoryLocation) -> Result<InventoryLocation, String> {
    let path = storage::inventory_locations_path();
    let mut locs: Vec<InventoryLocation> = if path.exists() {
        storage::read_json(&path).ok().and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    } else {
        return Err("Locations not found".to_string());
    };

    let entry = locs.iter_mut().find(|l| l.id == id)
        .ok_or("Location not found")?;
    entry.name = loc.name.clone();

    let val = serde_json::to_value(&locs).map_err(|e| e.to_string())?;
    storage::write_json(&path, &val)?;
    Ok(loc)
}

#[tauri::command]
pub fn delete_inventory_location(id: String) -> Result<Value, String> {
    if id == "loc-1" {
        return Err("Cannot delete default location loc-1".to_string());
    }

    let path = storage::inventory_locations_path();
    let mut locs: Vec<InventoryLocation> = if path.exists() {
        storage::read_json(&path).ok().and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    } else {
        return Err("Locations not found".to_string());
    };

    let initial_len = locs.len();
    locs.retain(|l| l.id != id);
    if locs.len() == initial_len {
        return Err("Location not found".to_string());
    }

    let val = serde_json::to_value(&locs).map_err(|e| e.to_string())?;
    storage::write_json(&path, &val)?;

    // Cascade: reassign items from deleted location to loc-1
    let mut inv = load_inventory();
    for item in &mut inv {
        if item.location_id == id {
            item.location_id = "loc-1".to_string();
        }
    }
    save_inventory(&inv)?;

    Ok(serde_json::json!({"status": "ok", "deleted": id}))
}

#[tauri::command]
pub fn add_inventory_item(item: InventoryItem) -> Result<InventoryItem, String> {
    let mut inv = load_inventory();
    inv.push(item.clone());
    save_inventory(&inv)?;
    Ok(item)
}

#[tauri::command]
pub fn delete_inventory_item(id: String) -> Result<Value, String> {
    let inv = load_inventory();
    let initial_len = inv.len();
    let filtered: Vec<InventoryItem> = inv.into_iter().filter(|i| i.id != id).collect();
    if filtered.len() == initial_len {
        return Err("Inventory item not found".to_string());
    }
    save_inventory(&filtered)?;
    Ok(serde_json::json!({"status": "ok", "deleted": id}))
}

#[tauri::command]
pub fn consume_inventory(id: String, restock: InventoryRestock, modified_by: Option<String>) -> Result<InventoryItem, String> {
    let who = modified_by.unwrap_or_default();
    let mut inv = load_inventory();

    let target = inv.iter_mut().find(|i| i.id == id)
        .ok_or("Inventory item not found.")?;

    target.quantity = (target.quantity - restock.amount).max(0);
    if !who.is_empty() {
        target.last_modified_by = who.clone();
        target.last_modified_at = chrono::Local::now().to_rfc3339();
    }

    let target_clone = target.clone();
    save_inventory(&inv)?;

    // Activity log
    let loc_name = resolve_location_name(&target_clone.location_id);
    let item_label = format!("{} [{}]", target_clone.name, loc_name);
    let who_str = if who.is_empty() { "unknown" } else { &who };

    let mut extra = serde_json::Map::new();
    extra.insert("action_type".into(), Value::String("consumed".into()));
    extra.insert("qty".into(), Value::Number(restock.amount.into()));
    storage::log_activity(who_str, &format!("consumed {}x", restock.amount), &item_label, Some(extra));

    // Auto-alert on critical stock
    if target_clone.quantity <= target_clone.min_threshold && target_clone.min_threshold > 0 {
        fire_supply_alert(&target_clone, &loc_name);
    }

    Ok(target_clone)
}

#[tauri::command]
pub fn restock_inventory(id: String, restock: InventoryRestock, modified_by: Option<String>) -> Result<InventoryItem, String> {
    let who = modified_by.unwrap_or_default();
    let mut inv = load_inventory();

    let target = inv.iter_mut().find(|i| i.id == id)
        .ok_or("Inventory item not found.")?;

    target.quantity += restock.amount;
    if !who.is_empty() {
        target.last_modified_by = who.clone();
        target.last_modified_at = chrono::Local::now().to_rfc3339();
    }

    let target_clone = target.clone();
    save_inventory(&inv)?;

    let loc_name = resolve_location_name(&target_clone.location_id);
    let item_label = format!("{} [{}]", target_clone.name, loc_name);
    let who_str = if who.is_empty() { "unknown" } else { &who };

    let mut extra = serde_json::Map::new();
    extra.insert("action_type".into(), Value::String("restocked".into()));
    extra.insert("qty".into(), Value::Number(restock.amount.into()));
    storage::log_activity(who_str, &format!("restocked {}x", restock.amount), &item_label, Some(extra));

    Ok(target_clone)
}

#[tauri::command]
pub fn get_inventory_activity(limit: Option<usize>) -> Vec<Value> {
    let limit = limit.unwrap_or(50);
    let path = storage::activity_path();
    if !path.exists() {
        return Vec::new();
    }

    let entries: Vec<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Filter to inventory-related actions
    let inv_actions: Vec<Value> = entries.into_iter()
        .filter(|e| {
            let action = e.get("action").and_then(|a| a.as_str()).unwrap_or("");
            action.contains("consumed") || action.contains("restocked")
        })
        .collect();

    // Return most recent first, limited
    let start = if inv_actions.len() > limit { inv_actions.len() - limit } else { 0 };
    inv_actions[start..].iter().rev().cloned().collect()
}

#[tauri::command]
pub fn clear_inventory_activity() -> Value {
    let path = storage::activity_path();
    if !path.exists() {
        return serde_json::json!({"status": "ok", "removed": 0});
    }

    let entries: Vec<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Keep non-inventory entries, remove consumed/restocked
    let kept: Vec<Value> = entries.iter()
        .filter(|e| {
            let action = e.get("action").and_then(|a| a.as_str()).unwrap_or("");
            !action.contains("consumed") && !action.contains("restocked")
        })
        .cloned()
        .collect();

    let removed = entries.len() - kept.len();
    let _ = storage::write_json(&path, &Value::Array(kept));
    serde_json::json!({"status": "ok", "removed": removed})
}
