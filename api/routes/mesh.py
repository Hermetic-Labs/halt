"""
Mesh Network — real-time WebSocket sync, QR onboarding, alerts, emergency, chat.
"""
import io
import json
import asyncio
import base64
import urllib.parse
import time as _time
from datetime import datetime
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel

from storage import DATA_DIR, read_json, write_json, roster_path, tasks_path, chat_path, thread_path, log_activity

router = APIRouter(tags=["mesh"])

# In-memory mesh state (no DB dependency — survives nothing, by design)
MESH_CLIENTS: Dict[str, dict] = {}           # client_id -> {role, name, connected_at, last_ping, ip}
MESH_WS: Dict[str, WebSocket] = {}           # client_id -> active WebSocket
MESH_LEADER_ID: Optional[str] = None         # who started this node
CLIENT_TIMEOUT = 60                          # seconds before stale
MAX_CLIENTS = 20                             # WiFi hotspot limit
ROLE_PRIORITY = {"leader": 3, "medic": 2, "responder": 1}


# ── Models ─────────────────────────────────────────────────────────────────────

class MeshJoin(BaseModel):
    name: str = "Volunteer"
    role: str = "responder"

class PromoteRequest(BaseModel):
    client_id: str
    name: str = "Unknown"
    role: str = "leader"

class AlertRequest(BaseModel):
    target_name: str = ""
    message: str = "Alert"
    sender_name: str = "System"
    priority: str = "normal"
    sound: str = "alert"
    alert_type: str = "alert"

class EmergencyRequest(BaseModel):
    ward: str = ""
    bed: str = ""
    categories: list[str] = []
    sender_name: str = "System"
    notes: str = ""

class AnnouncementRequest(BaseModel):
    message: str = ""
    sender_name: str = "System"

class ChatMessage(BaseModel):
    sender_name: str = ""
    sender_role: str = ""
    message: str = ""
    target_name: str = ""
    reply_to: str = ""  # ID of message being replied to

class ReactRequest(BaseModel):
    emoji: str = "👍"
    user: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────

async def broadcast_mesh(message: dict, exclude: str = None):
    """Send a message to all connected WebSocket clients."""
    dead = []
    for cid, ws in MESH_WS.items():
        if cid == exclude:
            continue
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(cid)
    for cid in dead:
        MESH_WS.pop(cid, None)


def _get_local_ip() -> str:
    """Best-effort LAN IP detection."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ── REST Endpoints ─────────────────────────────────────────────────────────────

@router.get("/api/mesh/status")
def mesh_status():
    """Network health snapshot with leader info for failover."""
    now = int(_time.time())
    active = [c for c in MESH_CLIENTS.values() if now - c["last_ping"] < CLIENT_TIMEOUT]
    leader_info = MESH_CLIENTS.get(MESH_LEADER_ID, {}) if MESH_LEADER_ID else {}
    return {
        "mode": "leader",
        "leader_id": MESH_LEADER_ID,
        "leader_name": leader_info.get("name", "Unknown"),
        "leader_last_ping": leader_info.get("last_ping", 0),
        "leader_online": MESH_LEADER_ID in MESH_WS if MESH_LEADER_ID else False,
        "clients_total": len(MESH_CLIENTS),
        "clients_active": len(active),
        "max_clients": MAX_CLIENTS,
        "uptime_seconds": now - (leader_info.get("connected_at", now)),
        "timestamp": now,
    }


@router.get("/api/mesh/clients")
def mesh_clients():
    """List all connected clients with their status."""
    now = int(_time.time())
    result = []
    for cid, c in MESH_CLIENTS.items():
        result.append({
            "client_id": cid,
            "name": c.get("name", "Unknown"),
            "role": c.get("role", "responder"),
            "connected_at": c["connected_at"],
            "last_ping": c["last_ping"],
            "stale": now - c["last_ping"] > CLIENT_TIMEOUT,
            "online": cid in MESH_WS,
        })
    result.sort(key=lambda x: x["connected_at"])
    return result


@router.get("/api/mesh/snapshot")
def mesh_snapshot():
    """Full state dump for leadership handover."""
    rp = roster_path()
    roster = json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else []
    tp = tasks_path()
    tasks = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else []
    patients = []
    for f in DATA_DIR.glob("PAT-*.json"):
        try:
            patients.append(read_json(f))
        except Exception:
            continue
    return {
        "roster": roster,
        "tasks": tasks,
        "patients": patients,
        "leader_id": MESH_LEADER_ID,
        "clients": list(MESH_CLIENTS.keys()),
        "timestamp": int(_time.time()),
    }


@router.post("/api/mesh/promote")
async def mesh_promote(req: PromoteRequest):
    """Client declares itself the new leader after failover."""
    global MESH_LEADER_ID
    old_leader = MESH_LEADER_ID
    MESH_LEADER_ID = req.client_id
    if req.client_id in MESH_CLIENTS:
        MESH_CLIENTS[req.client_id]["role"] = "leader"
    rp = roster_path()
    if rp.exists():
        roster = json.loads(rp.read_text(encoding="utf-8"))
        for m in roster:
            if m["name"].lower().strip() == req.name.lower().strip():
                m["role"] = "leader"
        write_json(rp, roster)
    await broadcast_mesh({
        "type": "new_leader",
        "leader_id": req.client_id,
        "leader_name": req.name,
        "old_leader_id": old_leader,
        "timestamp": int(_time.time()),
    })
    return {"status": "promoted", "leader_id": req.client_id}


@router.post("/api/mesh/alert")
async def mesh_alert(req: AlertRequest):
    """Send an alert to a specific client or broadcast to all."""
    alert_msg = {
        "type": req.alert_type,
        "target_name": req.target_name,
        "message": req.message,
        "sender_name": req.sender_name,
        "priority": req.priority,
        "sound": req.sound,
        "timestamp": int(_time.time()),
    }
    if req.target_name:
        sent = False
        for cid, ws in list(MESH_WS.items()):
            client_info = MESH_CLIENTS.get(cid, {})
            if client_info.get("name", "").lower().strip() == req.target_name.lower().strip():
                try:
                    await ws.send_json(alert_msg)
                    sent = True
                except Exception:
                    MESH_WS.pop(cid, None)
        return {"status": "sent" if sent else "target_offline", "target": req.target_name}
    else:
        await broadcast_mesh(alert_msg)
        return {"status": "broadcast", "recipients": len(MESH_WS)}


@router.post("/api/mesh/emergency")
async def mesh_emergency(req: EmergencyRequest):
    """Broadcast an emergency to ALL connected devices."""
    cat_labels = {
        "all_hands": "ALL HANDS ON DECK",
        "expediters": "All Expediters",
        "inventory": "Inventory & Supply",
        "bed_assist": "Bed Assistance",
        "doctors": "All Doctors",
        "intake": "Intake & Processing",
        "volunteers": "Volunteers",
    }
    cat_text = ", ".join(cat_labels.get(c, c) for c in req.categories) if req.categories else "General Emergency"
    emergency_msg = {
        "type": "emergency",
        "ward": req.ward,
        "bed": req.bed,
        "categories": req.categories,
        "categories_text": cat_text,
        "sender_name": req.sender_name,
        "notes": req.notes,
        "sound": "announcement",
        "timestamp": int(_time.time()),
    }
    await broadcast_mesh(emergency_msg)
    # Log to chat thread (broadcast to everyone)
    ward_bed = f" — Ward: {req.ward}" if req.ward else ""
    if req.bed:
        ward_bed += f" Bed: {req.bed}"
    notes_str = f" | {req.notes}" if req.notes else ""
    chat_entry = {
        "id": f"EMG-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
        "sender_name": req.sender_name,
        "sender_role": "system",
        "message": f"🚨 EMERGENCY: {cat_text}{ward_bed}{notes_str}",
        "target_name": "",
        "timestamp": datetime.now().isoformat(),
    }
    cp = chat_path()
    messages = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else []
    messages.append(chat_entry)
    if len(messages) > 500:
        messages = messages[-500:]
    write_json(cp, messages)
    return {"status": "broadcast", "recipients": len(MESH_WS), "categories": req.categories}


@router.post("/api/mesh/announcement")
async def mesh_announcement(req: AnnouncementRequest):
    """Broadcast a general announcement to ALL connected devices."""
    announcement_msg = {
        "type": "announcement",
        "message": req.message,
        "sender_name": req.sender_name,
        "sound": "general",
        "timestamp": int(_time.time()),
    }
    await broadcast_mesh(announcement_msg)
    # Log to chat thread (broadcast to everyone)
    chat_entry = {
        "id": f"ANN-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
        "sender_name": req.sender_name,
        "sender_role": "system",
        "message": f"📢 ANNOUNCEMENT: {req.message}",
        "target_name": "",
        "timestamp": datetime.now().isoformat(),
    }
    cp = chat_path()
    messages = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else []
    messages.append(chat_entry)
    if len(messages) > 500:
        messages = messages[-500:]
    write_json(cp, messages)
    return {"status": "broadcast", "recipients": len(MESH_WS)}


@router.get("/api/mesh/chat")
def get_chat(limit: int = 100):
    """Get recent chat messages."""
    cp = chat_path()
    if not cp.exists():
        return []
    messages = json.loads(cp.read_text(encoding="utf-8"))
    return messages[-limit:]


@router.post("/api/mesh/chat", status_code=201)
async def send_chat(msg: ChatMessage):
    """Send a chat message and broadcast it via WebSocket."""
    cp = chat_path()
    messages = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else []
    entry = {
        "id": f"MSG-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
        "sender_name": msg.sender_name,
        "sender_role": msg.sender_role,
        "message": msg.message,
        "target_name": msg.target_name,
        "reply_to": msg.reply_to or "",
        "reactions": {},
        "timestamp": datetime.now().isoformat(),
    }
    messages.append(entry)
    if len(messages) > 500:
        messages = messages[-500:]
    write_json(cp, messages)

    # DM thread storage — write targeted messages to per-pair file
    if msg.target_name and msg.sender_name:
        tp = thread_path(msg.sender_name, msg.target_name)
        thread = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else []
        thread.append(entry)
        if len(thread) > 500:
            thread = thread[-500:]
        write_json(tp, thread)

    ws_msg = {**entry, "type": "chat", "sound": "ringtone"}
    if msg.target_name:
        for cid, ws in list(MESH_WS.items()):
            client_info = MESH_CLIENTS.get(cid, {})
            if client_info.get("name", "").lower().strip() == msg.target_name.lower().strip():
                try:
                    await ws.send_json(ws_msg)
                except Exception:
                    MESH_WS.pop(cid, None)
    else:
        await broadcast_mesh(ws_msg)
    return entry


@router.get("/api/mesh/chat/thread/{member_name}")
def get_thread(member_name: str, my_name: str = Query("", description="Your name"), limit: int = 100):
    """Get DM history between two members."""
    if not my_name:
        raise HTTPException(400, "my_name query param required")
    tp = thread_path(my_name, member_name)
    if not tp.exists():
        return []
    thread = json.loads(tp.read_text(encoding="utf-8"))
    return thread[-limit:]


@router.post("/api/mesh/chat/{msg_id}/react")
def react_to_message(msg_id: str, req: ReactRequest):
    """Toggle an emoji reaction on a chat message."""
    cp = chat_path()
    if not cp.exists():
        raise HTTPException(404, "No chat history")
    messages = json.loads(cp.read_text(encoding="utf-8"))
    for m in messages:
        if m.get("id") == msg_id:
            reactions = m.get("reactions", {})
            users = reactions.get(req.emoji, [])
            if req.user in users:
                users.remove(req.user)
                if not users:
                    del reactions[req.emoji]
            else:
                users.append(req.user)
                reactions[req.emoji] = users
            m["reactions"] = reactions
            write_json(cp, messages)
            return {"status": "ok", "reactions": reactions}
    raise HTTPException(404, "Message not found")


@router.get("/api/mesh/qr")
def mesh_qr(
    ssid: str = Query("EVE_TRIAGE", description="WiFi SSID"),
    password: str = Query("medic123", description="WiFi password"),
    name: str = Query("", description="Pre-fill member name"),
    role: str = Query("", description="Pre-fill member role"),
):
    """Generate QR code for onboarding — encodes the app URL with optional name/role params."""
    import os
    frontend_port = os.environ.get("FRONTEND_PORT", "7779")
    local_ip = _get_local_ip()
    app_url = f"http://{local_ip}:{frontend_port}"
    params = []
    if name:
        params.append(f"name={urllib.parse.quote(name)}")
    if role:
        params.append(f"role={urllib.parse.quote(role)}")
    if params:
        app_url += "?" + "&".join(params)

    try:
        import qrcode as qr_lib
        qr = qr_lib.QRCode(version=1, box_size=10, border=4)
        qr.add_data(app_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        b64 = base64.b64encode(buf.getvalue()).decode()
        qr_image = f"data:image/png;base64,{b64}"
    except ImportError:
        qr_image = None

    return {"app_url": app_url, "qr_image": qr_image}


# ── WebSocket ──────────────────────────────────────────────────────────────────

@router.websocket("/ws/{client_id}")
async def mesh_websocket(websocket: WebSocket, client_id: str):
    """Real-time mesh sync. Handles patient broadcasts, heartbeat, and failover."""
    await websocket.accept()
    now = int(_time.time())

    if client_id not in MESH_CLIENTS:
        MESH_CLIENTS[client_id] = {
            "name": "Volunteer",
            "role": "responder",
            "connected_at": now,
            "last_ping": now,
            "ip": websocket.client.host if websocket.client else "unknown",
        }
    MESH_CLIENTS[client_id]["last_ping"] = now
    MESH_WS[client_id] = websocket

    # Send initial sync
    try:
        patients = []
        for f in DATA_DIR.glob("PAT-*.json"):
            patients.append(json.loads(f.read_text(encoding="utf-8")))
        await websocket.send_json({
            "type": "sync",
            "patients": patients,
            "clients": len(MESH_CLIENTS),
            "timestamp": now,
        })
    except Exception:
        pass

    await broadcast_mesh({
        "type": "client_joined",
        "client_id": client_id,
        "name": MESH_CLIENTS[client_id]["name"],
        "clients": len(MESH_CLIENTS),
    }, exclude=client_id)

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30)
                MESH_CLIENTS[client_id]["last_ping"] = int(_time.time())
                msg_type = data.get("type", "")

                if msg_type == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": int(_time.time())})
                    if client_id == MESH_LEADER_ID:
                        await broadcast_mesh({
                            "type": "leader_heartbeat",
                            "leader_id": client_id,
                            "leader_name": MESH_CLIENTS[client_id].get("name", "Unknown"),
                            "timestamp": int(_time.time()),
                        }, exclude=client_id)

                elif msg_type == "set_name":
                    name_val = data.get("name", "Volunteer")
                    role_val = data.get("role", "responder")
                    MESH_CLIENTS[client_id]["name"] = name_val
                    MESH_CLIENTS[client_id]["role"] = role_val
                    rp = roster_path()
                    if rp.exists():
                        roster = json.loads(rp.read_text(encoding="utf-8"))
                        matched = False
                        for i, m in enumerate(roster):
                            if m["name"].lower().strip() == name_val.lower().strip() and m["status"] in ("pending", "offline"):
                                roster[i]["status"] = "connected"
                                matched = True
                                break
                        if matched:
                            write_json(rp, roster)

                elif msg_type == "patient_updated":
                    await broadcast_mesh({
                        "type": "patient_updated",
                        "patient": data.get("patient"),
                        "source": client_id,
                    }, exclude=client_id)

                elif msg_type == "patient_created":
                    await broadcast_mesh({
                        "type": "patient_created",
                        "patient": data.get("patient"),
                        "source": client_id,
                    }, exclude=client_id)

                elif msg_type in ("call_request", "call_accept", "call_reject", "call_end",
                                  "webrtc_offer", "webrtc_answer", "webrtc_ice"):
                    target_name = data.get("target_name", "")
                    target_ws = None
                    for cid, cinfo in MESH_CLIENTS.items():
                        if cinfo.get("name", "").lower().strip() == target_name.lower().strip() and cid in MESH_WS:
                            target_ws = MESH_WS[cid]
                            break
                    if target_ws:
                        try:
                            # WebRTC messages need full payload (SDP/ICE); call signals get sanitized
                            if msg_type.startswith("webrtc_"):
                                fwd = {**data, "timestamp": int(_time.time())}
                            else:
                                fwd = {
                                    "type": msg_type,
                                    "caller_name": data.get("caller_name", MESH_CLIENTS.get(client_id, {}).get("name", "Unknown")),
                                    "caller_role": data.get("caller_role", MESH_CLIENTS.get(client_id, {}).get("role", "responder")),
                                    "target_name": target_name,
                                    "call_type": data.get("call_type", "voice"),
                                    "timestamp": int(_time.time()),
                                }
                            await target_ws.send_json(fwd)
                        except Exception:
                            pass

            except asyncio.TimeoutError:
                MESH_CLIENTS[client_id]["last_ping"] = int(_time.time())
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        MESH_WS.pop(client_id, None)
        disconnected_name = MESH_CLIENTS.get(client_id, {}).get("name", "")
        if disconnected_name:
            rp = roster_path()
            if rp.exists():
                roster = json.loads(rp.read_text(encoding="utf-8"))
                for i, m in enumerate(roster):
                    if m["name"].lower().strip() == disconnected_name.lower().strip() and m["status"] == "connected":
                        roster[i]["status"] = "offline"
                        write_json(rp, roster)
                        break
        await broadcast_mesh({
            "type": "client_left",
            "client_id": client_id,
            "clients": len([c for c in MESH_WS]),
        })


# ── Background Tasks ──────────────────────────────────────────────────────────

async def stale_checker():
    """Purge stale clients periodically."""
    while True:
        await asyncio.sleep(15)
        now = int(_time.time())
        stale_ids = [cid for cid, c in MESH_CLIENTS.items()
                     if now - c["last_ping"] > CLIENT_TIMEOUT and cid not in MESH_WS]
        for cid in stale_ids:
            MESH_CLIENTS.pop(cid, None)
