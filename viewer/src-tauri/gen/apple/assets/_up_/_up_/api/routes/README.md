# api/routes/

> 12 route modules covering the full HALT API surface — patient management, AI inference, mesh networking, and supply tracking.

## Context

Every file here is a FastAPI `APIRouter` imported by `api/main.py`. All data persistence goes through `api/storage.py`. Route modules are independent — they don't import each other except for specific cross-cutting concerns (e.g. `inventory.py` imports `mesh.broadcast_mesh` for stock alerts).

## Files

| File | Domain | Endpoints | Lines | Key Patterns |
|---|---|---|---|---|
| `health.py` | System | `GET /health` | ~21 | Model readiness probe for setup wizard |
| `inference.py` | AI | `POST /inference/stream`, `GET /models`, `GET /inference/queue` | ~211 | SSE streaming, asyncio lock queue with position feedback |
| `tts.py` | AI | `POST /tts/synthesize`, `WS /tts/ws`, `GET /tts/voices` | ~440 | Kokoro ONNX, Japanese romaji via fugashi, WebSocket binary WAV streaming |
| `stt.py` | AI | `POST /stt/listen`, `GET /stt/health` | ~68 | Faster-Whisper, temp file + cleanup pattern |
| `translate.py` | AI | `POST /api/translate`, `POST /api/translate/batch`, `GET /api/translate/status` | ~196 | CTranslate2 NLLB, SentencePiece tokenization |
| `patients.py` | Domain | Full CRUD, events, attachments, PDF/HTML export, shift report, snapshot/restore | ~785 | Stdlib-only PDF, locale-aware HTML export, Fernet encryption |
| `mesh.py` | Domain | WebSocket hub, chat, alerts, emergency, QR onboarding | ~635 | Ephemeral in-memory state, leader failover, WebRTC signaling relay |
| `inventory.py` | Domain | CRUD, consume, restock, locations, activity log | ~380 | Auto-alert on critical stock via mesh broadcast, cascade on location delete |
| `wards.py` | Domain | CRUD for ward layouts | ~85 | Legacy single-ward → multi-ward migration |
| `roster.py` | Domain | Team CRUD, avatar upload | ~124 | WebP avatar storage, pending→connected lifecycle |
| `tasks.py` | Domain | Task board CRUD + self-claim | ~114 | Priority ordering, fire-and-forget activity log |
| `distribution.py` | System | Model pack download, verify, extract via SSE progress | ~325 | Resumable HTTP download, SHA-256 checksum verify, tar.gz extraction |

## Endpoint Index

For an LLM that needs to find "which file handles X":

| Pattern | File |
|---|---|
| `/health` | `health.py` |
| `/inference/*` | `inference.py` |
| `/tts/*` | `tts.py` |
| `/stt/*` | `stt.py` |
| `/api/translate*` | `translate.py` |
| `/api/patients*` | `patients.py` |
| `/api/public/patients` | `patients.py` |
| `/api/reports/shift` | `patients.py` |
| `/api/mesh/*`, `/ws/{client_id}` | `mesh.py` |
| `/api/inventory*` | `inventory.py` |
| `/api/wards`, `/api/ward/*` | `wards.py` |
| `/api/roster*` | `roster.py` |
| `/api/tasks*` | `tasks.py` |
| `/api/distribution/*` | `distribution.py` |
| `/models` | `inference.py` |

## Cross-Module Dependencies

```
inventory.py ──imports──→ mesh.broadcast_mesh()    (stock alerts)
patients.py  ──imports──→ translate._translate()    (export translation)
mesh.py      ──imports──→ storage.roster_path()     (online status sync)
mesh.py      ──imports──→ storage.chat_path()       (chat persistence)
```

All other modules are independent — they only import from `storage.py` and `config.py`.

## Common Patterns

1. **Lazy-load singleton** — `_get_llm()`, `_get_kokoro()`, `_get_whisper()`, `_load_nllb()` all follow the same pattern: check `global`, return early if loaded, else load and assign.
2. **Thread offload** — CPU-bound AI work runs via `asyncio.to_thread()` or `loop.run_in_executor()` to keep the event loop responsive.
3. **SSE streaming** — Inference and distribution use `StreamingResponse` with `text/event-stream` and JSON payloads.
4. **WebSocket binary** — TTS streams raw WAV bytes over WebSocket for zero-copy playback.
5. **Fire-and-forget logging** — `storage.log_activity()` for audit trail without blocking the response.
