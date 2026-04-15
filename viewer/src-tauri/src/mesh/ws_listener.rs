//! Mesh WebSocket listener — native tokio-tungstenite server.
//!
//! Direct replacement for the Python WebSocket handler in `mesh.py`.
//!
//! Listens on port 7778 (same as the Python sidecar) and handles:
//!   - Client registration (set_name)
//!   - Heartbeat ping/pong with leader heartbeat broadcast
//!   - Patient update/create broadcast
//!   - WebRTC call signaling relay
//!   - Client join/leave notifications
//!   - Stale client eviction (60s timeout)
//!
//! All state is managed via `mesh/server.rs` primitives.

use crate::config;
use crate::mesh::server;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message;

type WsSender =
    futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, Message>;

/// Active WebSocket writers keyed by client_id.
type WsClients = Arc<RwLock<HashMap<String, Arc<Mutex<WsSender>>>>>;

/// Global reference to WsClients so alerts/chat can broadcast from Tauri commands.
static GLOBAL_CLIENTS: std::sync::OnceLock<WsClients> = std::sync::OnceLock::new();

/// Broadcast a JSON payload to all connected WebSocket clients.
/// Safe to call from sync context — spawns the async send on the tokio runtime.
pub fn broadcast_message(msg: Value) {
    let Some(clients) = GLOBAL_CLIENTS.get().cloned() else { return };
    // Use tokio::spawn to run the async broadcast from sync code
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            broadcast(&clients, &msg, None).await;
        });
    }
}

/// Start the mesh WebSocket server on the given port.
/// Called from lib.rs during app setup.
pub async fn start(port: u16) {
    let addr = format!("0.0.0.0:{}", port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Mesh WS: failed to bind {}: {}", addr, e);
            return;
        }
    };
    log::info!("Mesh WS server listening on ws://{}", addr);

    let clients: WsClients = Arc::new(RwLock::new(HashMap::new()));
    let _ = GLOBAL_CLIENTS.set(clients.clone());

    // Spawn background stale eviction
    {
        let clients = clients.clone();
        tokio::spawn(async move {
            stale_checker(clients).await;
        });
    }

    // Accept loop
    loop {
        let (stream, peer_addr) = match listener.accept().await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Mesh WS: accept error: {}", e);
                continue;
            }
        };

        let clients = clients.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, peer_addr.to_string(), clients).await {
                log::debug!("Mesh WS: connection ended: {}", e);
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    peer_addr: String,
    clients: WsClients,
) -> Result<(), String> {
    use futures_util::{SinkExt, StreamExt};

    let ws_stream = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("WS handshake failed: {}", e))?;

    let (ws_sender, mut ws_receiver) = ws_stream.split();
    let ws_sender = Arc::new(Mutex::new(ws_sender));

    // Generate client_id from peer address
    let client_id = format!("ws-{}", peer_addr.replace([':', '.'], "-"));
    log::info!("Mesh WS: client connected: {} ({})", client_id, peer_addr);

    // Register
    server::register_client(&client_id, "Volunteer", "responder");
    clients
        .write()
        .await
        .insert(client_id.clone(), ws_sender.clone());

    // Send initial sync
    let sync_msg = build_sync_message();
    if let Ok(json) = serde_json::to_string(&sync_msg) {
        let _ = ws_sender.lock().await.send(Message::Text(json)).await;
    }

    // Broadcast client_joined
    let join_msg = serde_json::json!({
        "type": "client_joined",
        "client_id": &client_id,
        "name": "Volunteer",
        "clients": clients.read().await.len(),
    });
    broadcast(&clients, &join_msg, Some(&client_id)).await;

    // Message loop
    loop {
        let msg = tokio::select! {
            msg = ws_receiver.next() => msg,
            _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {
                // Send server-side ping
                server::heartbeat(&client_id);
                let ping = serde_json::json!({"type": "ping"});
                if let Ok(json) = serde_json::to_string(&ping) {
                    let send_result = ws_sender.lock().await.send(Message::Text(json)).await;
                    if send_result.is_err() {
                        break;
                    }
                }
                continue;
            }
        };

        match msg {
            Some(Ok(Message::Text(text))) => {
                server::heartbeat(&client_id);

                let data: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let msg_type = data.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match msg_type {
                    "ping" => {
                        let pong = serde_json::json!({
                            "type": "pong",
                            "timestamp": chrono::Local::now().timestamp(),
                        });
                        if let Ok(json) = serde_json::to_string(&pong) {
                            let _ = ws_sender.lock().await.send(Message::Text(json)).await;
                        }
                    }

                    "set_name" => {
                        let name = data
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Volunteer");
                        let role = data
                            .get("role")
                            .and_then(|v| v.as_str())
                            .unwrap_or("responder");
                        server::register_client(&client_id, name, role);
                        log::info!("Mesh WS: {} set name='{}' role='{}'", client_id, name, role);
                    }

                    "patient_updated" | "patient_created" => {
                        let fwd = serde_json::json!({
                            "type": msg_type,
                            "patient": data.get("patient"),
                            "source": &client_id,
                        });
                        broadcast(&clients, &fwd, Some(&client_id)).await;
                    }

                    "call_request" | "call_accept" | "call_reject" | "call_end" => {
                        let target_name = data
                            .get("target_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let caller_name = data
                            .get("caller_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown");

                        let fwd = serde_json::json!({
                            "type": msg_type,
                            "caller_name": caller_name,
                            "caller_role": data.get("caller_role").and_then(|v| v.as_str()).unwrap_or("responder"),
                            "target_name": target_name,
                            "call_type": data.get("call_type").and_then(|v| v.as_str()).unwrap_or("voice"),
                            "timestamp": chrono::Local::now().timestamp(),
                        });
                        send_to_name(&clients, target_name, &fwd).await;
                    }

                    "webrtc_offer" | "webrtc_answer" | "webrtc_ice" => {
                        let target_name = data
                            .get("target_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        // Forward full payload for WebRTC (SDP/ICE data)
                        let mut fwd = data.clone();
                        fwd.as_object_mut().map(|m| {
                            m.insert(
                                "timestamp".to_string(),
                                Value::Number(chrono::Local::now().timestamp().into()),
                            )
                        });
                        send_to_name(&clients, target_name, &fwd).await;
                    }

                    _ => {
                        log::debug!(
                            "Mesh WS: unknown message type '{}' from {}",
                            msg_type,
                            client_id
                        );
                    }
                }
            }

            Some(Ok(Message::Close(_))) | None => break,

            Some(Ok(Message::Ping(payload))) => {
                let _ = ws_sender.lock().await.send(Message::Pong(payload)).await;
            }

            Some(Err(e)) => {
                log::debug!("Mesh WS: receive error from {}: {}", client_id, e);
                break;
            }

            _ => {} // Binary, Pong, Frame — ignore
        }
    }

    // Cleanup on disconnect
    clients.write().await.remove(&client_id);
    server::unregister_client(&client_id);

    let leave_msg = serde_json::json!({
        "type": "client_left",
        "client_id": &client_id,
        "clients": clients.read().await.len(),
    });
    broadcast(&clients, &leave_msg, None).await;

    log::info!("Mesh WS: client disconnected: {}", client_id);
    Ok(())
}

/// Build initial sync message with patient list.
fn build_sync_message() -> Value {
    let data_dir = config::data_dir();
    let mut patients: Vec<Value> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("PAT-") && n.ends_with(".json"))
                .unwrap_or(false)
            {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(patient) = serde_json::from_str::<Value>(&content) {
                        patients.push(patient);
                    }
                }
            }
        }
    }

    serde_json::json!({
        "type": "sync",
        "patients": patients,
        "clients": server::mesh_clients().len(),
        "timestamp": chrono::Local::now().timestamp(),
    })
}

/// Broadcast a message to all connected clients, optionally excluding one.
async fn broadcast(clients: &WsClients, msg: &Value, exclude: Option<&str>) {
    use futures_util::SinkExt;

    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };

    let readers = clients.read().await;
    let mut dead: Vec<String> = Vec::new();

    for (cid, sender) in readers.iter() {
        if exclude.map(|e| e == cid).unwrap_or(false) {
            continue;
        }
        let result = sender.lock().await.send(Message::Text(json.clone())).await;
        if result.is_err() {
            dead.push(cid.clone());
        }
    }
    drop(readers);

    // Clean up dead connections
    if !dead.is_empty() {
        let mut writers = clients.write().await;
        for cid in &dead {
            writers.remove(cid);
            server::unregister_client(cid);
        }
    }
}

/// Send a message to a specific client by name (for call signaling / DMs).
async fn send_to_name(clients: &WsClients, target_name: &str, msg: &Value) {
    use futures_util::SinkExt;

    if target_name.is_empty() {
        return;
    }

    let json = match serde_json::to_string(msg) {
        Ok(j) => j,
        Err(_) => return,
    };

    // Find the client_id that matches the target name
    let mesh_clients = server::mesh_clients();
    let target_cid = mesh_clients
        .iter()
        .find(|c| c.name.to_lowercase().trim() == target_name.to_lowercase().trim())
        .map(|c| c.client_id.clone());

    if let Some(cid) = target_cid {
        let readers = clients.read().await;
        if let Some(sender) = readers.get(&cid) {
            let _ = sender.lock().await.send(Message::Text(json)).await;
        }
    }
}

/// Background task: evict stale clients every 15s.
async fn stale_checker(clients: WsClients) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        let evicted = server::evict_stale();

        // Close evicted WebSocket connections
        if !evicted.is_empty() {
            let mut writers = clients.write().await;
            for cid in &evicted {
                if let Some(sender) = writers.remove(cid) {
                    use futures_util::SinkExt;
                    let _ = sender.lock().await.send(Message::Close(None)).await;
                }
            }
        }
    }
}
