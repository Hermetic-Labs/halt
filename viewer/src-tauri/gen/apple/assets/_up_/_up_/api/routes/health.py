"""Health check — GET /health. Reports model readiness (GGUF, ONNX, Whisper) for the frontend setup wizard."""
from fastapi import APIRouter

from config import MODELS_DIR

router = APIRouter(tags=["health"])

# Module-level readiness flag — set by warmup routines
_models_ready = False


def set_models_ready():
    """Called by the TTS warmup thread when models are loaded into memory."""
    global _models_ready  # noqa: PLW0603
    _models_ready = True


@router.get("/health")
async def health():
    gguf = list(MODELS_DIR.glob("*.gguf"))
    onnx = list(MODELS_DIR.glob("*.onnx"))
    whisper = (MODELS_DIR / "faster-whisper-base").exists()
    payload = {
        "status": "ok" if _models_ready else "warming",
        "models_ready": _models_ready,
        "models_dir": str(MODELS_DIR),
        "gguf": [f.name for f in gguf],
        "onnx": [f.name for f in onnx],
        "whisper": whisper,
    }
    # Always 200 — both Electron and React read models_ready from the body.
    # A 503 here caused both consumers to treat it as "server down" and
    # block the user on loading screens instead of showing the app.
    return payload
