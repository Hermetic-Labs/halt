# HALT Stack Map — v1.0.7

> **HALT** — Hermetic Anonymous Local Triage
> `HermeticLabs.HALT-HermeticAnonymousLocalTriage`
> MIT License · © 2026 Hermetic Labs LLC

---

## Frontend (viewer/)

| Layer | Tech | Version | Purpose |
|-------|------|---------|---------|
| **Framework** | React | 19.2.0 | UI components |
| **Language** | TypeScript | 5.9.3 | Type safety |
| **Build** | Vite | 7.3.1 | Dev server + bundler |
| **Bridge** | @tauri-apps/api | 2.10.1 | Rust ↔ JS IPC |
| **CLI** | @tauri-apps/cli | 2.10.1 | Dev/build orchestrator |
| **Fonts** | Inter + JetBrains Mono | 5.2.8 | UI + monospace |
| **Charts** | Recharts | 3.8.0 | Vitals graphing |
| **PWA** | vite-plugin-pwa | 1.2.0 | Offline service worker |
| **Styling** | Vanilla CSS | — | index.css design system |
| **Runtime** | Node.js | 22.21.0 | Dev tooling |

### Frontend Components

```
viewer/src/
├── App.tsx                 ← Root: auth gate + tab router
├── components/
│   ├── OnboardingWizard.tsx ← First-run: EULA → Permissions
│   ├── NetworkTab.tsx       ← Mesh setup, QR, roster, WebSocket
│   ├── CommsPanel.tsx       ← Chat + voice/video calls
│   ├── PatientIntake.tsx    ← 6-step intake form
│   ├── MassCasIntake.tsx    ← 3-tap mass casualty mode
│   ├── TaskBoard.tsx        ← Kanban task management
│   ├── WardMap.tsx          ← Ward/bed assignment grid
│   ├── InventoryTab.tsx     ← Medical supply tracking
│   ├── TriagePanel.tsx      ← AI triage assistant (LLM)
│   ├── DetailView.tsx       ← Reference card renderer
│   ├── DistributionTab.tsx  ← R2 model download manager
│   ├── PublicLookup.tsx     ← /lookup family search page
│   └── NetworkTab.tsx       ← ⬅ MESH MAP would go here or new tab
├── hooks/
│   ├── useWebRTC.ts         ← P2P voice/video calls
│   ├── useChat.ts           ← Chat persistence
│   ├── useTTS.ts            ← Kokoro TTS playback
│   └── useLanguageArray.ts  ← Multi-lang preference
└── services/
    ├── api.ts               ← Dual-mode: fetch() or Tauri invoke()
    ├── i18n.tsx             ← 41-language translation layer
    └── SyncQueue.ts         ← Offline mutation queue
```

---

## Backend — Rust (viewer/src-tauri/)

| Layer | Crate | Version | Purpose |
|-------|-------|---------|---------|
| **Shell** | tauri | 2.10.3 | Native window + IPC |
| **Build** | tauri-build | 2.5.6 | Compile-time codegen |
| **Logging** | tauri-plugin-log | 2.x | Structured log output |
| **Serialization** | serde | 1.0 | JSON ↔ Rust structs |
| **Serialization** | serde_json | 1.0 | JSON parsing/generation |
| **Encryption** | aes-gcm | 0.10 | AES-256-GCM at rest |
| **Random** | rand | 0.8 | Key generation |
| **Encoding** | base64 | 0.22 | Binary ↔ text |
| **Time** | chrono | 0.4 | Timestamps, heartbeat |
| **IDs** | uuid | 1.x (v4) | Patient ID generation |
| **Text encoding** | encoding_rs | 0.8.35 | UTF-8/16 handling |
| **Tensors** | ndarray | 0.17.2 | ONNX tensor I/O |
| **Logging** | log | 0.4 | Log macros |
| **Toolchain** | rustc | 1.91.1 | Compiler |
| **MSRV** | rust-version | 1.77.2 | Minimum supported |

### Native ML Feature (`native_ml`)

| Crate | Version | Purpose | CRT | Vendored? |
|-------|---------|---------|-----|-----------|
| **llama-cpp-2** | 0.1.143 | LLM inference (GGUF) | /MD | No |
| **whisper-rs** | 0.16.0 | Speech-to-text (Whisper) | /MD | No |
| **ort** | 2.0.0-rc.9 | ONNX inference (NLLB) | /MD | No (prebuilt) |
| **ct2rs** | 0.9.18 | CTranslate2 translation | /MD | **Yes** — `vendor/ct2rs/` |
| **esaxx-rs** | 0.1.10 | Suffix array (tokenizer) | /MD | **Yes** — `vendor/esaxx-rs/` |
| **sentencepiece** | 0.13.1 | SentencePiece tokenizer | /MD | No |

### Model Download Feature (`r2_download`)

| Crate | Version | Purpose |
|-------|---------|---------|
| **reqwest** | 0.12 | HTTP client (rustls-tls) |
| **flate2** | 1.x | Gzip decompression |
| **tar** | 0.4 | Archive extraction |
| **futures-util** | 0.3 | Async stream helpers |

### Linker Overrides (build.rs)

```
/FORCE              — ggml symbol duplicates (llama + whisper)
/NODEFAULTLIB:LIBCMT  — exclude static CRT
/NODEFAULTLIB:libcpmt — exclude static C++ CRT
```

### Rust Command Map (83 commands)

```
viewer/src-tauri/src/
├── lib.rs              ← Tauri setup, Python sidecar, exit handler
├── main.rs             ← Entry point
├── config.rs           ← HALT_MODELS_DIR / HALT_DATA_DIR
├── storage.rs          ← JSON file I/O, encryption
├── commands/
│   ├── patients.rs     ← CRUD, MARCH, vitals, events
│   ├── export.rs       ← PDF + HTML + shift report
│   ├── inference.rs    ← LLM chat + triage scoring
│   ├── stt.rs          ← Whisper speech-to-text
│   ├── tts.rs          ← Kokoro TTS proxy
│   ├── distribution.rs ← R2 model downloader
│   ├── setup.rs        ← Device discovery, QR, certs
│   └── qr.rs           ← QR code generation
├── mesh/
│   ├── server.rs       ← WebSocket hub + client state
│   ├── chat.rs         ← Mesh chat persistence
│   ├── alerts.rs       ← Emergency/announcement broadcast
│   ├── tasks.rs        ← Distributed task board
│   ├── video.rs        ← WebRTC signaling relay
│   └── translate_stream.rs ← Live translation pipeline
└── models/
    └── nllb.rs         ← NLLB-200 ONNX translation engine
```

---

## Backend — Python (api/)

> Sidecar process spawned by Tauri on desktop. Serves `/health`, `/api/*`, `/ws/*`, `/tts/*`.

| Layer | Package | Version | Purpose |
|-------|---------|---------|---------|
| **Framework** | FastAPI | 0.115.5 | REST + WebSocket API |
| **Server** | Uvicorn | 0.30.1 | ASGI server (HTTP + WSS) |
| **Runtime** | Python | 3.13.9 | Interpreter |
| **TTS** | Kokoro | — | Text-to-speech synthesis |

---

## Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│  TAURI WINDOW (WebView2 / Edge Chromium)                     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  React 19 (Vite HMR)                                 │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │    │
│  │  │ TaskBoard│ │CommsPanel│ │ Intake   │ │ WardMap │ │    │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │    │
│  │       │             │            │             │      │    │
│  │       ▼             ▼            ▼             ▼      │    │
│  │  ┌──────────────────────────────────────────────────┐ │    │
│  │  │       api.ts  (dual-mode dispatcher)             │ │    │
│  │  │  Tauri? → invoke()     Browser? → fetch()        │ │    │
│  │  └──────────┬──────────────────────┬────────────────┘ │    │
│  └─────────────┼──────────────────────┼──────────────────┘    │
│                │ IPC                  │ HTTP/WS               │
│       ┌────────▼────────┐    ┌────────▼────────┐              │
│       │   RUST BACKEND  │    │ PYTHON SIDECAR  │              │
│       │   (83 commands) │    │  (FastAPI)       │              │
│       │                 │    │                  │              │
│       │  patients.rs    │    │  /health         │              │
│       │  inference.rs ──┼────│  /tts/*          │              │
│       │  stt.rs         │    │  /ws/{id}        │              │
│       │  mesh/server.rs │    │                  │              │
│       │  models/nllb.rs │    │  Kokoro TTS      │              │
│       └────────┬────────┘    └──────────────────┘              │
│                │                                               │
│       ┌────────▼────────┐                                      │
│       │   LOCAL DISK    │                                      │
│       │  patients/*.json│  ← AES-256 encrypted                 │
│       │  models/        │  ← GGUF, ONNX, Whisper               │
│       └─────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Network / Mesh Topology

```
┌──────────────┐       WebSocket        ┌──────────────┐
│   LEADER     │◄──────/ws/{id}────────►│   CLIENT     │
│  (Desktop)   │                        │  (Phone/PWA) │
│              │       HTTP REST        │              │
│  :7778 HTTP  │◄──────/api/*──────────►│  via WiFi    │
│  :7779 HTTPS │                        │              │
│              │       WebRTC P2P       │              │
│  Rust + Py   │◄ ─ ─ voice/video ─ ─ ►│  Browser     │
└──────────────┘                        └──────────────┘
       ▲                                       ▲
       │            QR Code Join               │
       │    ┌──────────────────────┐           │
       └────│  /mesh/qr?name&role │───────────┘
            │  → generates URL    │
            │  → scanned by phone │
            └──────────────────────┘
```

### Mesh I/O Summary

| Endpoint | Method | Returns | Polling |
|----------|--------|---------|---------|
| `/mesh/clients` | GET | `MeshClient[]` | 3s |
| `/mesh/status` | GET | `{ connected, leader, local_ip }` | — |
| `/mesh/qr` | GET | `{ qr_image, app_url }` | — |
| `/roster` | GET/POST/DELETE | `RosterMember[]` | 3s |
| `/ws/{client_id}` | WS | Real-time events | heartbeat 5s |
| `/health` | GET | `{ gguf, onnx, whisper }` | startup |

---

## Ports

| Port | Protocol | Service |
|------|----------|---------|
| **7777** | HTTP | Vite dev server (frontend) |
| **7778** | HTTP | Python API (FastAPI/Uvicorn) |
| **7779** | HTTPS | Python API (TLS for mobile) |
