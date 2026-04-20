//! Mesh server — WebSocket hub and client state.
//!
//! Direct translation of the WebSocket handler and state management
//! from `api/routes/mesh.py`.
//!
//! On desktop, this runs a tokio-tungstenite WebSocket server on a port
//! (default 7777). It handles:
//!   - Client registration (set_name, set_role)
//!   - Heartbeat/pong and stale client eviction (30s timeout)
//!   - Message routing: broadcast, unicast by target_name
//!   - Leader election (first connected client or promoted)
//!   - State snapshot for new client sync

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

// ── Client State ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MeshClient {
    pub client_id: String,
    pub name: String,
    pub role: String,
    pub connected_at: String,
    pub last_seen: String,
    pub is_leader: bool,
}

/// Global mesh state — protected by a Mutex.
/// In the full implementation, this will also hold WebSocket sender handles
/// for broadcasting messages.
pub struct MeshState {
    pub clients: HashMap<String, MeshClient>,
    pub leader_id: Option<String>,
}

impl MeshState {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            leader_id: None,
        }
    }
}

static MESH_STATE: Mutex<Option<MeshState>> = Mutex::new(None);

fn with_state<F, R>(f: F) -> R
where
    F: FnOnce(&mut MeshState) -> R,
{
    let mut guard = MESH_STATE.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_none() {
        *guard = Some(MeshState::new());
    }
    f(guard.as_mut().unwrap())
}

/// Get the local IP address for mesh discovery.
/// Direct translation of `_get_local_ip()` from mesh.py.
pub fn get_local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|sock| {
            sock.connect("8.8.8.8:80")?;
            sock.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn mesh_status() -> Value {
    let ip = get_local_ip();
    with_state(|state| {
        serde_json::json!({
            "connected": state.clients.len(),
            "leader": state.leader_id,
            "local_ip": ip,
            "port": 7777,
        })
    })
}

#[tauri::command]
pub fn mesh_clients() -> Vec<MeshClient> {
    with_state(|state| state.clients.values().cloned().collect())
}

#[tauri::command]
pub fn mesh_promote(client_id: String) -> Result<Value, String> {
    with_state(|state| {
        // Demote current leader
        if let Some(ref old_id) = state.leader_id {
            if let Some(old) = state.clients.get_mut(old_id) {
                old.is_leader = false;
            }
        }

        // Promote new leader
        let client = state
            .clients
            .get_mut(&client_id)
            .ok_or_else(|| "Client not found".to_string())?;
        client.is_leader = true;
        state.leader_id = Some(client_id.clone());

        Ok(serde_json::json!({
            "promoted": client_id,
            "role": client.role,
        }))
    })
}

#[tauri::command]
pub fn mesh_snapshot() -> Value {
    with_state(|state| {
        let clients: Vec<Value> = state
            .clients
            .values()
            .map(|c| serde_json::to_value(c).unwrap_or(Value::Null))
            .collect();

        // Include current chat, roster, inventory, tasks state
        let chat = crate::storage::chat_path();
        let chat_data: Vec<Value> = if chat.exists() {
            std::fs::read_to_string(&chat)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        serde_json::json!({
            "clients": clients,
            "leader_id": state.leader_id,
            "chat": chat_data,
        })
    })
}

/// Register a client connection (called from the WebSocket handler).
pub fn register_client(client_id: &str, name: &str, role: &str) {
    let now = chrono::Local::now().to_rfc3339();
    with_state(|state| {
        let is_first = state.clients.is_empty();
        state.clients.insert(
            client_id.to_string(),
            MeshClient {
                client_id: client_id.to_string(),
                name: name.to_string(),
                role: role.to_string(),
                connected_at: now.clone(),
                last_seen: now,
                is_leader: is_first,
            },
        );
        if is_first {
            state.leader_id = Some(client_id.to_string());
        }
    });
}

/// Remove a disconnected client and re-elect leader if needed.
pub fn unregister_client(client_id: &str) {
    with_state(|state| {
        state.clients.remove(client_id);
        if state.leader_id.as_deref() == Some(client_id) {
            // Re-elect: first remaining client becomes leader
            state.leader_id = state.clients.keys().next().cloned();
            if let Some(ref id) = state.leader_id {
                if let Some(c) = state.clients.get_mut(id) {
                    c.is_leader = true;
                }
            }
        }
    });
}

/// Update last_seen timestamp for heartbeat.
pub fn heartbeat(client_id: &str) {
    let now = chrono::Local::now().to_rfc3339();
    with_state(|state| {
        if let Some(client) = state.clients.get_mut(client_id) {
            client.last_seen = now;
        }
    });
}

/// Evict stale clients (no heartbeat in 30 seconds).
/// Called periodically from a background task.
pub fn evict_stale() -> Vec<String> {
    let cutoff = chrono::Local::now() - chrono::Duration::seconds(30);
    let cutoff_str = cutoff.to_rfc3339();

    with_state(|state| {
        let stale: Vec<String> = state
            .clients
            .iter()
            .filter(|(_, c)| c.last_seen < cutoff_str)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &stale {
            state.clients.remove(id);
            log::info!("Evicted stale client: {}", id);
        }

        // Re-elect if leader was evicted
        if let Some(ref lid) = state.leader_id {
            if stale.contains(lid) {
                state.leader_id = state.clients.keys().next().cloned();
                if let Some(ref id) = state.leader_id {
                    if let Some(c) = state.clients.get_mut(id) {
                        c.is_leader = true;
                    }
                }
            }
        }

        stale
    })
}
