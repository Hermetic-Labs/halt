//! Mesh — peer-to-peer WebSocket hub + state management.
//!
//! Direct translation of `api/routes/mesh.py`.
//!
//! This is the most complex module in HALT. It manages:
//!   - WebSocket connections for all team members
//!   - Leader election and promotion
//!   - Heartbeat and stale client eviction
//!   - Message routing (broadcast, unicast, room-based)
//!   - State snapshots for new client sync

pub mod server;
pub mod chat;
pub mod alerts;
pub mod video;
pub mod translate_stream;
