"""
Roster — team member CRUD + avatar upload.
"""
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

from storage import write_json, roster_path, AVATAR_DIR, log_activity

router = APIRouter(tags=["roster"])


class RosterMember(BaseModel):
    id: str = ""
    name: str
    role: str = "responder"          # leader | medic | responder
    skills: list[str] = []           # e.g. ["IV", "splinting", "airway"]
    status: str = "available"        # available | assigned | offline | injured
    assigned_task: str = ""          # task ID if assigned
    joined_at: str = ""
    notes: str = ""


def _avatar_path(member_id: str):
    """Return the avatar file path for a member (webp)."""
    return AVATAR_DIR / f"{member_id}.webp"


def _enrich_with_avatar(member: dict) -> dict:
    """Add avatar_url to a member dict if an avatar file exists."""
    if _avatar_path(member.get("id", "")).exists():
        member["avatar_url"] = f"/api/roster/{member['id']}/avatar"
    else:
        member["avatar_url"] = ""
    return member


@router.get("/api/roster")
def list_roster():
    """List all roster members, with avatar URLs."""
    p = roster_path()
    if not p.exists():
        return []
    roster = json.loads(p.read_text(encoding="utf-8"))
    return [_enrich_with_avatar(m) for m in roster]


@router.post("/api/roster", status_code=201)
def add_roster_member(member: RosterMember):
    """Add a new member to the roster. Starts as 'pending' until they connect via WebSocket."""
    p = roster_path()
    roster = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    if not member.id:
        member.id = f"R-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    if not member.joined_at:
        member.joined_at = datetime.now().isoformat()
    member.status = "pending"
    roster.append(member.model_dump())
    write_json(p, roster)
    log_activity(member.name, "joined roster", member.role)
    return _enrich_with_avatar(member.model_dump())


@router.put("/api/roster/{member_id}")
def update_roster_member(member_id: str, member: RosterMember):
    """Update a roster member."""
    p = roster_path()
    if not p.exists():
        raise HTTPException(404, "Roster not found")
    roster = json.loads(p.read_text(encoding="utf-8"))
    for i, m in enumerate(roster):
        if m["id"] == member_id:
            member.id = member_id
            roster[i] = member.model_dump()
            write_json(p, roster)
            return _enrich_with_avatar(roster[i])
    raise HTTPException(404, f"Member {member_id} not found")


@router.delete("/api/roster/{member_id}")
def delete_roster_member(member_id: str):
    """Remove a member from the roster and clean up avatar."""
    p = roster_path()
    if not p.exists():
        raise HTTPException(404, "Roster not found")
    roster = json.loads(p.read_text(encoding="utf-8"))
    roster = [m for m in roster if m["id"] != member_id]
    write_json(p, roster)
    # Clean up avatar file
    av = _avatar_path(member_id)
    if av.exists():
        av.unlink()
    log_activity("system", "removed from roster", member_id)
    return {"deleted": member_id}


# ── Avatar Upload/Retrieval ────────────────────────────────────────────────────

@router.post("/api/roster/{member_id}/avatar")
async def upload_avatar(member_id: str, file: UploadFile = File(...)):
    """Upload an avatar image for a roster member. Stored as webp."""
    p = roster_path()
    if p.exists():
        roster = json.loads(p.read_text(encoding="utf-8"))
        if not any(m["id"] == member_id for m in roster):
            raise HTTPException(404, f"Member {member_id} not found")
    av = _avatar_path(member_id)
    content = await file.read()
    av.write_bytes(content)
    return {"avatar_url": f"/api/roster/{member_id}/avatar"}


@router.get("/api/roster/{member_id}/avatar")
def get_avatar(member_id: str):
    """Retrieve the avatar image for a roster member."""
    av = _avatar_path(member_id)
    if not av.exists():
        raise HTTPException(404, "No avatar found")
    return FileResponse(av, media_type="image/webp", headers={"Cache-Control": "max-age=3600"})
