"""
Triage — Standalone AI runtime for field deployment.

Separate from the main HALT API — this is the lighter-weight triage-only
backend that ships with the standalone Triage Assistant app. Includes AI
inference (MedGemma), TTS (Kokoro), STT (Whisper), and image analysis,
but not the full patient management or mesh networking stack.

Pre-warms Kokoro TTS in a background thread at startup to eliminate
first-generation latency.
"""
import os
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse

from routes import health, inference, tts, stt

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("triage")

# TRIAGE_ROOT is set by start triage.bat to the folder containing backend/ frontend/ models/
# Falls back to parent of this file's directory if not set.
_root = Path(os.environ.get("TRIAGE_ROOT", Path(__file__).resolve().parent.parent))
_frontend = _root / "frontend"

app = FastAPI(title="Triage", description="Offline AI Field Assistant", version="1.0.1-alpha")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
app.include_router(inference.router)
app.include_router(tts.router, prefix="/tts")
app.include_router(stt.router, prefix="/stt")


if _frontend.is_dir():
    app.mount("/frontend", StaticFiles(directory=str(_frontend), html=True), name="frontend")
    logger.info(f"Frontend: {_frontend}")
else:
    logger.error(f"Frontend dir NOT FOUND: {_frontend}")


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/frontend")


@app.on_event("startup")
async def startup():
    logger.info(f"Triage root : {_root}")
    logger.info(f"Frontend   : {_frontend}")
    logger.info(f"Models     : {_root / 'models'}")

    import threading

    # Pre-warm Kokoro (TTS) in a parallel background thread
    from routes.tts import _get_kokoro

    threading.Thread(target=_get_kokoro, daemon=True, name="warmup-tts").start()
    logger.info("Warmup thread started (TTS).")
