"""
Wards — CRUD for ward layout configurations.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from storage import read_json, write_json, ward_config_path, wards_path

router = APIRouter(tags=["wards"])


class WardConfig(BaseModel):
    id: str = "ward-1"
    name: str = "Ward Alpha"
    columns: int = 4
    rooms: list[str] = Field(default_factory=lambda: [f"R{str(i+1).zfill(2)}" for i in range(20)])


@router.get("/api/wards", response_model=list[WardConfig])
def get_all_wards():
    """List all available wards."""
    path = wards_path()
    if path.exists():
        return read_json(path)

    legacy = ward_config_path()
    default_ward = WardConfig()
    if legacy.exists():
        data = read_json(legacy)
        default_ward = WardConfig(**data)
        default_ward.id = "ward-1"

    write_json(path, [default_ward.model_dump()])
    return [default_ward]


@router.get("/api/ward/config", response_model=WardConfig)
def get_ward_config(id: str = "ward-1"):
    """Get ward layout configuration by ID."""
    wards = get_all_wards()
    for w in wards:
        w_id = w.id if isinstance(w, WardConfig) else w.get("id")
        if w_id == id:
            return w
    return WardConfig(id=id, name=f"New Ward {id}")


@router.put("/api/ward/config", response_model=WardConfig)
def save_ward_config(config: WardConfig, id: str = "ward-1"):
    """Save ward layout configuration for a specific ID."""
    config.id = id
    wards = get_all_wards()
    wards_list = [w.model_dump() if isinstance(w, WardConfig) else w for w in wards]

    found = False
    for i, w in enumerate(wards_list):
        if w.get("id") == id:
            wards_list[i] = config.model_dump()
            found = True
            break
    if not found:
        wards_list.append(config.model_dump())

    write_json(wards_path(), wards_list)
    return config


@router.delete("/api/ward/{id}")
def delete_ward(id: str):
    """Delete a ward layout configuration by ID."""
    wards = get_all_wards()
    wards_list = [w.model_dump() if isinstance(w, WardConfig) else w for w in wards]
    initial_length = len(wards_list)
    wards_list = [w for w in wards_list if w.get("id") != id]
    if len(wards_list) == initial_length:
        raise HTTPException(status_code=404, detail="Ward not found")
    write_json(wards_path(), wards_list)
    return {"status": "ok", "deleted": id}
