"""
Video Call — WS /video/ws
Dedicated WebSocket for WebRTC signaling relay.
Separates call signaling from the general mesh WebSocket.

Client sends:
  JSON messages: call_request, call_accept, call_reject, call_end,
                 webrtc_offer, webrtc_answer, webrtc_ice

Server relays to target peer via their active /video/ws connection.
"""
import json
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("triage.video")
router = APIRouter(tags=["video"])

# Active video call WebSocket connections: name → WebSocket
_active_peers: dict[str, WebSocket] = {}
# Active calls: caller_name → callee_name
_active_calls: dict[str, str] = {}


@router.websocket("/ws")
async def video_ws(websocket: WebSocket):
    """WebRTC signaling relay for video/voice calls."""
    await websocket.accept()
    peer_name: str | None = None

    try:
        # 1. Register: client sends {type: "register", name: "..."}
        reg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        peer_name = reg.get("name", "Unknown")
        _active_peers[peer_name] = websocket
        logger.info(f"Video peer registered: {peer_name}")
        await websocket.send_json({"type": "registered", "name": peer_name})

        # 2. Relay loop
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type", "")
            target = msg.get("target_name", "")

            # Stamp the sender
            msg["caller_name"] = peer_name

            if msg_type == "call_request":
                _active_calls[peer_name] = target
                logger.info(f"Call request: {peer_name} → {target}")

            elif msg_type == "call_accept":
                _active_calls[peer_name] = msg.get("caller_name", target)
                logger.info(f"Call accepted: {peer_name}")

            elif msg_type in ("call_end", "call_reject"):
                _active_calls.pop(peer_name, None)
                _active_calls.pop(target, None)
                logger.info(f"Call ended: {peer_name}")

            # Relay to target peer
            target_ws = _active_peers.get(target)
            if target_ws:
                try:
                    await target_ws.send_json(msg)
                except Exception as relay_err:
                    logger.warning(f"Relay to {target} failed: {relay_err}")
            else:
                # Target not on dedicated video WS — fall through
                # The mesh WS can still pick it up as fallback
                logger.debug(f"Target {target} not on /video/ws, signal may use mesh WS")

    except WebSocketDisconnect:
        logger.info(f"Video peer disconnected: {peer_name}")
    except asyncio.TimeoutError:
        logger.warning("Video WS timeout waiting for registration")
    except Exception as e:
        logger.exception(f"Video WS error for {peer_name}")
    finally:
        if peer_name:
            _active_peers.pop(peer_name, None)
            # Clean up any active call
            partner = _active_calls.pop(peer_name, None)
            if partner:
                _active_calls.pop(partner, None)
                # Notify partner that call ended
                partner_ws = _active_peers.get(partner)
                if partner_ws:
                    try:
                        await partner_ws.send_json({
                            "type": "call_end",
                            "caller_name": peer_name,
                            "reason": "peer_disconnected",
                        })
                    except Exception:
                        pass


@router.get("/active")
async def active_calls():
    """List active video call sessions."""
    return {
        "peers_online": list(_active_peers.keys()),
        "active_calls": dict(_active_calls),
    }
