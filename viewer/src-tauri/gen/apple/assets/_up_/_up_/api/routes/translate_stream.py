"""
Translate Stream — WS /translate-stream/ws
Full pipeline: Mic audio -> Faster Whisper STT -> NLLB translate -> Kokoro TTS.

Client sends:
  1. JSON config: {target_lang: "ar", source_lang: "auto", speed: 1.0}
  2. Binary audio chunks (mic WebM/PCM)
  3. JSON {type: "end"} when done speaking

Server sends:
  1. JSON {type: "transcript", text: "...", source_lang: "zh"}  (immediate)
  2. JSON {type: "translation", text: "...", target_lang: "ar"}  (immediate)
  3. Binary WAV chunks (Kokoro TTS, buffered by client)
  4. JSON {type: "done"}  (client plays all buffered audio)
"""
import json
import asyncio
import logging
import tempfile
from pathlib import Path
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import contextlib

logger = logging.getLogger("triage.translate_stream")
router = APIRouter(tags=["translate-stream"])


@router.websocket("/ws")
async def translate_stream_ws(websocket: WebSocket):
    """Full-duplex translation WebSocket: mic -> STT -> translate -> TTS."""
    await websocket.accept()

    try:
        # 1. Receive config
        config_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        target_lang = config_msg.get("target_lang", "en")
        source_lang = config_msg.get("source_lang", "auto")  # "auto" = let Whisper detect
        speed = float(config_msg.get("speed", 1.0))

        await websocket.send_json({"type": "status", "status": "listening"})

        # 2. Accumulate mic audio chunks until "end" signal
        audio_chunks = []
        while True:
            msg = await websocket.receive()
            if "bytes" in msg and msg["bytes"]:
                audio_chunks.append(msg["bytes"])
            elif "text" in msg and msg["text"]:
                data = json.loads(msg["text"])
                if data.get("type") == "end":
                    break

        if not audio_chunks:
            await websocket.send_json({"type": "error", "error": "No audio received"})
            await websocket.close()
            return

        # Combine audio chunks
        audio_data = b"".join(audio_chunks)
        await websocket.send_json({"type": "status", "status": "transcribing"})

        # 3. Faster Whisper STT
        transcript_text, detected_lang = await _whisper_transcribe(audio_data, source_lang)
        if not transcript_text.strip():
            await websocket.send_json({"type": "error", "error": "No speech detected"})
            await websocket.close()
            return

        # Send transcript immediately
        await websocket.send_json(
            {
                "type": "transcript",
                "text": transcript_text,
                "source_lang": detected_lang,
            }
        )

        # 4. NLLB Translation: source -> English -> target
        await websocket.send_json({"type": "status", "status": "translating"})

        # Normalize to English first (if not already English)
        if detected_lang != "en":
            english_text = await asyncio.to_thread(_nllb_translate, transcript_text, detected_lang, "en")
        else:
            english_text = transcript_text

        # Translate English -> target (if target isn't English)
        if target_lang != "en":
            target_text = await asyncio.to_thread(_nllb_translate, english_text, "en", target_lang)
        else:
            target_text = english_text

        # Send translation immediately
        await websocket.send_json(
            {
                "type": "translation",
                "text": target_text,
                "target_lang": target_lang,
                "english": english_text,
            }
        )

        # 5. Kokoro TTS: generate audio for translated text
        await websocket.send_json({"type": "status", "status": "synthesizing"})

        chunks_sent = await _kokoro_stream(websocket, target_text, target_lang, speed)

        # 6. Done — client plays buffered audio
        await websocket.send_json(
            {
                "type": "done",
                "chunks": chunks_sent,
            }
        )

    except WebSocketDisconnect:
        logger.info("Translate stream client disconnected")
    except asyncio.TimeoutError:
        logger.warning("Translate stream timeout waiting for config")
    except Exception as e:
        logger.exception("Translate stream error")
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "error": str(e)})


# ── Pipeline helpers ──────────────────────────────────────────────────────────


async def _whisper_transcribe(audio_data: bytes, source_lang: str) -> tuple[str, str]:
    """Run Faster Whisper on raw audio bytes. Returns (text, detected_language)."""
    from routes.stt import _get_whisper

    whisper = await asyncio.to_thread(_get_whisper)
    if not whisper:
        raise RuntimeError("Whisper STT not available")

    # Write to temp file (Whisper needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name

    try:
        lang_arg = None if source_lang == "auto" else source_lang
        segments, info = whisper.transcribe(
            tmp_path, language=lang_arg, beam_size=5, vad_filter=True, word_timestamps=False
        )
        text = " ".join(seg.text.strip() for seg in segments)
        return text, info.language
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _nllb_translate(text: str, source: str, target: str) -> str:
    """Translate using NLLB. Reuses the existing translate module singleton."""
    from routes.translate import _translate

    return _translate(text, source, target)


async def _kokoro_stream(websocket: WebSocket, text: str, lang: str, speed: float) -> int:
    """Stream Kokoro TTS chunks to WebSocket. Returns count of chunks sent."""
    from routes.tts import (
        _get_kokoro,
        _pick_voice,
        _espeak_code,
        _preprocess_text,
        _to_wav,
        _tts_lock,
        DEFAULT_VOICE,
        _voices,
    )

    k = _get_kokoro()
    if not k:
        raise RuntimeError("Kokoro TTS not available")

    voice = _pick_voice(DEFAULT_VOICE, lang)
    voice = voice if voice in _voices else (_voices[0] if _voices else DEFAULT_VOICE)
    processed_text = _preprocess_text(text, lang)
    espeak = _espeak_code(lang)

    chunks_sent = 0

    async with _tts_lock:
        try:
            async for samples, _phonemes in k.create_stream(processed_text, voice=voice, speed=speed, lang=espeak):
                wav = _to_wav(samples)
                await websocket.send_bytes(wav)
                chunks_sent += 1
        except Exception as e:
            logger.exception("Kokoro stream error")

    return chunks_sent
