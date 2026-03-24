"""Health — GET /health"""
import os
from pathlib import Path
from fastapi import APIRouter

router = APIRouter(tags=["health"])

MODELS_DIR = Path(os.environ.get("EVE_MODELS_DIR", Path(__file__).resolve().parent.parent.parent / "models"))

@router.get("/health")
async def health():
    gguf  = list(MODELS_DIR.glob("*.gguf"))
    onnx  = list(MODELS_DIR.glob("*.onnx"))
    whisper = (MODELS_DIR / "faster-whisper-base").exists()
    return {
        "status": "ok",
        "models_dir": str(MODELS_DIR),
        "gguf": [f.name for f in gguf],
        "onnx": [f.name for f in onnx],
        "whisper": whisper,
    }
