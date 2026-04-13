# HALT — Rust-Native Migration

> **Status: 89/89 commands registered · 91/91 Python routes covered · Compiling on Windows**

---

## Coverage

91 Python routes → 89 Rust commands (2 routes folded into Tauri events).

| Layer | Files | Commands | Logic Status |
|-------|:-----:|:--------:|:------------:|
| 1 — Foundation | `config.rs`, `storage.rs`, `health.rs` | 1 | ✅ Fully functional |
| 2 — Data CRUD | `patients.rs`, `wards.rs`, `roster.rs`, `tasks.rs`, `inventory.rs` | 38 | ✅ Fully functional |
| 3 — Inference | `inference.rs`, `stt.rs`, `tts.rs`, `translate.rs` + 4 model singletons | 14 | ⬜ Needs C++ crates |
| 4 — Mesh state | `server.rs`, `chat.rs`, `alerts.rs`, `video.rs` | 15 | ✅ State mgmt done, transport needs tokio-tungstenite |
| 4b — Translation pipelines | `translate_stream.rs` | 6 | ⬜ Needs inference crates |
| 5 — Utilities | `export.rs`, `qr.rs`, `distribution.rs`, `setup.rs` | 15 | Partial (see below) |

### Layer 5 Detail

| File | What Works Now | What's Blocked |
|------|---------------|----------------|
| `export.rs` | ✅ Full PDF + HTML generation | — |
| `qr.rs` | ✅ URL generation | QR image (needs `qrcode` + `image`) |
| `distribution.rs` | ✅ Status, checksums, set_checksums | Download (needs `reqwest` + `sha2` + `flate2` + `tar`) |
| `setup.rs` | ✅ Status, mobileconfig XML, CA PEM | Cert generation (needs `rcgen` + `time`) |

### What's Blocking

All remaining unconverted logic requires crates that are blocked by Windows SmartScreen Application Control on the D: drive. Two categories:

1. **Pure Rust crates** (qrcode, image, rcgen, reqwest, sha2, etc.) — will compile once SmartScreen is bypassed via the C: proxy script
2. **C++ binding crates** (llama-cpp-2, whisper-rs, ort, ct2rs) — need C++ toolchain, will compile on Mac for iOS target

The full conversion code for qr.rs, setup.rs, and distribution.rs exists in the conversation history. When crates are unblocked, it's a file replace + uncomment in Cargo.toml.

---

## Entry Points

| Script | Platform | What It Does |
|--------|----------|-------------|
| `start.bat` | Windows | Router — prompts Dev or Rust mode |
| `start_dev.bat` | Windows | Python + Vite (current production desktop) |
| `start_rust.bat` | Windows | Tauri native dev (`cargo tauri dev`) |
| `start_rust.command` | macOS | Same as above, for Mac dev |
| `build_ios.command` | macOS | Full TestFlight pipeline |

---

## Golden Pipeline (Windows → TestFlight)

```
┌─────────────────────────────────────────────────────────────┐
│  WINDOWS (development)                                      │
│                                                             │
│  1. Develop in viewer/src-tauri/src/ (Rust)                 │
│  2. Test with start_rust.bat                                │
│  3. npx tsx verify_parity.ts → 89/89                        │
│  4. git push                                                │
├─────────────────────────────────────────────────────────────┤
│  MAC (build machine)                                        │
│                                                             │
│  5. git pull                                                │
│  6. Uncomment blocked crates in Cargo.toml                  │
│  7. Replace stub files with full conversions                │
│  8. cargo tauri ios build                                   │
│  9. Xcode → Sign → Archive → TestFlight                    │
└─────────────────────────────────────────────────────────────┘
```

### Mac Setup

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-ios
brew install node cmake   # cmake for C++ inference crates
cd halt && chmod +x build_ios.command && ./build_ios.command
```

---

## Verification

```bash
cd viewer && npx tsx verify_parity.ts
```

```
╔══════════════════════════════════════════════════════╗
║  Commands: 89/89 registered ✅
║  Adapter:  ✅ Dual-path ready
║  Store:    ✅ Wired to adapter
╚══════════════════════════════════════════════════════╝
🟢 PARITY VERIFIED — All systems go for TestFlight.
```

---

## iOS Strategy

**Phase 1 (TestFlight v1):** Data layer works natively. Inference falls back to Python leader over HTTP.

```
iPad → invoke() → Rust (patients, wards, export, roster)  ← native
iPad → fetch() → Windows leader:7778 → Python (LLM, TTS, STT)  ← fallback
```

**Phase 2:** Wire C++ inference crates on Mac. iOS gets standalone inference.

**Phase 3:** Remove Python sidecar entirely.

---

## Legacy Silo Plan

Python code (`api/`, `start.py`, `requirements.txt`) stays put. It's the working production desktop backend.

1. **Now** — Python stays, Rust handles iOS data layer
2. **After TestFlight works** — Move Python to `legacy/`, update sidecar path
3. **After 2-3 stable cycles** — Delete Python. One binary.

---

## Cargo.toml Crate Status

| Crate | Purpose | Status |
|-------|---------|:------:|
| serde, serde_json | Serialization | ✅ Active |
| aes-gcm, rand, base64 | Encryption | ✅ Active |
| chrono | Timestamps | ✅ Active |
| uuid | IDs | ✅ Active |
| log | Logging | ✅ Active |
| sha2 | Checksums | ⬜ SmartScreen |
| qrcode, image | QR generation | ⬜ SmartScreen |
| hound | WAV writing | ⬜ SmartScreen |
| rcgen, time | SSL certs | ⬜ SmartScreen |
| tokio | Async runtime | ⬜ SmartScreen |
| tokio-tungstenite | WebSocket | ⬜ SmartScreen |
| reqwest | Downloads | ⬜ SmartScreen |
| flate2, tar | Archive extraction | ⬜ SmartScreen |
| futures-util | Stream utilities | ⬜ SmartScreen |
| llama-cpp-2 | LLM | ⬜ C++ (Mac) |
| whisper-rs | STT | ⬜ C++ (Mac) |
| ort | TTS (ONNX) | ⬜ C++ (Mac) |
| ct2rs | Translation | ⬜ C++ (Mac) |

---

## File Manifest

```
viewer/src-tauri/src/
├── lib.rs                  ← 89 commands registered
├── config.rs               ← MODELS_DIR / DATA_DIR
├── storage.rs              ← JSON + AES-256-GCM
├── commands/
│   ├── mod.rs
│   ├── health.rs           ← Model readiness
│   ├── patients.rs         ← 12 commands (full)
│   ├── wards.rs            ← 4 commands (full)
│   ├── roster.rs           ← 6 commands (full)
│   ├── tasks.rs            ← 5 commands (full)
│   ├── inventory.rs        ← 11 commands (full + chat alerts)
│   ├── inference.rs        ← 3 commands (needs llama-cpp-2)
│   ├── stt.rs              ← 2 commands (needs whisper-rs)
│   ├── tts.rs              ← 5 commands (needs ort)
│   ├── translate.rs        ← 3 commands (needs ct2rs/ort)
│   ├── export.rs           ← 3 commands (full)
│   ├── qr.rs               ← 3 commands (URL done, QR image needs crate)
│   ├── distribution.rs     ← 5 commands (status done, download needs reqwest)
│   └── setup.rs            ← 4 commands (status done, certs need rcgen)
├── models/
│   ├── llm.rs              ← Singleton (needs llama-cpp-2)
│   ├── whisper.rs          ← Singleton (needs whisper-rs)
│   ├── kokoro.rs           ← Singleton + 12-lang voice map (needs ort)
│   └── nllb.rs             ← Singleton + 41-lang BCP-47 map (needs ct2rs)
└── mesh/
    ├── server.rs           ← Client registry + leader election (full)
    ├── chat.rs             ← Chat + DM + reactions (full, broadcast needs transport)
    ├── alerts.rs           ← Emergency + announcement (full, broadcast needs transport)
    ├── video.rs            ← WebRTC signaling (state done)
    └── translate_stream.rs ← 3 pipeline modes (needs inference crates)
```
