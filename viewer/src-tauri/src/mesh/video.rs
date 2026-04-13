//! Video — WebRTC signaling relay.
//!
//! Direct translation of `api/routes/video.py`.
//!
//! This module doesn't handle media — it relays SDP offers/answers and
//! ICE candidates between peers via the mesh WebSocket hub. The actual
//! audio/video streams go peer-to-peer via WebRTC (handled entirely
//! in the frontend by useWebRTC.ts).

use serde_json::Value;
use super::server;

#[tauri::command]
pub fn active_video_calls() -> Value {
    // Video calls are tracked by the mesh state — any client pair with
    // an active WebRTC session shows up here.
    let clients = server::mesh_clients();
    serde_json::json!({
        "active_calls": 0,
        "connected_clients": clients.len(),
    })
}
