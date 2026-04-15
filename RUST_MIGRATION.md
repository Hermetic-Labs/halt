# HALT — Rust-Native Architecture

> **Status: v1.1.0 — Single binary. Zero Python. All platforms.**

---

## Architecture

HALT v1.1.0 is a **fully self-contained Rust binary**. No Python runtime, no sidecar, no pip dependencies.

```
┌──────────────────────────────────────────────┐
│          halt-triage v1.1.0 (single binary)  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Tauri UI │  │ HTTP REST│  │ Mesh WS   │  │
│  │ (webview)│  │ :7779    │  │ :7778     │  │
│  │ invoke() │  │ (axum)   │  │ (tungstn) │  │
│  └────┬─────┘  └─────┬────┘  └─────┬─────┘  │
│       │              │              │        │
│  ┌────┴──────────────┴──────────────┴────┐   │
│  │         commands/* (shared)           │   │
│  │  patients · translate · tts · stt     │   │
│  │  roster · tasks · inventory · wards   │   │
│  └────┬───────────────┬─────────┬────────┘   │
│       │               │         │            │
│  ┌────┴────┐  ┌──────┴──┐  ┌──┴────────┐   │
│  │ storage │  │ models/ │  │ mesh/     │   │
│  │ (disk)  │  │ ONNX RT │  │ server.rs │   │
│  └─────────┘  └─────────┘  └───────────┘   │
└──────────────────────────────────────────────┘
```

### Three Access Paths

1. **Tauri WebView** — Desktop app (Windows/macOS), uses `invoke()` IPC
2. **HTTP REST** — Field devices (iPads/phones) connect via `http://leader:7779/`
3. **Mesh WebSocket** — Real-time sync on `ws://leader:7778/`, patient updates, chat, WebRTC signaling

All three paths share the same `commands/*` layer — no duplication.

---

## Coverage

89 Tauri commands registered. 25+ HTTP endpoints. Full WebSocket message router.

| Layer | Files | Status |
|-------|:-----:|:------:|
| Foundation | `config.rs`, `storage.rs`, `health.rs` | ✅ Functional |
| Data CRUD | `patients.rs`, `wards.rs`, `roster.rs`, `tasks.rs`, `inventory.rs` | ✅ Functional |
| Inference | `inference.rs`, `stt.rs`, `tts.rs`, `translate.rs` | ✅ Native ML |
| Mesh Network | `server.rs`, `chat.rs`, `alerts.rs`, `video.rs`, `ws_listener.rs` | ✅ Functional |
| Translation Pipelines | `translate_stream.rs` | ✅ Functional |
| Utilities | `export.rs`, `qr.rs`, `distribution.rs`, `setup.rs` | ✅ Functional |
| HTTP Server | `http_server.rs` | ✅ 25+ routes |
| Phonemizer | `models/phonemizer.rs` | ✅ espeak-ng → Kokoro tokens |

---

## Entry Points

| Script | Platform | What It Does |
|--------|----------|-------------|
| `start_rust.bat` | Windows | Tauri native dev (`cargo tauri dev`) |
| `start_rust.command` | macOS | Same for Mac |
| `build_ios.command` | macOS | TestFlight pipeline |

---

## Dependencies

| Crate | Purpose | Status |
|-------|---------|:------:|
| serde, serde_json | Serialization | ✅ Active |
| aes-gcm, rand, base64 | Encryption | ✅ Active |
| chrono, uuid, log | Core utilities | ✅ Active |
| qrcode | QR generation | ✅ Active |
| rcgen | SSL cert generation | ✅ Active |
| ndarray | Tensor manipulation | ✅ Active |
| encoding_rs | Text encoding | ✅ Active |
| tokio | Async runtime | ✅ Active |
| tokio-tungstenite | WebSocket server | ✅ Active |
| axum | HTTP framework | ✅ Active |
| tower-http | CORS, static files | ✅ Active |
| futures-util | Stream utilities | ✅ Active |
| rayon | Parallel iteration | ✅ Feature-gated |
| symphonia | Audio codec | ✅ Feature-gated |
| llama-cpp-2 | LLM inference | ✅ Feature-gated |
| whisper-rs | Speech-to-text | ✅ Feature-gated |
| ort | TTS (ONNX Runtime) | ✅ Feature-gated |
| ct2rs | Translation (NLLB) | ✅ Feature-gated |
| sentencepiece | Tokenizer | ✅ Feature-gated |
| reqwest | Model downloads | ✅ Feature-gated |
| flate2, tar | Archive extraction | ✅ Feature-gated |

---

## File Manifest

```
viewer/src-tauri/src/
├── lib.rs                  ← App lifecycle + server spawns
├── config.rs               ← MODELS_DIR / DATA_DIR
├── storage.rs              ← JSON + AES-256-GCM
├── http_server.rs          ← Axum REST API (:7779)
├── commands/
│   ├── health.rs           ← Model readiness
│   ├── patients.rs         ← 12 commands (full CRUD + events)
│   ├── wards.rs            ← 4 commands
│   ├── roster.rs           ← 6 commands
│   ├── tasks.rs            ← 5 commands
│   ├── inventory.rs        ← 11 commands
│   ├── inference.rs        ← LLM inference
│   ├── stt.rs              ← Whisper STT + symphonia decode
│   ├── tts.rs              ← Kokoro TTS + romaji preprocessing
│   ├── translate.rs        ← NLLB translation + rayon batch
│   ├── export.rs           ← PDF + HTML generation
│   ├── qr.rs               ← QR code generation
│   ├── distribution.rs     ← R2 model downloads
│   └── setup.rs            ← SSL cert management
├── models/
│   ├── phonemizer.rs       ← espeak-ng IPA → Kokoro token IDs
│   ├── llm.rs              ← LLM singleton
│   ├── whisper.rs          ← Whisper singleton
│   ├── kokoro.rs           ← TTS singleton + voice map
│   └── nllb.rs             ← Translation singleton + lang map
└── mesh/
    ├── server.rs           ← Client registry + leader election
    ├── chat.rs             ← Chat + DM + reactions
    ├── alerts.rs           ← Emergency + announcement broadcast
    ├── video.rs            ← WebRTC signaling state
    ├── ws_listener.rs      ← tokio-tungstenite server (:7778)
    └── translate_stream.rs ← Live translation pipeline
```

---

## Migration History

| Version | Architecture | Status |
|---------|-------------|:------:|
| 1.0.0 | Electron + Python | 🪦 Archived |
| 1.0.7 | Tauri + Python sidecar | 🪦 Archived |
| **1.1.0** | **Single Rust binary** | ✅ **Current** |

Legacy Python API preserved at `legacy/api/` (gitignored) for reference.
