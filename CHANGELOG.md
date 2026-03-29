# Changelog

All notable changes to HALT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
  - MedGemma 4B — medical inference and triage assistance
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
