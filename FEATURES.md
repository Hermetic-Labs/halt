# HALT — Complete Feature Reference (v1.0.6)

> **A portable AI-assisted emergency hospital operating system designed for chaotic or low-infrastructure environments.**
>
> Combines triage, patient management, supply logistics, multilingual communication, volunteer coordination, and AI medical assistance into one deployable platform.

---

## 1. Patient Intake & Registration

Handles entry of patients into the system.

- Patient registration with demographics, allergies, and spoken language
- Rapid triage data capture (priority, hemorrhage class, GCS)
- Ward and bed assignment
- Mass casualty intake mode for rapid registration
- Patient opt-in for public family lookup
- Injury mechanism and body region tracking

> 📂 `api/routes/patients.py` → `POST /api/patients`

**Purpose** — Quickly organize incoming patients during both normal and disaster scenarios.

---

## 2. Patient Records & Detail Panel

Each patient has a full detail panel containing:

- Patient photo (file attachment)
- Treatment plan (MARCH protocol, drugs, Rx orders, escalation)
- Medication list with dosage, route, and regimen
- Vitals history (growing event timeline)
- Notes
- Task history
- Ward and bed location
- Next of kin and spoken language

> 📂 `api/routes/patients.py` → `GET /api/patients/{id}`, model: `PatientRecord`

Central location for all patient data, updated continuously during care.

---

## 3. Patient Monitoring

### Vitals Tracking

- Volunteers or staff record vitals
- Vitals automatically added to growing patient chart via event log
- Visual history of patient condition over time

### Medication Tracking

- Medication administration recorded as events
- System automatically schedules next medication task

### Recurring Care Tasks

When care actions occur, the system generates the next required task.

| Trigger | Result |
|---|---|
| Vitals taken | Schedule next vitals check |
| Medication administered | Schedule next dose |

Tasks include countdown timers, due times, and task ownership.

> 📂 `api/routes/patients.py` → `POST /api/patients/{id}/events`, `api/routes/tasks.py`

---

## 4. Volunteer Task System

Tasks can be claimed by available staff or volunteers.

- Check vitals
- Administer medication
- Reassess patient
- Update records

> 📂 `api/routes/tasks.py`

**Purpose** — Coordinate care in chaotic environments, prevent missed follow-ups, and distribute workload dynamically.

---

## 5. Public Patient Lookup (QR System)

Family members can locate patients without staff assistance.

### How It Works

1. A single QR code links to the triage server on the local network
2. Patients can opt-in to public visibility during intake
3. Family scans QR code on their phone
4. Displays: patient name, ward, bed location, and photo (if uploaded)

### Benefits

- Eliminates long ER information lines
- Reduces front desk workload
- Works anywhere with a printed QR code — no internet required

> 📂 `api/routes/patients.py:92` → `GET /api/public/patients`
> 📂 `api/routes/mesh.py:382` → `GET /api/mesh/qr` (generates QR with embedded WiFi + app URL)

---

## 6. Ad-Hoc Inventory System

Any location can become a supply inventory.

**Examples** — closet, ambulance, tent, vehicle trunk, supply bin

- Dynamic inventory locations (create, rename, delete)
- Stock tracking with minimum thresholds
- Supply usage logging with user attribution
- Automatic supply alternatives when items run low
- Activity log (who consumed/restocked what, when)
- Auto-cascade: deleting a location moves items to default

> 📂 `api/routes/inventory.py` → full CRUD + `PATCH /api/inventory/{id}/consume`

---

## 7. Predictive Supply Consumption & Auto-Alerts

Treatment plans interact with inventory.

### Flow

1. Patient checked in
2. Treatment plan generated
3. Required supplies identified
4. System prompts staff to consume supplies
5. Inventory updates automatically

### Auto-Alert System

When stock drops below threshold, the system automatically:

| Stock Level | Action |
|---|---|
| Below minimum | Broadcasts `⚠️ SUPPLY ALERT` to all connected devices |
| Reaches zero | Triggers `🚨 SUPPLY EMERGENCY` with alternatives |

Alerts are logged to the team chat and pushed via WebSocket to all connected clients.

> 📂 `api/routes/inventory.py:171` → auto-alert logic inside `consume_inventory()`

---

## 8. Medical Protocol System

Supports structured emergency medicine protocols.

- MARCH protocol (Massive hemorrhage, Airway, Respiration, Circulation, Hypothermia)
- Hemorrhage classification
- GCS (Glasgow Coma Scale) categorization
- Triage priority assignment (T1–T4)
- Treatment plan generation with drugs, Rx, recovery, and escalation

> 📂 `api/routes/patients.py:44` → `PatientPlan` model with `march`, `drugs`, `rx`, `recovery`, `escalate`

**Purpose** — Guide clinicians and volunteers and standardize triage response.

---

## 9. Real-Time Translation Bridge

A persistent WebSocket translation bridge enabling **real-time person-to-person communication across languages**.

### How It Works

```
Person A speaks Arabic
  → Faster Whisper transcribes to Arabic text
    → Translation Bridge converts Arabic → English
      → English text delivered to Person B
        → Person B responds in English
          → Bridge converts English → Arabic
            → Phoneme conversion via eSpeak
              → Kokoro TTS speaks Arabic aloud to Person A
```

### Two Translation Paths

| Path | Protocol | Use Case |
|---|---|---|
| **Bridge (WebSocket)** | Real-time streaming | Live chat translation between staff and patients |
| **REST API** | Single + batch requests | UI label translation, document export |

### Capabilities

- 42 languages supported via NLLB-200 (600M parameter distilled model)
- CTranslate2 runtime (no PyTorch required) — fast, lean
- SentencePiece tokenization with NLLB BCP-47 language codes
- Phoneme transliteration via eSpeak for languages Kokoro wasn't trained on
- Batch translation endpoint for reduced HTTP overhead

> 📂 `api/bridge.py` → WebSocket at `/api/bridge/translate` (real-time translation + phonemization)
> 📂 `api/routes/translate.py` → `POST /api/translate`, `POST /api/translate/batch`

**Purpose** — A French medic treating a Pashto-speaking patient gets instant two-way translation. No interpreter. No internet. No delay.

---

## 10. Voice Interface

### Speech-to-Text — Faster Whisper

- Voice intake for hands-free documentation
- Multilingual speech recognition
- Voice-to-text for chat messaging

### Text-to-Speech — Kokoro

- Spoken instructions in the patient's language
- Novel phoneme-based synthesis for languages the model was never trained on
- eSpeak phonemizer converts native text → IPA phonetics → Kokoro output

> 📂 `api/routes/stt.py` (speech-to-text), `api/routes/tts.py` (text-to-speech)
> 📂 `api/bridge.py:125` → `transliterate_phonetics()` (eSpeak → IPA pipeline)

---

## 11. Mesh Network Communication

Real-time WebSocket-based mesh network connecting multiple devices over local WiFi.

### Chat System

- Broadcast messages to all connected staff
- Direct messages (DMs) with per-pair thread storage
- Reply threading (reply-to message references)
- Emoji reactions on messages
- Chat history persistence (last 500 messages)

### Emergency & Announcements

- Emergency broadcasts with category targeting (All Hands, Doctors, Intake, Volunteers, etc.)
- General announcements pushed to all devices
- Emergency and announcement entries auto-logged to team chat

### Voice & Video Calls

- WebRTC signaling relay (offer/answer/ICE candidate forwarding)
- Call request, accept, reject, and end flow
- Voice and video call types

### Device Coordination

- QR onboarding — scan to connect (encodes WiFi SSID + app URL + name/role)
- Real-time patient sync — new/updated patients broadcast to all devices
- Client join/leave notifications
- Stale client auto-pruning (60-second timeout)
- Up to 20 concurrent clients (WiFi hotspot limit)

> 📂 `api/routes/mesh.py` → WebSocket at `/ws/{client_id}`, REST endpoints under `/api/mesh/*`

---

## 12. Leadership & Failover

Role-based hierarchy with automatic failover.

- Leader, Medic, Responder role priority system
- Self-promotion endpoint for leadership takeover
- Full state snapshot for leadership handover (patients, roster, tasks)
- Roster auto-updates on WebSocket connect/disconnect

> 📂 `api/routes/mesh.py:164` → `POST /api/mesh/promote`
> 📂 `api/routes/mesh.py:141` → `GET /api/mesh/snapshot`

**Purpose** — If the leader's device goes down, another device can take over without losing data.

---

## 13. Shift Report System

Handles transition between medical shifts.

- All active patients grouped by ward
- Sorted by triage priority (T1 first)
- Latest vitals, medications, allergies at a glance
- Print-ready HTML output
- Multilingual export (pass `?lang=xx`)

> 📂 `api/routes/patients.py:557` → `GET /api/reports/shift`

**Purpose** — Ensure continuity of care between shifts.

---

## 14. Patient Export & Medevac Handoff

Print-ready patient records for transfer or evacuation.

### PDF Export

- Complete patient record rendered as PDF (no external libraries)
- Demographics, triage, vitals, MARCH protocol, medications, timeline

### HTML Export (Medevac)

- Print-optimized HTML with full clinical detail
- Multilingual — UI labels and dynamic content translated via NLLB
- Includes triage color-coding, event timeline (last 20), and treatment orders

### Data Replication

- Full patient snapshot API for backup
- Restore endpoint to ingest snapshot on new device

> 📂 `api/routes/patients.py:259` → `GET /api/patients/{id}/pdf` (PDF)
> 📂 `api/routes/patients.py:392` → `GET /api/patients/{id}/export` (HTML medevac)
> 📂 `api/routes/patients.py:662` → `GET /api/patients/snapshot` + `POST /api/patients/restore`

---

## 15. Emergency Alert System

A dynamic emergency notification system.

- Emergency broadcasts with categories: All Hands, Expediters, Inventory, Bed Assist, Doctors, Intake, Volunteers
- Supply depletion emergencies triggered automatically by inventory system
- Alerts logged to team chat for audit trail
- Sound notifications on receiving devices

> 📂 `api/routes/mesh.py:217` → `POST /api/mesh/emergency`
> 📂 `api/routes/mesh.py:264` → `POST /api/mesh/announcement`
> 📂 `api/routes/mesh.py:189` → `POST /api/mesh/alert` (targeted or broadcast)

**Purpose** — Rapidly notify responsible personnel and reduce communication delays.

---

## 16. AI Model Layer

| Model | Role | Runtime |
|---|---|---|
| MedGemma 1.5 4B | Medical reasoning, differential diagnosis, drug interactions | llama.cpp (GGUF) |
| MedGemma 1.5 mmproj | Multimodal vision — X-ray, CT scan, wound photography | llava (SigLIP) |
| NLLB-200 600M | Neural machine translation (42 languages) | CTranslate2 |
| Faster Whisper | Speech-to-text (multilingual) | CTranslate2 |
| Kokoro | Text-to-speech (multilingual via phoneme bridge) | ONNX Runtime |

### Medical Imaging (MedGemma Vision)

- Attach wound photos, X-rays, CT scans, or general medical images via `+` button
- AI provides visual triage: wound classification, fracture identification, foreign body detection
- SigLIP vision projector encodes images into MedGemma's context
- Browser-side resize to 1536px max before base64 encoding
- Camera capture on mobile (`capture="environment"`)
- Graceful text-only fallback when mmproj file is absent

All models run locally. No data leaves the machine.

> 📂 `api/routes/inference.py` → MedGemma (prefers `medgemma*.gguf`)
> 📂 `api/routes/translate.py` → NLLB-200 via CTranslate2
> 📂 `api/routes/stt.py` → Faster Whisper
> 📂 `api/routes/tts.py` → Kokoro via ONNX Runtime

---

## 17. Auto-Download Distribution System

Models auto-download on first launch — zero manual setup required.

- 4 model packs: Voice (89 MB), STT (141 MB), Translation (2.3 GB), AI (2.4 GB)
- Resumable downloads (HTTP Range support)
- Server-Sent Events (SSE) progress streaming
- SHA-256 checksum verification
- Sequential multi-pack download queue

> 📂 `api/routes/distribution.py` → `POST /api/distribution/download`, `GET /api/distribution/progress`
> 📂 `start.py:88` → `ensure_models()` (auto-download from public R2 bucket)

---

## 18. Portable Runtime Environment

The entire system is self-contained.

- Portable Python (standalone, no system install required)
- Embedded dependencies (all wheels bundled)
- Bundled AI models (auto-download on first launch)
- Progressive Web App (PWA) with service worker for offline frontend
- Cross-platform: Windows (Electron) and macOS (standalone Python)

### Benefits

- Deployable in field hospitals
- Zero setup — `python start.py` and go
- Works in low-infrastructure environments
- No internet required after initial model download

> 📂 `start.py` → unified entry point
> 📂 `dev/build_and_deploy.py` → `--platform win` / `--platform mac`

---

## 19. Roster & Staff Management

Track all personnel on duty.

- Staff registration with name and role
- Connection status tracking (connected/offline/pending)
- Auto-status updates via WebSocket (connect → "connected", disconnect → "offline")

> 📂 `api/routes/roster.py`

---

## 20. Ward Management

Organize the physical layout of the field hospital.

- Ward CRUD (create, update, delete)
- Room/bed assignment per ward
- Visual ward map with patient placement

> 📂 `api/routes/wards.py`

---

## 21. Integrated Translator Panel

A turn-based field translation system embedded directly in the triage workspace.

### Dual-Mode Input

| Mode | Behavior |
|---|---|
| **Stream** (default) | Mic → Whisper STT → NLLB translate → Kokoro TTS → auto-play |
| **Text** | Manual text entry or mic-to-text dictation → NLLB translate → optional TTS |

### Field-Hardened Controls

- **Tap-to-talk mic** — single tap to start, single tap to stop (no hold-to-speak — works with bloody gloves)
- Mic automatically disabled during TTS playback (prevents feedback loop)
- Toggle pills: `Stream` (blue) and `Auto Play` (green) in header
- Auto-growing textarea with word wrap in text mode

### Translation Pipeline

- Full-duplex WebSocket: audio chunks → server accumulates → Whisper STT → NLLB translate → Kokoro TTS → WAV stream back
- Text mode: REST `POST /api/translate` for typed/dictated input
- Turn-based speaker switching with pulsing direction arrow
- Chat history with per-message replay

### Known Limitations

| Language | Whisper Support |
|---|---|
| Amharic (am) | ❌ Auto-detect fallback |
| Hausa (ha) | ❌ Auto-detect fallback |
| Kurdish (ku) | ❌ Auto-detect fallback |

NLLB translation and Kokoro TTS still function for these — only STT is affected.

> 📂 `viewer/src/components/TranslatorPanel.tsx` → UI component
> 📂 `viewer/src/hooks/useTranslateStream.ts` → WebSocket hook
> 📂 `api/routes/translate_stream.py` → Backend WebSocket pipeline
> 📂 `api/routes/translate.py` → REST text translation
