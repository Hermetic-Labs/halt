# Changelog

All notable changes to HALT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
