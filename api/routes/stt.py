"""
STT — POST /stt/listen
Faster-Whisper speech-to-text. Accepts audio file upload, returns transcript.
"""
import logging
import tempfile
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File
from config import MODELS_DIR

logger = logging.getLogger("triage.stt")
router = APIRouter(tags=["stt"])

WHISPER_DIR = MODELS_DIR / "faster-whisper-base"

_whisper = None


def _get_whisper():
    global _whisper
    if _whisper:
        return _whisper
    try:
        from faster_whisper import WhisperModel

        model_id = str(WHISPER_DIR) if WHISPER_DIR.exists() else "base"
        logger.info(f"Loading Whisper from {model_id} …")
        _whisper = WhisperModel(model_id, device="cpu", compute_type="float32")
        logger.info("Whisper loaded")
        return _whisper
    except Exception as e:
        logger.exception("Whisper load error")
        return None


@router.get("/health")
def stt_health():
    w = _get_whisper()
    return {"loaded": w is not None, "model_dir": str(WHISPER_DIR), "local": WHISPER_DIR.exists()}


@router.post("/listen")
async def listen(audio: UploadFile = File(...), language: Optional[str] = None):
    import asyncio

    w = await asyncio.to_thread(_get_whisper)
    if not w:
        raise HTTPException(503, "STT not available — check model files")

    content = await audio.read()
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        segments, info = w.transcribe(tmp_path, language=language, beam_size=5, vad_filter=True, word_timestamps=False)
        text = " ".join(seg.text.strip() for seg in segments)
        return {"text": text, "language": info.language, "language_probability": round(info.language_probability, 3)}
    except Exception as e:
        logger.exception("Transcription error")
        raise HTTPException(500, f"Transcription failed: {e}") from e
    finally:
        Path(tmp_path).unlink(missing_ok=True)
