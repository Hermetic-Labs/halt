<p align="center">
  <img src="assets/logo.png" alt="HALT" width="200" />
</p>

<h1 align="center">HALT — Hermetic Anonymous Local Triage</h1>

<p align="center">
  <strong>Offline-first AI medical triage for environments without internet, power, or connectivity.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.1--alpha-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/python-3.13-yellow?style=flat-square" alt="Python" />
  <img src="https://img.shields.io/badge/AI-100%25_Local-red?style=flat-square" alt="AI Local" />
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status" />
</p>

<p align="center">
  <a href="LICENSE">MIT License</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="SECURITY.md">Security</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

> *These places will be out of internet, out of power, and out of range, and still in pain. That's what we're solving.*

HALT is an air-gapped medical triage system that runs entirely on-device. It bundles AI models for inference, text-to-speech, speech-to-text, and real-time translation across 200+ languages — no cloud connection required. Built for medics in conflict zones, disaster areas, and resource-limited settings where every second matters.

---

## 🚀 Quick Start

<details>
<summary><strong>End Users</strong> — Download and run</summary>

<br/>

Download the latest release from [Cloudflare R2](https://hermeticlabs.app), unzip, and run.
Everything is included — no internet needed after download.

</details>

<details open>
<summary><strong>Developers</strong> — Clone and build</summary>

<br/>

```bash
git clone https://github.com/Hermetic-Labs/halt.git
cd halt
pip install boto3
python dev/setup.py          # Downloads AI models + runtime from R2 (~4 GB)
start_on_Windows.bat         # Windows
./start_on_Mac.sh            # macOS
```

The backend starts on `http://localhost:7778`. Other devices on the same WiFi can connect via browser.

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
│  runtime/python/  ← Portable Python 3.13 (no install)  │
│  models/          ← All AI runs locally on-device      │
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

## 🛠️ Dev Tooling

```bash
# Golden path — edit code, then:
python dev/build_and_deploy.py --release              # build → zip → git tag+push → R2 upload

# Individual steps
python dev/setup.py                                    # Download models + runtime (~4 GB from R2)
python dev/build_and_deploy.py --zip-only --deploy     # Zip existing build + push to R2
python dev/build_and_deploy.py --upload-assets         # Push models/runtime to R2
python dev/build_and_deploy.py --bump minor            # Bump version + build
```

---

## 📄 License

[MIT](LICENSE) — © 2026 Hermetic Labs · FrontDesk@7Hermeticlabs.com

---

<p align="center">
  <em>Built for the people who run toward the worst moments in the world so the rest of us don't have to.</em>
</p>
