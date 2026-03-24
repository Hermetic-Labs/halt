"""
Inventory — items + locations CRUD, consume, restock.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from storage import read_json, write_json, inventory_path, inventory_locations_path, chat_path, log_activity

router = APIRouter(tags=["inventory"])


class InventoryLocation(BaseModel):
    id: str = "loc-1"
    name: str = "Main Supply Room"

class InventoryItem(BaseModel):
    id: str
    name: str
    quantity: int
    minThreshold: int
    category: str
    alternatives: list[str]
    locationId: str = "loc-1"

class InventoryRestock(BaseModel):
    amount: int


DEFAULT_INVENTORY = [
    {"id": "inv-txa", "name": "TXA (Tranexamic Acid)", "quantity": 10, "minThreshold": 3,
     "category": "Medication", "alternatives": ["Direct Pressure", "Tourniquet", "Hemostatic Dressing"], "locationId": "loc-1"},
    {"id": "inv-gauze", "name": "Combat Gauze", "quantity": 50, "minThreshold": 10,
     "category": "Bandage", "alternatives": ["Standard Gauze", "Clean Cloth"], "locationId": "loc-1"},
    {"id": "inv-tourniquet", "name": "CAT Tourniquet", "quantity": 25, "minThreshold": 5,
     "category": "Equipment", "alternatives": ["Improvised Tourniquet (Cravat + Windlass)"], "locationId": "loc-1"},
    {"id": "inv-iv-fluid", "name": "IV Fluids (Lactated Ringers 1L)", "quantity": 20, "minThreshold": 5,
     "category": "Fluids", "alternatives": ["Oral Rehydration Salts (if patient is conscious/can swallow)"], "locationId": "loc-1"},
    {"id": "inv-ketamine", "name": "Ketamine (500mg vial)", "quantity": 15, "minThreshold": 5,
     "category": "Medication", "alternatives": ["Fentanyl Lozenge (OTFC)", "Morphine Auto-Injector"], "locationId": "loc-1"},
    {"id": "inv-chest-seal", "name": "Vented Chest Seal", "quantity": 30, "minThreshold": 8,
     "category": "Equipment", "alternatives": ["Improvised 3-sided occlusive dressing (plastic + tape)"], "locationId": "loc-1"},
]


def load_inventory() -> list[dict]:
    path = inventory_path()
    if not path.exists():
        write_json(path, DEFAULT_INVENTORY)
        return list(DEFAULT_INVENTORY)
    try:
        data = read_json(path)
        if not isinstance(data, list):
            return list(DEFAULT_INVENTORY)
        return data
    except Exception:
        return list(DEFAULT_INVENTORY)


def _resolve_location_name(location_id: str) -> str:
    """Look up the human-readable name for a locationId."""
    path = inventory_locations_path()
    if path.exists():
        try:
            locs = read_json(path)
            for loc in locs:
                if loc.get("id") == location_id:
                    return loc.get("name", location_id)
        except Exception:
            pass
    return "Main Supply Room" if location_id == "loc-1" else location_id


@router.get("/api/inventory", response_model=list[InventoryItem])
def get_inventory():
    """List all inventory items."""
    return load_inventory()


@router.get("/api/inventory/locations", response_model=list[InventoryLocation])
def get_inventory_locations():
    """List all inventory locations."""
    path = inventory_locations_path()
    if not path.exists():
        default = [{"id": "loc-1", "name": "Main Supply Room"}]
        write_json(path, default)
        return default
    return read_json(path)


@router.post("/api/inventory/locations", response_model=InventoryLocation)
def add_inventory_location(loc: InventoryLocation):
    """Add a new inventory location."""
    path = inventory_locations_path()
    locs = read_json(path) if path.exists() else [{"id": "loc-1", "name": "Main Supply Room"}]
    for l in locs:
        if l["id"] == loc.id:
            l["name"] = loc.name
            write_json(path, locs)
            return loc
    locs.append(loc.model_dump())
    write_json(path, locs)
    return loc


@router.put("/api/inventory/locations/{id}", response_model=InventoryLocation)
def update_inventory_location(id: str, loc: InventoryLocation):
    """Update an existing inventory location."""
    path = inventory_locations_path()
    locs = read_json(path) if path.exists() else [{"id": "loc-1", "name": "Main Supply Room"}]
    for l in locs:
        if l["id"] == id:
            l["name"] = loc.name
            write_json(path, locs)
            return loc
    raise HTTPException(status_code=404, detail="Location not found")


@router.delete("/api/inventory/locations/{id}")
def delete_inventory_location(id: str):
    """Delete an inventory location and cascade item moves to default loc-1."""
    if id == "loc-1":
        raise HTTPException(status_code=400, detail="Cannot delete default location loc-1")
    path = inventory_locations_path()
    locs = read_json(path) if path.exists() else [{"id": "loc-1", "name": "Main Supply Room"}]
    initial_length = len(locs)
    locs = [l for l in locs if l.get("id") != id]
    if len(locs) == initial_length:
        raise HTTPException(status_code=404, detail="Location not found")
    write_json(path, locs)

    inv = load_inventory()
    for item in inv:
        if item.get("locationId") == id:
            item["locationId"] = "loc-1"
    write_json(inventory_path(), inv)
    return {"status": "ok", "deleted": id}


@router.post("/api/inventory", response_model=InventoryItem)
def add_inventory_item(item: InventoryItem):
    """Add a new inventory category."""
    inv = load_inventory()
    inv.append(item.model_dump())
    write_json(inventory_path(), inv)
    return item


@router.patch("/api/inventory/{id}/consume", response_model=InventoryItem)
async def consume_inventory(id: str, restock: InventoryRestock, modified_by: str = Query("", description="Who is consuming")):
    """Consume an inventory item by the specified amount."""
    from datetime import datetime
    inv = load_inventory()
    target = None
    for item in inv:
        if item.get("id") == id:
            item["quantity"] = max(0, item.get("quantity", 0) - restock.amount)
            if modified_by:
                item["last_modified_by"] = modified_by
                item["last_modified_at"] = datetime.now().isoformat()
            target = item
            break
    if not target:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    write_json(inventory_path(), inv)

    # Resolve location name for the log
    loc_name = _resolve_location_name(target.get("locationId", "loc-1"))
    item_label = f"{target.get('name', id)} [{loc_name}]"
    log_activity(modified_by or "unknown", f"consumed {restock.amount}x", item_label)

    # ── Auto-alert on critical stock ──────────────────────────────────────
    qty = target.get("quantity", 0)
    min_t = target.get("minThreshold", 0)
    if qty <= min_t and min_t > 0:
        try:
            from routes.mesh import broadcast_mesh
            import json as _json
            name = target.get("name", id)
            if qty == 0:
                # EMERGENCY — item is depleted
                emergency_msg = {
                    "type": "emergency",
                    "ward": "",
                    "bed": "",
                    "categories": ["inventory"],
                    "categories_text": "Inventory & Supply",
                    "sender_name": "System",
                    "notes": f"{name} at {loc_name} is DEPLETED (0 remaining)",
                    "sound": "announcement",
                    "timestamp": int(datetime.now().timestamp()),
                }
                await broadcast_mesh(emergency_msg)
                # Log to chat
                cp = chat_path()
                messages = _json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else []
                messages.append({
                    "id": f"INV-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
                    "sender_name": "System",
                    "sender_role": "system",
                    "message": f"🚨 SUPPLY EMERGENCY: {name} at {loc_name} is DEPLETED — consider alternatives",
                    "target_name": "",
                    "timestamp": datetime.now().isoformat(),
                })
                if len(messages) > 500:
                    messages = messages[-500:]
                write_json(cp, messages)
            else:
                # WARNING — item is critically low
                announcement_msg = {
                    "type": "announcement",
                    "message": f"⚠️ SUPPLY ALERT: {name} at {loc_name} is critically low ({qty} remaining, min: {min_t})",
                    "sender_name": "System",
                    "sound": "general",
                    "timestamp": int(datetime.now().timestamp()),
                }
                await broadcast_mesh(announcement_msg)
                # Log to chat
                cp = chat_path()
                messages = _json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else []
                messages.append({
                    "id": f"INV-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
                    "sender_name": "System",
                    "sender_role": "system",
                    "message": f"⚠️ SUPPLY ALERT: {name} at {loc_name} — {qty} remaining (threshold: {min_t})",
                    "target_name": "",
                    "timestamp": datetime.now().isoformat(),
                })
                if len(messages) > 500:
                    messages = messages[-500:]
                write_json(cp, messages)
        except Exception:
            pass  # Mesh unavailable — don't block inventory operations

    return target


@router.patch("/api/inventory/{id}/restock", response_model=InventoryItem)
async def restock_inventory(id: str, restock: InventoryRestock, modified_by: str = Query("", description="Who is restocking")):
    """Restock an inventory item by the specified amount."""
    from datetime import datetime
    inv = load_inventory()
    target = None
    for item in inv:
        if item.get("id") == id:
            item["quantity"] = item.get("quantity", 0) + restock.amount
            if modified_by:
                item["last_modified_by"] = modified_by
                item["last_modified_at"] = datetime.now().isoformat()
            target = item
            break
    if not target:
        raise HTTPException(status_code=404, detail="Inventory item not found.")
    write_json(inventory_path(), inv)
    loc_name = _resolve_location_name(target.get("locationId", "loc-1"))
    log_activity(modified_by or "unknown", f"restocked {restock.amount}x", f"{target.get('name', id)} [{loc_name}]")
    return target


@router.delete("/api/inventory/{id}")
def delete_inventory_item(id: str):
    """Delete a specific inventory item by ID."""
    inv = load_inventory()
    initial_length = len(inv)
    inv = [item for item in inv if item.get("id") != id]
    if len(inv) == initial_length:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    write_json(inventory_path(), inv)
    return {"status": "ok", "deleted": id}


@router.get("/api/inventory/activity")
def get_inventory_activity(limit: int = 50):
    """Return recent inventory activity (consume/restock log)."""
    from storage import activity_path
    import json as _json
    p = activity_path()
    if not p.exists():
        return []
    try:
        entries = _json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            return []
        # Filter to inventory-related actions and return most recent first
        inv_actions = [
            e for e in entries
            if any(kw in (e.get("action", "")) for kw in ("consumed", "restocked"))
        ]
        return list(reversed(inv_actions[-limit:]))
    except Exception:
        return []


@router.delete("/api/inventory/activity")
def clear_inventory_activity():
    """Remove inventory-related entries (consumed/restocked) from the activity log."""
    from storage import activity_path
    import json as _json
    p = activity_path()
    if not p.exists():
        return {"status": "ok", "removed": 0}
    try:
        entries = _json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            return {"status": "ok", "removed": 0}
        # Keep non-inventory entries, remove consumed/restocked
        kept = [e for e in entries if not any(kw in (e.get("action", "")) for kw in ("consumed", "restocked"))]
        removed = len(entries) - len(kept)
        write_json(p, kept)
        return {"status": "ok", "removed": removed}
    except Exception:
        return {"status": "ok", "removed": 0}
