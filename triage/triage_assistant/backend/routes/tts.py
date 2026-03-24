"""
TTS — POST /tts/synthesize  |  WS /tts/ws
Kokoro ONNX text-to-speech.
WebSocket streams sentence-by-sentence WAV chunks for low-latency playback.
"""
import os
import io
import re
import struct
import asyncio
import logging
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

logger = logging.getLogger("triage.tts")
router = APIRouter(tags=["tts"])

MODELS_DIR  = Path(os.environ.get("EVE_MODELS_DIR",
                   Path(__file__).resolve().parent.parent.parent / "models"))
MODEL_PATH  = MODELS_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = MODELS_DIR / "voices-v1.0.bin"

_kokoro = None
_voices: list = []

def _get_kokoro():
    global _kokoro, _voices
    if _kokoro:
        return _kokoro
    if not MODEL_PATH.exists() or not VOICES_PATH.exists():
        logger.error(f"Kokoro files missing in {MODELS_DIR}")
        return None
    try:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
        _voices = _kokoro.get_voices()
        v_def = _voices[0] if _voices else "af_heart"
        logger.info(f"Kokoro loaded — {len(_voices)} voices. Warming up ONNX graph...")
        # Warmup sequence: bypasses first-generation ONNX lag
        try:
            _kokoro.create(" ", voice=v_def)
            logger.info("Kokoro warmup complete.")
        except Exception:
            pass
        return _kokoro
    except Exception as e:
        logger.error(f"Kokoro load error: {e}")
        return None

# Load at import time — runs before uvicorn accepts connections
import threading
threading.Thread(target=_get_kokoro, daemon=True).start()

async def _wait_kokoro(timeout: float = 60.0):
    """Poll until background Kokoro load finishes."""
    import asyncio, time
    t0 = time.monotonic()
    while _kokoro is None:
        if time.monotonic() - t0 > timeout:
            return None
        await asyncio.sleep(0.25)
    return _kokoro


def _to_wav(samples, sample_rate: int = 24000) -> bytes:
    import numpy as np
    audio = (samples * 32767).astype(np.int16)
    buf = io.BytesIO()
    buf.write(b'RIFF'); buf.write(struct.pack('<I', 36 + len(audio) * 2))
    buf.write(b'WAVE'); buf.write(b'fmt ')
    buf.write(struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b'data'); buf.write(struct.pack('<I', len(audio) * 2))
    buf.write(audio.tobytes())
    return buf.getvalue()

def _split_sentences(text: str) -> list[str]:
    parts = re.split(r'(?<=[.!?;:])\s+', text.strip())
    return [p.strip() for p in parts if p.strip()]

def _synth(text: str, voice: str, speed: float):
    k = _get_kokoro()
    if not k:
        raise RuntimeError("Kokoro not loaded")
    v = voice if voice in _voices else (_voices[0] if _voices else "af_heart")
    samples, sr = k.create(text=text, voice=v, speed=speed)
    return _to_wav(samples, sr)


# ── REST fallback ──────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str = Field(default="af_heart")
    rate: float = Field(default=1.0, ge=0.5, le=2.0)

@router.get("/health")
async def tts_health():
    return {"loaded": _kokoro is not None, "voices": len(_voices)}

@router.get("/voices")
async def tts_voices():
    _get_kokoro()
    return {"voices": [{"id": v,
                         "name": v.split("_")[1].title() if "_" in v else v,
                         "language": "American" if v.startswith("a") else "British",
                         "gender": "Female" if len(v) > 1 and v[1] == "f" else "Male"}
                        for v in _voices], "default": "af_heart"}

@router.post("/synthesize")
async def synthesize(req: TTSRequest):
    k = await _wait_kokoro(30)
    if not k:
        raise HTTPException(503, "TTS not ready — Kokoro still loading")
    loop = asyncio.get_event_loop()
    try:
        wav = await loop.run_in_executor(None, _synth, req.text, req.voice, req.rate)
        return Response(content=wav, media_type="audio/wav",
                        headers={"Content-Disposition": "inline; filename=speech.wav"})
    except Exception as e:
        raise HTTPException(503, str(e))


# ── WebSocket streaming TTS ────────────────────────────────────────────────────
@router.websocket("/ws")
async def tts_ws(websocket: WebSocket):
    """
    Send JSON: {"text": "...", "voice": "af_heart", "speed": 1.0}
    Receive:   binary WAV chunks (one per sentence) then {"type": "done"}
    """
    await websocket.accept()
    k = await _wait_kokoro(60)
    if not k:
        await websocket.send_json({"type": "error", "error": "TTS not ready"})
        await websocket.close()
        return
    try:
        while True:
            msg = await websocket.receive_json()
            text  = msg.get("text", "").strip()
            voice = msg.get("voice", "af_heart")
            speed = float(msg.get("speed", 1.0))

            if not text:
                continue

            try:
                # Kokoro handles chunking (sentence splitting) internally via streaming pipeline
                async for samples, phonemes in k.create_stream(text, voice=voice, speed=speed):
                    wav = _to_wav(samples)
                    await websocket.send_bytes(wav)
            except Exception as e:
                logger.error(f"WS TTS stream error: {e}")

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS TTS error: {e}")
