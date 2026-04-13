# Changelog

All notable changes to HALT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.7] — 2026-04-13

### Architecture Overhaul: Native Tauri & Cloud CI 🚀

HALT has successfully graduated from its legacy Electron/Python scaffolding into a pure, high-performance **Native Rust + Tauri v2** architecture. This massive optimization completely decouples the heavy inference models from the distribution binary, dropping the initial download size from ~5 Gigabytes down to a mere ~100 Megabytes, while increasing hardware acceleration stability.

### Added

- **Multi-Platform Cloud CI/CD** — Completely automated GitHub Actions pipeline (`release.yml`) that spins up pristine Microsoft and Apple cloud servers to compile, codesign, and autonomously publish both `.msix` and `.dmg` App Containers straight to the Microsoft Partner Portal and Apple TestFlight simultaneously.
- **Native Async R2 Streaming** — Engineered a fully asynchronous `reqwest + rustls` byte-streaming pipeline in Rust. The Tauri native backend now securely taps the Cloudflare R2 bucket and pipes the 4.5GB model payloads directly onto the user's hard drive (`.tar.gz` via `flate2`) completely bypassing browser memory limits.
- **Event Bus IPC UI** — The React frontend has been re-wired to listen directly to native generic `tauri::app.emit` signals, guaranteeing exact byte-for-byte visual download completion telemetry.
- **Automated AI Packer** — Background script (`pack_models.py`) mapping the raw GGUF/ONNX/CT2 schemas into 4 optimized, multi-threaded `.tar.gz` bundles (`voice`, `stt`, `translation`, `ai`) to optimize payload transmission.

### Removed

- **Legacy Electron Deprecation** — Ripped out the heavy Electron web-shell and unmaintained Python deployment hooks (`build_and_deploy.py`), retiring localized laptop compilation in favor of the Cloud Builder.
- **Payload Bloat** — Systematically destroyed ~35 GB of redundant Alpha Windows compilation artifacts polluting the Cloudflare CDN, establishing a clean, 4-bundle payload logic natively agnostic across Windows, macOS, and iOS environments.

---

## [1.0.6] — 2026-04-05

### Added

- **Integrated Translator Panel** — turn-based field translator embedded in triage panel (replaces full-screen overlay)
  - Dual-mode input: **Stream** (mic → Whisper → NLLB → Kokoro full pipeline) and **Text** (text box + manual submit)
  - Toggle pills in header: `Stream` (blue) and `Auto Play` (green), both default ON
  - **Tap-to-talk mic** — single tap to start recording, single tap to stop (no hold-to-speak — works with bloody gloves)
  - Mic disabled during TTS playback to prevent feedback loop (shows speaker icon)
  - Text mode: auto-growing textarea with word wrap, mic acts as dictation tool filling the text box
  - Turn-based speaker switching with pulsing direction arrow and active speaker indicator
  - Auto-play TTS on translation completion (gated by toggle)
  - Live transcription bubble (dashed border) while Whisper processes, hides cleanly when chat card commits (no flicker)
  - Chat history with replay button per message
- **Translate Stream WebSocket** — `api/routes/translate_stream.py` full-duplex pipeline: audio → STT → NLLB → TTS → WAV playback
- **useTranslateStream hook** — React hook managing WebSocket lifecycle, recording, and state machine
- **MedGemma 1.5 Vision** — multimodal wound/injury image analysis via camera or file upload
  - Supports X-ray, CT scan, wound photography, and general medical imaging
  - SigLIP vision projector (mmproj-f16) for image encoding
  - Browser-side resize to 1536px max before base64 encoding
  - Graceful text-only fallback when mmproj file is absent

### Changed

- Toolbar: removed duplicate translate button, replaced chat icon with muted blue SVG outline
- Translator: removed redundant `◀ English │ Español ▶` header labels (replaced with toggle pills)
- Version bumped to 1.0.6 across all manifests

### Fixed

- **Translator flicker** — live transcription bubble no longer briefly coexists with committed chat card (render-frame race condition)

### Documented

- Translation bridge known limitations: Amharic, Hausa, Kurdish not natively supported by Faster Whisper (auto-detect fallback)
- VAD architecture: `vad_filter=True` operates post-hoc only; no real-time VAD-based chunking

## [Unreleased]

## [1.0.5] — 2026-04-01

### Added

- Model readiness health gate — startup polls `/health` and shows GGUF/ONNX/Whisper status before UI access
- Processing indicator in Triage AI — pulsing spinner while waiting for LLM response
- Empty response guard — error card when AI returns nothing instead of silent blank
- Structured inventory activity log — `action_type` + `qty` fields for full i18n of "Took 5x" / "Added 3x"
- Client-side patient lookup — fetches all opted-in patients on mount, live filters as you type
- 14 new i18n keys: triage errors, inventory verbs, lookup status, discharge labels
- Feature list audit: 20 → 24 features (added Family Lookup, Ward Printing, Discharge QR, 42-Language UI, Low Power, Encryption)

### Fixed

- Electron print workflow — replaced `window.open` (blocked by Electron) with iframe-based `printViaIframe()` helper
- TTS crash on translate — wrapped auto-play in try/catch to prevent white-screen on Kokoro failure
- Mobile mic button hidden — uses native keyboard voice input instead of unreliable custom recorder
- Mobile tap targets — close/send buttons enlarged to 44×44px minimum per accessibility guidelines
- Public patient lookup endpoint — added `?all=1` parameter for client-side filtering architecture

### Changed

- Status badge: alpha → beta
- README feature table audited against actual codebase (24 features verified)
- macOS platform status: "🟡 Needs portable Python" → "✅ Planned" (native Mac build approach)
- Version synced across: README, FEATURES.md, api/main.py, start.py, electron-launcher/package.json

---

## [1.0.3] — 2026-03-29

### Added

- Chat multi-language fan-out — every message auto-translated to 34 languages server-side; clients display in their own language with no extra requests
- Public patient lookup QR code endpoint (`GET /api/public/qr`) — generates a printable QR linking families directly to the patient lookup page
- Patient Lookup QR panel in Settings — lazy-loaded, printable, shows live server URL
- GitHub CI workflow — Python F-code lint + TypeScript typecheck + ESLint on every push and PR
- Pull request template with medical safety checklist and offline-first reminder
- Full React frontend source committed to repo (`viewer/src/`) — open for contributions

### Fixed

- Announcement audio encoding: sender-side TTS response was parsed as JSON (broke audio); corrected to blob → base64
- Emergency broadcast `NameError`: `ward_bed` and `notes_str` used before assignment in chat log entry
- `broadcast_mesh` concurrent modification: snapshot `MESH_WS.items()` before iteration to prevent `RuntimeError`
- Unused imports: `os` in mesh QR endpoint, `urllib.parse` in patients QR endpoint
- ESLint `no-useless-escape` in `App.tsx` (`\/` inside template literal)

### Changed

- Electron splash screen: replaced spinning indicator and attempt counter with a clean logo + animated progress bar
- `viewer/package.json` version synced to `1.0.3-alpha`
- `FEATURES.md` version synced to `1.0.3-alpha`
- `start.py` docstring corrected: port 7777 → 7778, `--port` → `--api-port`
- `viewer/README.md`: replaced Vite scaffold boilerplate with real frontend dev instructions

---

## [1.0.1-alpha] — 2026-03-24

### Fixed

- Vertically centered Mass Casualty button on Intake tab (flex layout fix)

### Changed

- Updated MIT License year to 2026 and added contact email
- Version scheme now includes `-alpha` tag for active development builds

---

## [1.0.0] — 2026-03-23

### Added

- FastAPI backend with 13 API routes (patients, inference, TTS, STT, translation, inventory, distribution, mesh, roster, wards, tasks, health)
- Pre-built React frontend (viewer) served by the backend
- Electron desktop shell for Windows
- 4 bundled AI models:
  - MedGemma 1.5 4B — medical inference and triage assistance
  - Kokoro v1.0 — multilingual text-to-speech
  - Faster Whisper Base — speech-to-text
  - NLLB 200 600M — real-time translation (200 languages)
- Portable Python 3.13 runtime (no system install required)
- Medical triage data: protocols, conditions, pharmacology, procedures, assessments, special populations
- AES-256 encrypted patient data storage
- Platform installers: Windows, macOS, Raspberry Pi 5 kiosk, iOS companion
- Cloudflare R2 distribution pipeline (`dev/build_and_deploy.py`) with ZIP64 + multipart upload
- Dev asset pipeline (`dev/setup.py`) downloads models + runtime from R2 after clone
- Development launchers: `start_on_Windows.bat`, `start_on_Mac.sh`
- Open-source release under MIT License
