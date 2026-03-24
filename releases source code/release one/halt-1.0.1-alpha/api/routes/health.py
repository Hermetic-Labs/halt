"""Health — GET /health"""
from fastapi import APIRouter

from config import MODELS_DIR

router = APIRouter(tags=["health"])

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
