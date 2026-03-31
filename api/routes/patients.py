"""
Patient routes — full lifecycle from triage intake through discharge.

Five major sections:
  1. CRUD           — Create / read / update / delete patient records.
  2. Attachments    — File uploads (photos, X-rays) stored per-patient on disk.
  3. PDF Export     — Stdlib-only PDF generation (no reportlab/weasyprint) for
                      air-gap safety. Outputs a Courier-font text PDF with
                      wrapped lines and multi-page support.
  4. HTML Export    — Print-ready, locale-aware patient card for medevac handoff.
                      Loads UI labels from viewer locale JSON so the output
                      matches the medic's configured language.
  5. Shift Report   — Cross-ward status rollup for shift handoff, grouped by
                      ward and sorted by triage priority.
  6. Snapshot/Restore — Full data dump and bulk import for mesh replication.

All data lives as JSON files on disk (via storage.py), encrypted at rest
when the cryptography package is available.
"""
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from starlette.responses import Response

from storage import (
    DATA_DIR,
    ATTACH_DIR,
    read_json,
    write_json,
    patient_path,
)

router = APIRouter(tags=["patients"])

# ── Models ─────────────────────────────────────────────────────────────────────


class PatientEvent(BaseModel):
    id: str
    timestamp: str
    type: str  # vitals | medication | procedure | note | status_change
    summary: str
    data: Optional[dict[str, Any]] = None


class PatientTriage(BaseModel):
    priority: str
    priorityLabel: str
    hemoClass: str
    gcsCat: str


class PatientVitals(BaseModel):
    hr: float = 0
    sbp: float = 0
    rr: float = 0
    spo2: float = 0
    gcs: float = 0
    temp: float = 0
    pain: float = 0


class PatientPlan(BaseModel):
    march: list[dict[str, Any]] = []
    drugs: list[dict[str, Any]] = []
    rx: list[str] = []
    recovery: list[str] = []
    escalate: list[str] = []


class PatientRecord(BaseModel):
    id: str
    name: str = ""
    age: float = 0
    ageUnit: str = "years"
    sex: str = "U"
    weight: float = 70
    pregnant: bool = False
    allergies: list[str] = []
    admittedAt: str = ""
    injuryTime: str = ""
    mechanism: str = ""
    regions: list[str] = []
    wardId: str = ""
    roomNumber: str = ""
    status: str = "active"  # active | stable | critical | transferred | discharged
    triage: PatientTriage = Field(
        default_factory=lambda: PatientTriage(priority="--", priorityLabel="", hemoClass="--", gcsCat="--")
    )
    initialVitals: PatientVitals = Field(default_factory=PatientVitals)
    plan: PatientPlan = Field(default_factory=PatientPlan)
    events: list[PatientEvent] = []
    notes: str = ""
    attachmentNames: list[str] = []
    nextOfKin: str = ""
    spokenLanguage: str = "English"
    publicOptIn: bool = False


class PatientSummary(BaseModel):
    id: str
    name: str
    age: float
    sex: str
    wardId: str
    roomNumber: str
    status: str
    priority: str
    admittedAt: str
    mechanism: str
    allergies: list[str]


# ── Public Lookup (family-facing) ──────────────────────────────────────────────


@router.get("/api/public/qr")
def public_lookup_qr(request: Request):
    """Generate a QR code linking directly to the family-facing patient lookup page (/lookup).
    Intended for printing and displaying at reception so families can self-serve."""
    import io
    import base64
    from routes.mesh import _get_local_ip

    port = request.url.port or request.scope.get("server", [None, 7778])[1]
    local_ip = _get_local_ip()
    lookup_url = f"http://{local_ip}:{port}/lookup"

    try:
        import qrcode as qr_lib
        qr = qr_lib.QRCode(version=1, box_size=10, border=4)
        qr.add_data(lookup_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        b64 = base64.b64encode(buf.getvalue()).decode()
        qr_image = f"data:image/png;base64,{b64}"
    except ImportError:
        qr_image = None

    return {"url": lookup_url, "qr_image": qr_image}


@router.get("/api/public/patients")
def public_patient_lookup(name: str = ""):
    """Family-facing patient search. Returns only opted-in patients with non-clinical data."""
    if not name.strip():
        return []
    results = []
    for f in DATA_DIR.glob("PAT-*.json"):
        try:
            record = read_json(f)
            if not record.get("public_opt_in", False) and not record.get("publicOptIn", False):
                continue
            if name.lower() not in record.get("name", "").lower():
                continue
            attachment_names = record.get("attachmentNames", [])
            photo_name = next((n for n in attachment_names if n.startswith("photo.")), "")
            results.append(
                {
                    "id": record.get("id"),
                    "name": record.get("name"),
                    "wardId": record.get("wardId"),
                    "roomNumber": record.get("roomNumber"),
                    "status": record.get("status"),
                    "admittedAt": record.get("admittedAt"),
                    "hasPhoto": bool(photo_name),
                    "photoUrl": f"/api/patients/{record['id']}/attachments/{photo_name}" if photo_name else None,
                }
            )
        except Exception:
            continue
    return results


# ── CRUD ───────────────────────────────────────────────────────────────────────


@router.get("/api/patients")
def list_patients(status: Optional[str] = None, full: bool = False):
    """List all patient records, optionally filtered by status.
    If full=True, return full PatientRecord payloads instead of summaries."""
    results = []
    for path in DATA_DIR.glob("PAT-*.json"):
        try:
            data = read_json(path)
            if status and data.get("status") != status:
                continue
            if full:
                results.append(data)
            else:
                results.append(
                    PatientSummary(
                        id=data["id"],
                        name=data.get("name", ""),
                        age=data.get("age", 0),
                        sex=data.get("sex", "U"),
                        wardId=data.get("wardId", ""),
                        roomNumber=data.get("roomNumber", ""),
                        status=data.get("status", "active"),
                        priority=data.get("triage", {}).get("priority", "--"),
                        admittedAt=data.get("admittedAt", ""),
                        mechanism=data.get("mechanism", ""),
                        allergies=data.get("allergies", []),
                    ).model_dump()
                )
        except Exception:
            continue
    return sorted(results, key=lambda s: s.get("admittedAt", ""), reverse=True)


@router.post("/api/patients", response_model=PatientRecord, status_code=201)
def create_patient(record: PatientRecord):
    """Create a new patient record. Generates ID if not provided."""
    if not record.id or not record.id.startswith("PAT-"):
        now = datetime.now()
        record.id = f"PAT-{now.strftime('%Y%m%d-%H%M%S')}"
    if not record.admittedAt:
        record.admittedAt = datetime.now().isoformat()
    path = patient_path(record.id)
    if path.exists():
        raise HTTPException(status_code=409, detail="Patient ID already exists. Use PUT to update.")
    write_json(path, record.model_dump())
    return record


@router.get("/api/patients/{patient_id}", response_model=PatientRecord)
def get_patient(patient_id: str):
    """Get full patient record by ID."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    return read_json(path)


@router.put("/api/patients/{patient_id}", response_model=PatientRecord)
def update_patient(patient_id: str, record: PatientRecord):
    """Full update of patient record (used on event log, status changes, etc.)"""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    record.id = patient_id
    write_json(path, record.model_dump())
    return record


@router.post("/api/patients/{patient_id}/events", response_model=PatientRecord)
def add_event(patient_id: str, event: PatientEvent):
    """Append a single event to a patient's record."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    data = read_json(path)
    events = data.get("events", [])
    events.insert(0, event.model_dump())
    data["events"] = events
    write_json(path, data)
    return data


@router.patch("/api/patients/{patient_id}/status")
def update_status(patient_id: str, status: str):
    """Quick status update: active | stable | critical | transferred | discharged"""
    valid = {"active", "stable", "critical", "transferred", "discharged"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid}")
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    data = read_json(path)
    data["status"] = status
    write_json(path, data)
    return {"id": patient_id, "status": status}


@router.delete("/api/patients/{patient_id}", status_code=204)
def delete_patient(patient_id: str):
    """Soft delete is preferred — use status='discharged' instead. This physically removes the file."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    path.unlink()


# ── Attachments ────────────────────────────────────────────────────────────────


@router.post("/api/patients/{patient_id}/attachments")
async def upload_attachment(patient_id: str, file: UploadFile = File(...)):
    """Upload a file attachment for a patient."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    patient_attach_dir = ATTACH_DIR / patient_id
    patient_attach_dir.mkdir(exist_ok=True)
    dest = patient_attach_dir / file.filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    data = read_json(path)
    names = data.get("attachmentNames", [])
    if file.filename not in names:
        names.append(file.filename)
    data["attachmentNames"] = names
    write_json(path, data)
    return {"filename": file.filename, "patientId": patient_id}


@router.get("/api/patients/{patient_id}/attachments/{filename}")
def get_attachment(patient_id: str, filename: str):
    """Retrieve an uploaded file."""
    file_path = ATTACH_DIR / patient_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))


# ── PDF Export ─────────────────────────────────────────────────────────────────


@router.get("/api/patients/{patient_id}/pdf")
def patient_pdf(patient_id: str):
    """Generate a downloadable PDF of a patient record (stdlib-only)."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    rec = read_json(path)

    lines = []
    lines.append(f"PATIENT RECORD — {rec.get('name', 'Unknown')}")
    lines.append(f"ID: {rec.get('id', '')}  |  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")
    lines.append("DEMOGRAPHICS")
    lines.append(
        f"  Name: {rec.get('name', '--')}  |  Age: {rec.get('age', '--')} {rec.get('ageUnit', '')}  |  Sex: {rec.get('sex', '--')}"
    )
    lines.append(f"  Weight: {rec.get('weight', '--')} kg  |  Pregnant: {'Yes' if rec.get('pregnant') else 'No'}")
    lines.append(f"  Language: {rec.get('spokenLanguage', '--')}  |  Next of Kin: {rec.get('nextOfKin', '--')}")
    lines.append(f"  Allergies: {', '.join(rec.get('allergies', [])) or 'None known'}")
    lines.append("")
    lines.append("ADMISSION")
    lines.append(f"  Admitted: {rec.get('admittedAt', '--')}  |  Mechanism: {rec.get('mechanism', '--')}")
    lines.append(f"  Injury Time: {rec.get('injuryTime', '--')}  |  Regions: {', '.join(rec.get('regions', []))}")
    lines.append(f"  Ward: {rec.get('wardId', 'Unassigned')}  |  Room: {rec.get('roomNumber', 'None')}")
    lines.append(f"  Status: {rec.get('status', '--')}")
    lines.append("")

    triage = rec.get("triage", {})
    lines.append("TRIAGE")
    lines.append(f"  Priority: {triage.get('priority', '--')} ({triage.get('priorityLabel', '')})")
    lines.append(f"  Hemorrhage Class: {triage.get('hemoClass', '--')}  |  GCS Category: {triage.get('gcsCat', '--')}")
    lines.append("")

    vitals = rec.get("initialVitals", {})
    lines.append("INITIAL VITALS")
    lines.append(f"  HR: {vitals.get('hr', '--')}  |  SBP: {vitals.get('sbp', '--')}  |  RR: {vitals.get('rr', '--')}")
    lines.append(
        f"  SpO2: {vitals.get('spo2', '--')}%  |  GCS: {vitals.get('gcs', '--')}  |  Temp: {vitals.get('temp', '--')}C  |  Pain: {vitals.get('pain', '--')}/10"
    )
    lines.append("")

    plan = rec.get("plan", {})
    if plan.get("march"):
        lines.append("MARCH PROTOCOL")
        for m in plan["march"]:
            lines.append(f"  {m.get('phase', '').upper()} - {m.get('label', '')}: {', '.join(m.get('actions', []))}")
        lines.append("")
    if plan.get("drugs"):
        lines.append("MEDICATIONS")
        for d in plan["drugs"]:
            lines.append(f"  {d.get('name', '')} {d.get('dose', '')} {d.get('route', '')}")
            if d.get("warning"):
                lines.append(f"    WARNING: {d['warning']}")
        lines.append("")
    if plan.get("rx"):
        lines.append("TREATMENT ORDERS (Rx)")
        for rx in plan["rx"]:
            lines.append(f"  - {rx}")
        lines.append("")

    events = rec.get("events", [])
    if events:
        lines.append("TIMELINE EVENTS")
        for ev in events:
            lines.append(f"  [{ev.get('type', '')}] {ev.get('timestamp', '')} — {ev.get('summary', '')}")
        lines.append("")
    lines.append(f"Notes: {rec.get('notes', 'None')}")

    # Build minimal PDF (text-only, no external libs)
    text = "\n".join(lines)
    pdf_lines = text.split("\n")
    objects = []
    xrefs = []

    def obj(content):
        objects.append(content)
        return len(objects)

    obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj")
    obj("")  # placeholder for Pages
    obj("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj")

    MAX_LINES = 55
    MAX_CHARS = 90
    wrapped = []
    for ln in pdf_lines:
        while len(ln) > MAX_CHARS:
            wrapped.append(ln[:MAX_CHARS])
            ln = "  " + ln[MAX_CHARS:]
        wrapped.append(ln)

    pages = []
    for i in range(0, len(wrapped), MAX_LINES):
        page_lines = wrapped[i : i + MAX_LINES]
        stream_parts = ["BT", "/F1 9 Tf", "50 750 Td", "12 TL"]
        for pl in page_lines:
            safe = pl.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            stream_parts.append(f"({safe}) '")
        stream_parts.append("ET")
        stream = "\n".join(stream_parts)

        stream_obj_num = obj(
            f"{len(objects) + 1} 0 obj\n<< /Length {len(stream)} >>\nstream\n{stream}\nendstream\nendobj"
        )
        page_obj_num = obj(
            f"{len(objects) + 1} 0 obj\n"
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {stream_obj_num} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\n"
            f"endobj"
        )
        pages.append(page_obj_num)

    kids = " ".join(f"{p} 0 R" for p in pages)
    objects[1] = f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>\nendobj"

    pdf_parts = ["%PDF-1.4\n"]
    for i, o in enumerate(objects):
        xrefs.append(len("".join(pdf_parts)))
        pdf_parts.append(o.replace(f"{i + 1} 0 obj", f"{i + 1} 0 obj") + "\n")

    xref_start = len("".join(pdf_parts))
    pdf_parts.append(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n")
    for xr in xrefs:
        pdf_parts.append(f"{xr:010d} 00000 n \n")
    pdf_parts.append(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n" f"startxref\n{xref_start}\n%%EOF\n")
    pdf_bytes = "".join(pdf_parts).encode("latin-1")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{patient_id}-record.pdf"'},
    )


# ── HTML Export ────────────────────────────────────────────────────────────────


@router.get("/api/patients/{patient_id}/export", response_class=HTMLResponse)
def patient_export_html(patient_id: str, lang: str = "en"):
    """Print-ready HTML patient record for medevac handoff. Pass ?lang=xx for translation."""
    path = patient_path(patient_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Patient not found")
    r = read_json(path)
    tri = r.get("triage", {})
    v = r.get("initialVitals", {})
    p = r.get("plan", {})
    ev = r.get("events", [])

    # ── Load locale labels ──
    labels = {
        "patient_record": "PATIENT RECORD",
        "demographics": "DEMOGRAPHICS",
        "admission": "ADMISSION",
        "triage": "TRIAGE",
        "initial_vitals": "INITIAL VITALS",
        "march_protocol": "MARCH PROTOCOL",
        "medications": "MEDICATIONS",
        "treatment_orders": "TREATMENT ORDERS",
        "timeline": "TIMELINE (Last 20)",
        "notes": "NOTES",
        "age": "Age",
        "sex": "Sex",
        "weight": "Weight",
        "pregnant": "Pregnant",
        "language": "Language",
        "next_of_kin": "Next of Kin",
        "allergies": "Allergies",
        "ward": "Ward",
        "room": "Room",
        "admitted": "Admitted",
        "injury_time": "Injury Time",
        "mechanism": "Mechanism",
        "regions": "Regions",
        "priority": "Priority",
        "hemo_class": "Hemo Class",
        "gcs_category": "GCS Category",
        "phase": "Phase",
        "label": "Label",
        "actions": "Actions",
        "drug": "Drug",
        "dose": "Dose",
        "route": "Route",
        "regimen": "Regimen",
        "time": "Time",
        "type": "Type",
        "summary": "Summary",
        "yes": "Yes",
        "no": "No",
        "none_known": "None known",
        "confidential": "Medic Info — Air-Gapped Triage System — CONFIDENTIAL",
    }

    # Try loading locale file for UI labels
    if lang != "en":
        locale_path = Path(__file__).parent.parent.parent / "viewer" / "public" / "locales" / f"{lang}.json"
        if locale_path.exists():
            import json as _json

            try:
                locale_data = _json.loads(locale_path.read_text(encoding="utf-8"))
                # Map locale keys to our label keys
                key_map = {
                    "export.patient_record": "patient_record",
                    "export.demographics": "demographics",
                    "export.admission": "admission",
                    "export.triage": "triage",
                    "export.initial_vitals": "initial_vitals",
                    "export.march_protocol": "march_protocol",
                    "export.medications": "medications",
                    "export.treatment_orders": "treatment_orders",
                    "export.timeline": "timeline",
                    "export.notes": "notes",
                    "export.age": "age",
                    "export.sex": "sex",
                    "export.weight": "weight",
                    "export.pregnant": "pregnant",
                    "export.language": "language",
                    "export.next_of_kin": "next_of_kin",
                    "export.allergies": "allergies",
                    "export.ward": "ward",
                    "export.room": "room",
                    "export.admitted": "admitted",
                    "export.injury_time": "injury_time",
                    "export.mechanism": "mechanism",
                    "export.regions": "regions",
                    "export.priority": "priority",
                    "export.hemo_class": "hemo_class",
                    "export.gcs_category": "gcs_category",
                    "export.phase": "phase",
                    "export.label": "label",
                    "export.actions": "actions",
                    "export.drug": "drug",
                    "export.dose": "dose",
                    "export.route": "route",
                    "export.regimen": "regimen",
                    "export.time": "time",
                    "export.type": "type",
                    "export.summary": "summary",
                    "export.yes": "yes",
                    "export.no": "no",
                    "export.none_known": "none_known",
                    "export.confidential": "confidential",
                }
                for lk, lbl in key_map.items():
                    if lk in locale_data:
                        labels[lbl] = locale_data[lk]
            except Exception:
                pass

    # ── Translate dynamic content ──
    def tr(text: str) -> str:
        if lang == "en" or not text.strip():
            return text
        try:
            from routes.translate import _translate

            return _translate(text, "en", lang)
        except Exception:
            return text

    pc = {"T1": "#e74c3c", "T2": "#f0a500", "T3": "#3fb950", "T4": "#8b949e"}.get(tri.get("priority", ""), "#58a6ff")

    ev_rows = ""
    for e in ev[:20]:
        ev_rows += f"<tr><td>{e.get('timestamp','')[:16]}</td><td>{e.get('type','')}</td><td>{tr(e.get('summary',''))}</td></tr>"

    march_rows = ""
    for m in p.get("march", []):
        march_rows += f"<tr><td style='font-weight:bold'>{m.get('phase','')}</td><td>{tr(m.get('label',''))}</td><td>{tr(', '.join(m.get('actions', [])))}</td></tr>"

    drug_rows = ""
    for d in p.get("drugs", []):
        warn = f" ⚠ {d['warning']}" if d.get("warning") else ""
        drug_rows += f"<tr><td>{d.get('name','')}</td><td>{d.get('dose','')}</td><td>{d.get('route','')}</td><td>{d.get('regimen','')}{warn}</td></tr>"

    rx_items = ""
    for rx in p.get("rx", []):
        rx_items += f"<li>{tr(rx)}</li>"

    notes_text = tr(r.get("notes", "")) or labels["no"]

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Patient {r.get('id','')}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:monospace;font-size:11px;padding:12px;color:#111}}
  h1{{font-size:16px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:8px}}
  h2{{font-size:12px;background:#eee;padding:3px 6px;margin:8px 0 4px}}
  table{{width:100%;border-collapse:collapse;margin-bottom:8px}}
  td,th{{border:1px solid #999;padding:2px 4px;text-align:left;font-size:10px}}
  th{{background:#ddd}}
  .pri{{display:inline-block;padding:2px 8px;color:#fff;font-weight:bold;border-radius:3px}}
  .grid{{display:grid;grid-template-columns:1fr 1fr;gap:4px}}
  .grid span{{background:#f5f5f5;padding:2px 4px;border:1px solid #ddd}}
  @media print{{body{{padding:0}}}}
</style></head><body>
<h1>{labels['patient_record']} — {r.get('name','Unknown')} <span class="pri" style="background:{pc}">{tri.get('priority','--')}</span></h1>
<p>ID: {r.get('id','')} | Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Status: {r.get('status','')}</p>
<h2>{labels['demographics']}</h2>
<div class="grid">
  <span>{labels['age']}: {r.get('age','--')} {r.get('ageUnit','')}</span>
  <span>{labels['sex']}: {r.get('sex','--')}</span>
  <span>{labels['weight']}: {r.get('weight','--')} kg</span>
  <span>{labels['pregnant']}: {labels['yes'] if r.get('pregnant') else labels['no']}</span>
  <span>{labels['language']}: {r.get('spokenLanguage','--')}</span>
  <span>{labels['next_of_kin']}: {r.get('nextOfKin','--')}</span>
  <span>{labels['allergies']}: {', '.join(r.get('allergies',[])) or labels['none_known']}</span>
  <span>{labels['ward']}: {r.get('wardId','')} / {labels['room']}: {r.get('roomNumber','')}</span>
</div>
<h2>{labels['admission']}</h2>
<div class="grid">
  <span>{labels['admitted']}: {r.get('admittedAt','--')}</span>
  <span>{labels['injury_time']}: {r.get('injuryTime','--')}</span>
  <span>{labels['mechanism']}: {r.get('mechanism','--')}</span>
  <span>{labels['regions']}: {', '.join(r.get('regions',[]))}</span>
</div>
<h2>{labels['triage']}</h2>
<div class="grid">
  <span>{labels['priority']}: {tri.get('priority','')} ({tri.get('priorityLabel','')})</span>
  <span>{labels['hemo_class']}: {tri.get('hemoClass','--')}</span>
  <span>{labels['gcs_category']}: {tri.get('gcsCat','--')}</span>
</div>
<h2>{labels['initial_vitals']}</h2>
<div class="grid">
  <span>HR: {v.get('hr','--')}</span>
  <span>SBP: {v.get('sbp','--')}</span>
  <span>RR: {v.get('rr','--')}</span>
  <span>SpO2: {v.get('spo2','--')}%</span>
  <span>GCS: {v.get('gcs','--')}</span>
  <span>Temp: {v.get('temp','--')}°C</span>
  <span>Pain: {v.get('pain','--')}/10</span>
</div>
{'<h2>' + labels['march_protocol'] + '</h2><table><tr><th>' + labels['phase'] + '</th><th>' + labels['label'] + '</th><th>' + labels['actions'] + '</th></tr>' + march_rows + '</table>' if march_rows else ''}
{'<h2>' + labels['medications'] + '</h2><table><tr><th>' + labels['drug'] + '</th><th>' + labels['dose'] + '</th><th>' + labels['route'] + '</th><th>' + labels['regimen'] + '</th></tr>' + drug_rows + '</table>' if drug_rows else ''}
{'<h2>' + labels['treatment_orders'] + '</h2><ul>' + rx_items + '</ul>' if rx_items else ''}
{'<h2>' + labels['timeline'] + '</h2><table><tr><th>' + labels['time'] + '</th><th>' + labels['type'] + '</th><th>' + labels['summary'] + '</th></tr>' + ev_rows + '</table>' if ev_rows else ''}
<h2>{labels['notes']}</h2><p>{notes_text}</p>
<hr><p style="text-align:center;font-size:9px;color:#666">{labels['confidential']}</p>
</body></html>"""
    return HTMLResponse(content=html)


# ── Shift Report ───────────────────────────────────────────────────────────────


@router.get("/api/reports/shift", response_class=HTMLResponse)
def shift_report(lang: str = "en"):
    """Print-ready shift handoff report — all active patients grouped by ward."""
    patients = []
    for p in DATA_DIR.glob("PAT-*.json"):
        try:
            data = read_json(p)
            if data.get("status") in ("discharged", "transferred"):
                continue
            patients.append(data)
        except Exception:
            continue

    wards: dict[str, list] = {}
    for pt in patients:
        wid = pt.get("wardId", "Unassigned")
        wards.setdefault(wid, []).append(pt)

    pri_order = {"T1": 0, "T2": 1, "T3": 2, "T4": 3, "--": 4}
    for wid in wards:
        wards[wid].sort(key=lambda x: pri_order.get(x.get("triage", {}).get("priority", "--"), 4))

    # ── Labels ──
    sl = {
        "title": "SHIFT HANDOFF REPORT",
        "patients": "patients",
        "name": "Name",
        "room": "Room",
        "pri": "Pri",
        "status": "Status",
        "vitals": "HR/SBP/SpO2",
        "meds": "Meds",
        "allergies": "Allergies",
        "active_patients": "Active Patients",
        "confidential": "Medic Info — Air-Gapped Triage System — CONFIDENTIAL",
    }

    if lang != "en":
        locale_path = Path(__file__).parent.parent.parent / "viewer" / "public" / "locales" / f"{lang}.json"
        if locale_path.exists():
            import json as _json

            try:
                locale_data = _json.loads(locale_path.read_text(encoding="utf-8"))
                key_map = {
                    "shift.title": "title",
                    "shift.patients": "patients",
                    "shift.name": "name",
                    "shift.room": "room",
                    "shift.pri": "pri",
                    "shift.status": "status",
                    "shift.vitals": "vitals",
                    "shift.meds": "meds",
                    "shift.allergies": "allergies",
                    "shift.active_patients": "active_patients",
                    "export.confidential": "confidential",
                }
                for lk, lbl in key_map.items():
                    if lk in locale_data:
                        sl[lbl] = locale_data[lk]
            except Exception:
                pass

    ward_sections = ""
    total = 0
    for wid, pts in sorted(wards.items()):
        total += len(pts)
        rows = ""
        for pt in pts:
            t = pt.get("triage", {})
            v = pt.get("initialVitals", {})
            latest_v = v
            for ev in pt.get("events", []):
                if ev.get("type") == "vitals" and ev.get("data"):
                    latest_v = ev["data"]
                    break
            pc = {"T1": "#e74c3c", "T2": "#f0a500", "T3": "#3fb950", "T4": "#8b949e"}.get(
                t.get("priority", ""), "#58a6ff"
            )
            drugs_str = ", ".join(d.get("name", "") for d in pt.get("plan", {}).get("drugs", [])[:3])
            rows += f"""<tr>
              <td style="border-left:4px solid {pc}">{pt.get('name','?')}</td>
              <td>{pt.get('roomNumber','')}</td>
              <td><b>{t.get('priority','--')}</b></td>
              <td>{pt.get('status','')}</td>
              <td>{latest_v.get('hr','')}/{latest_v.get('sbp','')}/{latest_v.get('spo2','')}</td>
              <td style="font-size:9px">{drugs_str}</td>
              <td>{', '.join(pt.get('allergies',[])) or '-'}</td>
            </tr>"""
        ward_sections += f"""<h2>{wid} ({len(pts)} {sl['patients']})</h2>
        <table><tr><th>{sl['name']}</th><th>{sl['room']}</th><th>{sl['pri']}</th><th>{sl['status']}</th><th>{sl['vitals']}</th><th>{sl['meds']}</th><th>{sl['allergies']}</th></tr>
        {rows}</table>"""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{sl['title']}</title>
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:monospace;font-size:11px;padding:12px;color:#111}}
  h1{{font-size:16px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:4px}}
  h2{{font-size:12px;background:#eee;padding:3px 6px;margin:10px 0 4px}}
  table{{width:100%;border-collapse:collapse;margin-bottom:8px}}
  td,th{{border:1px solid #999;padding:3px 5px;text-align:left;font-size:10px}}
  th{{background:#ddd}}
  @media print{{body{{padding:0}}}}
</style></head><body>
<h1>{sl['title']}</h1>
<p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | {sl['active_patients']}: {total}</p>
{ward_sections}
<hr><p style="text-align:center;font-size:9px;color:#666">{sl['confidential']}</p>
</body></html>"""
    return HTMLResponse(content=html)


# ── Data Replication ──────────────────────────────────────────────────────────


@router.get("/api/patients/snapshot")
def patient_snapshot():
    """Return all patient records as a single JSON array for backup/replication."""
    records = []
    for p in DATA_DIR.glob("PAT-*.json"):
        try:
            records.append(read_json(p))
        except Exception:
            continue
    return records


@router.post("/api/patients/restore")
def patient_restore(records: list[dict[str, Any]]):
    """Restore patient records from a snapshot. Overwrites existing records with same ID."""
    restored = 0
    for rec in records:
        pid = rec.get("id", "")
        if not pid.startswith("PAT-"):
            continue
        write_json(patient_path(pid), rec)
        restored += 1
    return {"restored": restored, "total": len(records)}
