<p align="center">
  <img src="assets/logo.png" alt="HALT" width="200" />
</p>

<h1 align="center">HALT — Hermetic Anonymous Local Triage</h1>

<p align="center">
  <strong>Offline-first AI medical triage for environments without internet, power, or connectivity.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.5-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/python-3.13-yellow?style=flat-square" alt="Python" />
  <img src="https://img.shields.io/badge/AI-100%25_Local-red?style=flat-square" alt="AI Local" />
  <img src="https://img.shields.io/badge/status-beta-brightgreen?style=flat-square" alt="Status" />
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
<summary><strong>24 features — click to expand</strong></summary>

<br/>

| # | Feature | Summary |
|---|---------|---------|
| 1 | **Patient Intake** | 6-step intake: demographics, triage priority (T1–T4), MARCH assessment, ward/bed assignment |
| 2 | **Mass Casualty Mode** | 3-tap rapid intake — name, priority, save. Details later when things calm down |
| 3 | **Patient Records** | Full detail panel — vitals history, meds, MARCH plan, attachments, notes, tourniquet timers |
| 4 | **Patient Monitoring** | Vitals and medication event log with auto-scheduled follow-up tasks |
| 5 | **Family Patient Lookup** | Families search by name on any phone — shows ward and bed only, no clinical data exposed |
| 6 | **Public Lookup QR** | Print a QR code, tape it to the front desk — families scan and search without staff help |
| 7 | **Volunteer Task Board** | Claimable tasks with countdown timers, ownership tracking, and overdue alerts |
| 8 | **Inventory System** | Multi-location supply tracking — thresholds, usage logs, suggested alternatives |
| 9 | **Predictive Alerts** | Auto-broadcasts warnings when stock hits critical or zero — targeted by category |
| 10 | **Ward Management** | Visual ward map with room/bed layout, drag-to-assign patients, per-room occupancy |
| 11 | **Ward Printing** | Print ward signs and room labels — set up any building as a triage station in minutes |
| 12 | **Shift Reports** | Cross-ward patient rollup sorted by priority, multilingual, print-ready |
| 13 | **Discharge QR Cards** | Generate a translated QR card for discharged patients with follow-up instructions |
| 14 | **Patient Export** | Print-ready HTML medevac cards with full clinical detail for transport handoff |
| 15 | **Translation Bridge** | Real-time two-way speech translation across 42 languages — fully offline |
| 16 | **Voice Interface** | Whisper speech-to-text + Kokoro TTS in the patient's language — speak and listen |
| 17 | **42-Language UI** | Every label, button, and status in the interface translates to the selected language |
| 18 | **AI Triage Assistant** | MedGemma 1.5 4B for differential diagnosis, drug interactions, wound image analysis, and clinical Q&A — fully local |
| 19 | **Mesh Network** | Local WiFi mesh — broadcast chat, DMs, reactions, multilingual fan-out, 500-message history |
| 20 | **Emergency Broadcasts** | Category-targeted alerts (All Hands, Doctors, Inventory) with TTS announcement |
| 21 | **Leadership Failover** | Role hierarchy with one-tap leadership takeover and full state snapshot |
| 22 | **Staff Roster** | Real-time personnel tracking with WebSocket connection status |
| 23 | **Low Power Mode** | Auto-engages below 20% battery — kills animations, reduces polling, extends runtime |
| 24 | **Encryption at Rest** | AES-256 patient data encryption — records are unreadable if the device is captured |

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
│      ├── /inference   MedGemma 1.5 4B medical AI          │
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

The entire software release pipeline has been modernized to a **Native Cloud CI/CD** stack to completely circumvent local Windows Defender (WDAC) blocks and safely publish natively to the Microsoft Store and Apple TestFlight.

```bash
# ── Cloud CI/CD Automated Build (GitHub Actions) ────────────────────

# 1. To officially release a new version 
git tag v1.0.8
git push origin v1.0.8

# 2. To manually trigger a Store Pipeline push
# Open GitHub -> 'Actions' tab -> Click 'Release' -> 'Run workflow'
```

> **Note:** The `windows-latest` cloud builders completely bypass local `os error 4551` constraints when packaging the `.msix` Windows App containers, compiling natively securely across MS + Mac architecture without relying on local machine dependencies.

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
| MedGemma 1.5 4B | Medical inference, triage assistance & wound image analysis | 2.5 GB |
| MedGemma 1.5 mmproj | Vision projector for multimodal image input (SigLIP) | 851 MB |
| Kokoro v1.0 | Text-to-speech (multilingual phoneme synthesis) | 325 MB |
| Faster Whisper Base | Speech-to-text transcription | ~150 MB |
| NLLB 200 600M | Real-time translation (200 languages) | ~1.2 GB |

> 🔒 All models run locally. **No data ever leaves the device.**

### Translation Bridge — Known Limitations

**Unsupported STT languages:** The translator UI exposes 3 languages that fall outside Faster Whisper's supported language set. STT for these languages will fall back to Whisper's auto-detection, which may produce degraded or incorrect transcriptions:

| Code | Language | Whisper Support | Workaround |
|:-----|:---------|:----------------|:-----------|
| `am` | Amharic (አማርኛ) | ❌ Not supported | Auto-detect fallback — may misidentify as a related language |
| `ha` | Hausa | ❌ Not supported | Auto-detect fallback |
| `ku` | Kurdish (Kurdî) | ❌ Not supported | Auto-detect fallback |

NLLB translation and Kokoro TTS still function for these languages — only the speech-to-text input is affected.

**VAD (Voice Activity Detection):** Whisper's Silero VAD filter is enabled (`vad_filter=True`) for silence removal during transcription, but it operates **post-hoc** — the full audio recording is collected first, then processed as a batch. Real-time VAD-based chunking (streaming partial transcriptions while the user speaks) is not currently implemented. The user signals speech completion by tapping the mic button.

---

## 💻 Platforms

| Platform | Role | Status |
|:---------|:-----|:------:|
| **Windows** | Full server + Electron shell | ✅ Working |
| **macOS** | Full server + native build | ✅ Planned |
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
