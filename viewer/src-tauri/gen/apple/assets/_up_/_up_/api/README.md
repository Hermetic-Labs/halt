# api/

> FastAPI backend for HALT — offline medical triage with AI, mesh networking, and encrypted patient records.

## Context

This is the core backend. `main.py` is the entrypoint. It boots a FastAPI app on port 7777, wires up all routers from `routes/`, and optionally serves the pre-built React PWA from `../viewer/dist/`. The launcher `start.py` (one level up) starts this process.

## Files

| File | Purpose | Lines | Key Exports |
|---|---|---|---|
| `main.py` | FastAPI entrypoint — CORS, router wiring, lifespan hooks, SPA fallback | ~110 | `app` |
| `config.py` | Centralized env config — `MODELS_DIR`, `DATA_DIR` from env vars | ~15 | `MODELS_DIR`, `DATA_DIR` |
| `storage.py` | JSON persistence layer — read/write with optional AES-256 Fernet encryption | ~145 | `read_json()`, `write_json()`, `patient_path()`, `DATA_DIR` |
| `bridge.py` | Standalone NLLB translation + espeak-ng phonemizer (runs on port 7779) | ~240 | Separate FastAPI `app` — not imported by main |
| `requirements.txt` | Python dependencies for the API | ~15 | — |
| `routes/` | All API route modules — see `routes/README.md` | — | — |

## Architecture

```
main.py ──imports──→ routes/*.py ──imports──→ storage.py ──imports──→ config.py
                                                │
                                          DATA_DIR (disk)
                                          ├── PAT-*.json (encrypted)
                                          ├── _wards.json
                                          ├── _inventory.json
                                          ├── _roster.json
                                          ├── _tasks.json
                                          ├── _chat.json
                                          └── attachments/

bridge.py (SEPARATE PROCESS — port 7779)
  └── CTranslate2 NLLB + SentencePiece + espeak-ng
```

## Patterns

- **Lazy-load singletons** — All AI models (LLM, Kokoro, Whisper, NLLB) load on first request via `_get_*()` functions that guard with `global` + early-return. Thread-safe by design since Python's GIL protects the assignment.
- **No database** — All state is JSON files on disk via `storage.py`. Designed for air-gap environments where SQLite might not be available.
- **Encryption at rest** — Patient files (`PAT-*.json`) are AES-256 encrypted via Fernet if `cryptography` is installed. Other files stay plaintext for debugging.
- **SPA fallback** — `main.py` mounts `viewer/dist/` and returns `index.html` for any unmatched GET so client-side routing works.

## Dependencies

- **Python**: FastAPI, uvicorn, pydantic, cryptography (optional)
- **AI models**: llama-cpp-python, kokoro-onnx, faster-whisper, ctranslate2, sentencepiece
- **System**: espeak-ng (for TTS phonemization)

## Quality

- All files have module docstrings explaining purpose and architecture
- Formatted with `ruff format` (line length 120, Python 3.11 target)
- Linted with `ruff check` — remaining issues are intentional patterns (global singletons, complex WebSocket handlers)
