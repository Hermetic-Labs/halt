//! Roster — team member management with skills tracking and avatar upload.
//!
//! Direct translation of `api/routes/roster.py`.
//!
//! Tracks medical team members (leader, medic, responder) with skill tags
//! (IV, splinting, airway) and online status. Members start as 'pending'
//! on roster add and transition to 'connected' when they join via the
//! mesh WebSocket. Avatars are stored as .webp files on disk.

use crate::storage;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterMember {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_role")]
    pub role: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default = "default_member_status")]
    pub status: String,
    #[serde(default)]
    pub assigned_task: String,
    #[serde(default)]
    pub joined_at: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub avatar_url: String,
}

fn default_role() -> String { "responder".to_string() }
fn default_member_status() -> String { "available".to_string() }

fn avatar_path(member_id: &str) -> std::path::PathBuf {
    storage::avatar_dir().join(format!("{}.webp", member_id))
}

/// Enrich a member dict with avatar_url if the file exists.
fn enrich_with_avatar(member: &mut RosterMember) {
    if avatar_path(&member.id).exists() {
        member.avatar_url = format!("/api/roster/{}/avatar", member.id);
    } else {
        member.avatar_url = String::new();
    }
}

fn load_roster() -> Vec<RosterMember> {
    let path = storage::roster_path();
    if !path.exists() {
        return Vec::new();
    }
    storage::read_json(&path)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_roster(roster: &[RosterMember]) -> Result<(), String> {
    let val = serde_json::to_value(roster).map_err(|e| e.to_string())?;
    storage::write_json(&storage::roster_path(), &val)
}

#[tauri::command]
pub fn list_roster() -> Vec<RosterMember> {
    let mut roster = load_roster();
    for m in &mut roster {
        enrich_with_avatar(m);
    }
    roster
}

/// Add or update a roster member (upsert by name).
///
/// If a member with the same name already exists, update their role/skills/status
/// instead of creating a duplicate. Preserves the original id and joined_at so
/// avatars and history aren't lost on reconnect.
#[tauri::command]
pub fn add_roster_member(member: RosterMember) -> Result<RosterMember, String> {
    let mut roster = load_roster();

    // Check for existing member by name (case-insensitive)
    let existing_idx = roster.iter().position(|m| {
        m.name.trim().to_lowercase() == member.name.trim().to_lowercase()
    });

    if let Some(idx) = existing_idx {
        let existing = &mut roster[idx];
        existing.role = member.role;
        if !member.skills.is_empty() {
            existing.skills = member.skills;
        }
        existing.status = if member.status == "online" {
            "connected".to_string()
        } else {
            member.status
        };
        if !member.notes.is_empty() {
            existing.notes = member.notes;
        }
        // Update client id if provided (reconnect with new node id)
        if !member.id.is_empty() && member.id != existing.id {
            existing.id = member.id;
        }

        storage::log_activity(&existing.name, "reconnected to roster", &existing.role, None);

        let mut result = existing.clone();
        enrich_with_avatar(&mut result);
        save_roster(&roster)?;
        Ok(result)
    } else {
        // New member
        let mut new_member = member;
        if new_member.id.is_empty() {
            new_member.id = format!("R-{}", chrono::Local::now().format("%Y%m%d-%H%M%S"));
        }
        if new_member.joined_at.is_empty() {
            new_member.joined_at = chrono::Local::now().to_rfc3339();
        }
        new_member.status = "pending".to_string();

        storage::log_activity(&new_member.name, "joined roster", &new_member.role, None);

        enrich_with_avatar(&mut new_member);
        roster.push(new_member.clone());
        save_roster(&roster)?;
        Ok(new_member)
    }
}

#[tauri::command]
pub fn update_roster_member(member_id: String, mut member: RosterMember) -> Result<RosterMember, String> {
    let mut roster = load_roster();

    let idx = roster.iter().position(|m| m.id == member_id)
        .ok_or_else(|| format!("Member {} not found", member_id))?;

    member.id = member_id;
    enrich_with_avatar(&mut member);
    roster[idx] = member.clone();
    save_roster(&roster)?;
    Ok(member)
}

#[tauri::command]
pub fn delete_roster_member(member_id: String) -> Result<Value, String> {
    let roster = load_roster();
    let filtered: Vec<RosterMember> = roster.into_iter()
        .filter(|m| m.id != member_id)
        .collect();
    save_roster(&filtered)?;

    // Clean up avatar file
    let av = avatar_path(&member_id);
    if av.exists() {
        let _ = fs::remove_file(&av);
    }

    storage::log_activity("system", "removed from roster", &member_id, None);
    Ok(serde_json::json!({"deleted": member_id}))
}

/// Upload an avatar image for a roster member. Stored as webp.
#[tauri::command]
pub fn upload_avatar(member_id: String, data: Vec<u8>) -> Result<Value, String> {
    let roster = load_roster();
    if !roster.iter().any(|m| m.id == member_id) {
        return Err(format!("Member {} not found", member_id));
    }

    let _ = fs::create_dir_all(storage::avatar_dir());
    let av = avatar_path(&member_id);
    fs::write(&av, &data)
        .map_err(|e| format!("Failed to write avatar: {}", e))?;

    Ok(serde_json::json!({"avatar_url": format!("/api/roster/{}/avatar", member_id)}))
}

/// Retrieve the avatar bytes for a roster member.
#[tauri::command]
pub fn get_avatar(member_id: String) -> Result<Vec<u8>, String> {
    let av = avatar_path(&member_id);
    if !av.exists() {
        return Err("No avatar found".to_string());
    }
    fs::read(&av).map_err(|e| format!("Failed to read avatar: {}", e))
}
