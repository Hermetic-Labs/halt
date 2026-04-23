# HALT — Complete Feature Reference (v1.1.0)

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

> 📂 `viewer/src-tauri/src/commands/patients.rs`

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

> 📂 `viewer/src-tauri/src/commands/patients.rs` → `PatientRecord`

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

> 📂 `viewer/src-tauri/src/commands/tasks.rs`

---

## 4. Volunteer Task System

Tasks can be claimed by available staff or volunteers.

- Check vitals
- Administer medication
- Reassess patient
- Update records

> 📂 `viewer/src-tauri/src/commands/tasks.rs`

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

> 📂 `viewer/src-tauri/src/commands/qr.rs` → `mesh_qr()`

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
- Physical hardcopy printouts generated dynamically for manual location auditing.

> 📂 `viewer/src-tauri/src/commands/inventory.rs`
> 📂 `viewer/src/components/InventoryTab.tsx`

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

> 📂 `viewer/src-tauri/src/mesh/alerts.rs`

---

## 8. Medical Protocol System

Supports structured emergency medicine protocols.

- MARCH protocol (Massive hemorrhage, Airway, Respiration, Circulation, Hypothermia)
- Hemorrhage classification
- GCS (Glasgow Coma Scale) categorization
- Triage priority assignment (T1–T4)
- Treatment plan generation with drugs, Rx, recovery, and escalation

> 📂 `viewer/src-tauri/src/commands/patients.rs` → `PatientPlan` model

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
            → Phoneme Compiler strictly maps input to Kokoro boundaries
              → Kokoro TTS speaks Arabic aloud to Person A
```

### Two Translation Paths

| Path | Protocol | Use Case |
|---|---|---|
| **Bridge (WebSocket)** | Real-time streaming | Live chat translation between staff and patients |
| **REST/IPC API** | Single + batch requests | UI label translation, document export |

### Capabilities

- 42 languages supported natively via NLLB-200 (600M parameter distilled model)
- CTranslate2 Rust runtime bindings (no Python required)
- Native phonological translation boundary engine ensuring highly stabilized phonetic output
- Batch translation payload buffers

> 📂 `viewer/src-tauri/src/mesh/translate_stream.rs`
> 📂 `viewer/src-tauri/src/commands/translate.rs`

**Purpose** — A French medic treating a Pashto-speaking patient gets instant two-way translation. No interpreter. No internet. No delay.

---

## 10. Voice Interface

### Speech-to-Text — Faster Whisper

- Voice intake for hands-free documentation
- Multilingual speech recognition
- Voice-to-text for chat messaging

### Text-to-Speech — Kokoro

- Spoken instructions in the patient's language
- Integrated `phoneme_compiler.rs` boundary mapping native scripts and raw IPA into Kokoro's strict 178-token array.
- Ensures 0% dropped tensor inputs for 42 regional dialects.

> 📂 `viewer/src-tauri/src/commands/stt.rs`
> 📂 `viewer/src-tauri/src/commands/tts.rs`
> 📂 `viewer/src-tauri/src/models/phoneme_compiler.rs`

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
- Stale client auto-pruning 
- Up to 20 concurrent clients (WiFi hotspot limit)

> 📂 `viewer/src-tauri/src/mesh/ws_listener.rs`
> 📂 `viewer/src-tauri/src/mesh/chat.rs`

---

## 12. Leadership & Failover

Role-based hierarchy with automatic failover.

- Leader, Medic, Responder role priority system
- Self-promotion endpoint for leadership takeover
- Full state snapshot for leadership handover (patients, roster, tasks)
- Roster auto-updates on WebSocket connect/disconnect

> 📂 `viewer/src-tauri/src/commands/roster.rs`

**Purpose** — If the leader's device goes down, another device can take over without losing data.

---

## 13. Shift Report System

Handles transition between medical shifts.

- All active patients grouped by ward
- Sorted by triage priority (T1 first)
- Latest vitals, medications, allergies at a glance
- Print-ready HTML output
- Multilingual export

> 📂 `viewer/src-tauri/src/commands/export.rs`

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

> 📂 `viewer/src-tauri/src/commands/export.rs`

---

## 15. Emergency Alert System

A dynamic emergency notification system.

- Emergency broadcasts with categories: All Hands, Expediters, Inventory, Bed Assist, Doctors, Intake, Volunteers
- Supply depletion emergencies triggered automatically by inventory system
- Alerts logged to team chat for audit trail
- Sound notifications on receiving devices

> 📂 `viewer/src-tauri/src/mesh/alerts.rs`

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
- Camera capture on mobile (`capture="environment"`)
- Graceful text-only fallback when mmproj file is absent

All models run locally entirely natively invoked by Rust. No data leaves the machine.

> 📂 `viewer/src-tauri/src/commands/inference.rs`
> 📂 `viewer/src-tauri/src/models/*`

---

## 17. Auto-Download Distribution System

Models auto-download on first launch — zero manual setup required.

- 4 model packs: Voice, STT, Translation, AI
- Resumable downloads (Rust backend chunking)
- Event progress payload streaming to UI
- SHA-256 checksum verification
- Sequential multi-pack download queue

> 📂 `viewer/src-tauri/src/commands/distribution.rs`

---

## 18. Native Runtime Environment

The entire system comprises highly portable, self-contained, memory-safe execution loops.

- Written primarily in **Rust** leveraging the **Tauri Shell**.
- Bundles logic directly into MSVC linker `.exe` / `.msi` Windows application pipelines using WiX.
- Cross-platform: MSIX/EXE (Windows), AppImage (Linux), DMG (macOS).
- Embeds UI interface natively offline via WebKit webview frames.
- Replaces legacy Python bloat with standalone system-safe boundaries.

### Benefits

- Deployable in field hospitals
- Minimal compute requirements
- Immediate execution without environmental dependency management
- No internet required after initial model download

> 📂 `viewer/src-tauri/src/main.rs`
> 📂 `viewer/src-tauri/tauri.conf.json`

---

## 19. Offline Neural Diagnostics

A built-in native execution boundary test tool independent of the primary orchestrator.

### Matrix Sweep
Automatically cycles 30+ regional BCP-47 text payloads through NLLB, phonemizers, and TTS binaries to verify semantic pipeline bounds without triggering UI interference.

### Silo Sandbox
Exposes the backend data mutations natively into the UI—granting you real-time visual tracing of the `Raw IPA => Bounded Compiler => Tensor Output` phonological lifecycle tuning.

### Spinal Cord Check
A backend holistic scan guaranteeing memory persistence constraints (Patient file handles, WebRTC socket status, active model health registries) immediately on load.

> 📂 `viewer/src-tauri/src/bin/halt_neural_scan.rs`
> 📂 `viewer/src-tauri/src/commands/diagnostics.rs`

---

## 20. Roster & Staff Management

Track all personnel on duty.

- Staff registration with name and role
- Connection status tracking (connected/offline/pending)
- Auto-status updates via WebSocket (connect → "connected", disconnect → "offline")

> 📂 `viewer/src-tauri/src/commands/roster.rs`

---

## 21. Ward Management & Mapping

Organize the physical layout of the field hospital natively in the UI.

- Ward CRUD (create, update, delete)
- Room/bed assignment per ward
- Visual ward map with patient placement
- **Real-Time Spatial Positioning**: An interactive drag-and-drop SVG Site Map canvas that permits spatial arrangement of wards, tents, assets, and active connections across the physical facility.
- **Facility Hardcopy Printing**: The system leverages invisible iframes to automatically construct formatted physical printouts comprising Ward Layouts, Bed Labels, and the holistic Site Map, enabling offline synchronization directly onto camp walls.

> 📂 `viewer/src-tauri/src/commands/wards.rs`
> 📂 `viewer/src/components/WardMap.tsx`
> 📂 `viewer/src/components/SiteMap.tsx`

---

## 22. Integrated Translator Panel

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
- Text mode: Tauri IPC `invoke('translate_text')` requests for instantaneous routing.
- Contextual replay integration tracking 42 variations natively in memory bounds.

> 📂 `viewer/src/components/TranslatorPanel.tsx`
> 📂 `viewer/src/hooks/useTranslateStream.ts`
> 📂 `viewer/src-tauri/src/mesh/translate_stream.rs`
