<p align="center">
  <img src="assets/logo.png" alt="HALT" width="200" />
</p>

<h1 align="center">HALT — Hermetic Anonymous Local Triage</h1>

<p align="center">
  <strong>Offline-first AI medical triage for environments without internet, power, or connectivity.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.3-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/python-3.13-yellow?style=flat-square" alt="Python" />
  <img src="https://img.shields.io/badge/AI-100%25_Local-red?style=flat-square" alt="AI Local" />
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status" />
</p>

<p align="center">
  <a href="FEATURES.md">📋 Features</a> · <a href="LICENSE">MIT License</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="SECURITY.md">Security</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

> *These places will be out of internet, out of power, and out of range, and still in pain. That's what we're solving.*

HALT is an air-gapped medical triage system that runs entirely on-device. It bundles AI models for inference, text-to-speech, speech-to-text, and real-time translation across 200+ languages — no cloud connection required. Built for medics in conflict zones, disaster areas, and resource-limited settings where every second matters.

---

## 🚀 Quick Start

<details>
<summary><strong>End Users</strong> — Download and run</summary>

<br/>

Download the latest release from [Cloudflare R2](https://7hermeticlabs.health), unzip, and run.
Everything is included — no internet needed after download.

</details>

<details open>
<summary><strong>Developers</strong> — Clone and build</summary>

<br/>

```bash
git clone https://github.com/Hermetic-Labs/halt.git
cd halt
pip install -r requirements.txt
python start.py              # Auto-downloads AI models on first run (~4 GB)
```

> The backend starts on `http://localhost:7778`. AI models download automatically the first time you run.
> Other devices on the same WiFi can connect via browser.

</details>

---

## ✅ What It Does

<details>
<summary><strong>20 features — click to expand</strong></summary>

<br/>

| # | Feature | Summary |
|---|---------|---------|
| 1 | **Patient Intake** | Demographics, triage priority, ward/bed assignment, mass casualty mode |
| 2 | **Patient Records** | Full detail panel — MARCH plan, meds, vitals history, attachments, notes |
| 3 | **Patient Monitoring** | Vitals and medication event log with auto-scheduled follow-up tasks |
| 4 | **Volunteer Task Board** | Claimable tasks with countdown timers and ownership tracking |
| 5 | **Public Lookup QR** | Family members scan a QR code to locate patients by name — no staff needed |
| 6 | **Inventory System** | Any location becomes a supply bin — thresholds, usage logs, alternatives |
| 7 | **Predictive Alerts** | Auto-broadcasts supply warnings and emergencies when stock hits zero |
| 8 | **Medical Protocols** | MARCH, GCS, hemorrhage classification, triage scoring (T1–T4) |
| 9 | **Translation Bridge** | Real-time two-way speech translation across 42 languages — no internet |
| 10 | **Voice Interface** | Whisper speech-to-text intake + Kokoro TTS output in patient's language |
| 11 | **Mesh Network** | Local WiFi mesh — broadcast chat, DMs, reactions, 500-message history |
| 12 | **Leadership Failover** | Role hierarchy with one-tap leadership takeover and full state snapshot |
| 13 | **Shift Reports** | Cross-ward patient rollup, sorted by triage priority, multilingual export |
| 14 | **Patient Export** | PDF and print-ready HTML medevac cards with full clinical detail |
| 15 | **Emergency Alerts** | Category-targeted broadcasts (All Hands, Doctors, Inventory, etc.) |
| 16 | **AI Medical Layer** | MedGemma 4B for differential diagnosis and drug interactions — fully local |
| 17 | **Auto-Download** | 4 model packs download on first launch; resumable with SHA-256 verification |
| 18 | **Portable Runtime** | Bundled Python, no system install — `python start.py` and go |
| 19 | **Staff Roster** | Personnel tracking with real-time connection status via WebSocket |
| 20 | **Ward Management** | Visual ward map, room/bed layout, drag-to-assign patients |

> Full reference with API paths: [`FEATURES.md`](FEATURES.md)

</details>

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  HALT Server (laptop / Pi / Mac)                        │
│                                                         │
│  FastAPI (:7778) ─── serves ──→ React PWA (viewer/)     │
│      │                                                  │
│      ├── /patients    Patient intake + records (JSON)   │
│      ├── /inference   MedGemma 4B medical AI            │
│      ├── /tts         Kokoro multilingual speech        │
│      ├── /stt         Whisper transcription             │
│      ├── /translate   NLLB 200-language translation     │
│      ├── /mesh        QR-based device mesh networking   │
│      ├── /wards       Ward map + patient placement      │
│      └── /inventory   Supply tracking                   │
│                                                         │
│  runtime/python/  ← Portable Python 3.13 (no install)   │
│  models/          ← All AI runs locally on-device       │
└───────────────┬─────────────────────────────────────────┘
                │ local WiFi
     ┌──────────┼──────────┐
     │          │          │
   Phone     Tablet     Phone
  (browser)  (browser)  (browser)
```

---

## 📂 What's Inside

| Directory | Contents |
|:----------|:---------|
| `api/` | FastAPI backend — 13 API routes, CORS open for mesh clients |
| `viewer/` | Pre-built React PWA (served by the backend on `:7778`) |
| `electron/` | Electron shell for desktop packaging |
| `triage/` | Medical protocols, conditions, pharmacology, procedures (JSON) |
| `models/` | AI models — downloaded via `dev/setup.py` |
| `runtime/` | Portable Python 3.13 — downloaded via `dev/setup.py` |
| `dev/` | Build scripts, installers, and deployment tooling |
| `assets/` | Logo and branding |

---

## 🔨 Build & Deploy

The build pipeline lives in [`dev/`](dev/) — see its [README](dev/README.md) for full docs.

```bash
# ── Quick Reference (run from repo root) ──────────────────────

# Dev iteration (fast portable build, no installer)
python dev/build_and_deploy.py --platform win --dev --no-bump

# Production (full NSIS installer + ZIP)
python dev/build_and_deploy.py --platform win

# Ship it (build → git tag → R2 upload → GitHub release)
python dev/build_and_deploy.py --platform win --release
```

### Output

| Artifact | Path |
|:---------|:-----|
| Portable app | `dev/electron-launcher/dist/win-unpacked/HALT - Medical Triage.exe` |
| NSIS installer | `dev/electron-launcher/dist/HALT-Setup-X.X.X.exe` |
| Distribution ZIP | `builds/HALT-vX.X.X-Windows.zip` |

---

## 🧠 AI Models

| Model | Purpose | Size |
|:------|:--------|-----:|
| MedGemma 4B | Medical inference & triage assistance | 2.5 GB |
| Kokoro v1.0 | Text-to-speech (multilingual phoneme synthesis) | 325 MB |
| Faster Whisper Base | Speech-to-text transcription | ~150 MB |
| NLLB 200 600M | Real-time translation (200 languages) | ~1.2 GB |

> 🔒 All models run locally. **No data ever leaves the device.**

---

## 💻 Platforms

| Platform | Role | Status |
|:---------|:-----|:------:|
| **Windows** | Full server + Electron shell | ✅ Working |
| **macOS** | Full server + Electron shell | 🟡 Needs portable Python |
| **Raspberry Pi 5** | Kiosk server for field stations | ✅ Working |
| **iOS** | Client (Capacitor companion + HealthKit) | ✅ Companion app |
| **Android / any device** | Client (open browser to server IP) | ✅ Browser PWA |

---

## 🛠️ Prerequisites

| Requirement | Version | Why |
|:------------|:--------|:----|
| **Python** | 3.10+ | Backend, AI inference, launcher |
| **Git** | Any | Clone the repo |
| **pip** | Any | `pip install boto3` for setup script |
| **Node.js** | 18+ | Only needed if modifying the viewer frontend |
| **~10 GB disk** | — | Models (~4 GB) + runtime + source |

## 🩺 Troubleshooting

| Symptom | Fix |
|:--------|:----|
| `python start.py` → "module not found" | Run `python dev/setup.py` first to download models + runtime |
| Port 7778 already in use | `python start.py --api-port 8000` |
| Models downloading slowly | They're ~4 GB from Cloudflare R2 — grab a coffee ☕ |
| Want to modify the frontend? | You'll need Node.js: `cd viewer && npm install && npm run dev` |

---

## 📄 License

[MIT](LICENSE) — © 2026 Hermetic Labs · <FrontDesk@7Hermeticlabs.com>

---

<p align="center">
  <em>Built for the people who run toward the worst moments in the world so the rest of us don't have to.</em>
</p>
