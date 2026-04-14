"""
Translate Live — Real-time continuous speech-to-speech translation.

Dual-socket architecture:
  INPUT  WS  /translate-live/input   — Receives pre-segmented audio from client
  OUTPUT WS  /translate-live/output  — Sends transcripts, translations, TTS WAV

The client handles pause detection (silence threshold via AudioContext).
When the client detects a speech pause, it sends the accumulated audio segment.
The server simply processes each segment through the existing proven pipeline:
  WebM audio → Faster Whisper (with built-in VAD) → NLLB → Kokoro TTS stream.

No new dependencies. Zero bloat. Reuses every existing module.

Client protocol (input socket):
  1. JSON config: {session_id, target_lang, source_lang, speed?}
  2. Binary audio data (one complete WebM segment per speech pause)
  3. JSON {type: "segment"} marker after each segment's binary data
  4. JSON {type: "end"} to stop

Client protocol (output socket):
  1. JSON config: {session_id}
  2. Receives JSON: {type: "transcript", text, source_lang, segment_id}
  3. Receives JSON: {type: "translation", text, target_lang, segment_id}
  4. Receives binary WAV chunks (Kokoro TTS, play immediately)
  5. Receives JSON: {type: "segment_done", segment_id}
  6. Receives JSON: {type: "done"} when session ends
"""

import json
import asyncio
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import contextlib

logger = logging.getLogger("triage.translate_live")
router = APIRouter(tags=["translate-live"])

# ── Session registry ──────────────────────────────────────────────────────────
_sessions: dict[str, asyncio.Queue] = {}


def _get_session(session_id: str) -> asyncio.Queue:
    if session_id not in _sessions:
        _sessions[session_id] = asyncio.Queue()
    return _sessions[session_id]


def _cleanup_session(session_id: str):
    _sessions.pop(session_id, None)


# ── Pipeline helpers (reuse existing modules — zero new code) ────────────────

async def _whisper_transcribe(audio_data: bytes, source_lang: str) -> tuple[str, str]:
    """Run Faster Whisper on audio bytes. Returns (text, detected_language).
    Identical to translate_stream.py — same model, same params (beam=1 for speed)."""
    from routes.stt import _get_whisper

    whisper = await asyncio.to_thread(_get_whisper)
    if not whisper:
        raise RuntimeError("Whisper STT not available")

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_data)
        tmp_path = tmp.name

    try:
        lang_arg = None if source_lang == "auto" else source_lang
        segments, info = whisper.transcribe(
            tmp_path, language=lang_arg,
            beam_size=1,             # fast — latency over accuracy
            vad_filter=True,         # built-in Silero VAD handles silence
            word_timestamps=False,
        )
        text = " ".join(seg.text.strip() for seg in segments)
        return text, info.language
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _nllb_translate(text: str, source: str, target: str) -> str:
    """Translate via NLLB. Reuses the existing translate module singleton."""
    from routes.translate import _translate
    return _translate(text, source, target)


# ── Input WebSocket ──────────────────────────────────────────────────────────

@router.websocket("/input")
async def translate_live_input(websocket: WebSocket):
    """
    Receive pre-segmented audio from the client (client detects pauses),
    run Whisper + NLLB on each segment, push results to the session queue.
    """
    await websocket.accept()
    session_id = None
    segment_id = 0

    try:
        # 1. Config
        config = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        session_id = config.get("session_id", "")
        target_lang = config.get("target_lang", "en")
        source_lang = config.get("source_lang", "auto")
        speed = float(config.get("speed", 1.0))

        if not session_id:
            await websocket.send_json({"type": "error", "error": "session_id required"})
            await websocket.close()
            return

        queue = _get_session(session_id)
        await websocket.send_json({"type": "status", "status": "ready"})

        # 2. Receive segments
        audio_chunks: list[bytes] = []

        while True:
            msg = await websocket.receive()

            if "bytes" in msg and msg["bytes"]:
                # Accumulate audio data for the current segment
                audio_chunks.append(msg["bytes"])

            elif "text" in msg and msg["text"]:
                data = json.loads(msg["text"])

                if data.get("type") == "segment":
                    # Client detected a pause — process accumulated audio
                    if audio_chunks:
                        segment_id += 1
                        sid = segment_id
                        audio_data = b"".join(audio_chunks)
                        audio_chunks = []

                        # Process in background so we can keep receiving
                        asyncio.create_task(
                            _process_segment(
                                websocket, queue, audio_data,
                                source_lang, target_lang, speed, sid,
                            )
                        )

                elif data.get("type") == "end":
                    # Final flush — process any remaining audio
                    if audio_chunks:
                        segment_id += 1
                        sid = segment_id
                        audio_data = b"".join(audio_chunks)
                        audio_chunks = []

                        await _process_segment(
                            websocket, queue, audio_data,
                            source_lang, target_lang, speed, sid,
                        )
                    break

        # Signal end to output socket
        if session_id:
            await _get_session(session_id).put(None)

    except WebSocketDisconnect:
        logger.info(f"Live input disconnected (session={session_id})")
        if session_id:
            with contextlib.suppress(Exception):
                _get_session(session_id).put_nowait(None)
    except asyncio.TimeoutError:
        logger.warning("Live input: timeout waiting for config")
    except Exception as e:
        logger.exception(f"Live input error: {e}")
        if session_id:
            with contextlib.suppress(Exception):
                _get_session(session_id).put_nowait(None)


async def _process_segment(
    websocket: WebSocket,
    queue: asyncio.Queue,
    audio_data: bytes,
    source_lang: str,
    target_lang: str,
    speed: float,
    segment_id: int,
):
    """Process a single audio segment: Whisper → NLLB → push to output queue."""
    try:
        # STT
        await websocket.send_json({
            "type": "status", "status": "transcribing", "segment_id": segment_id,
        })
        transcript, detected_lang = await _whisper_transcribe(audio_data, source_lang)

        if not transcript.strip():
            return  # silence / noise — skip

        # Translate: source → English → target
        await websocket.send_json({
            "type": "status", "status": "translating", "segment_id": segment_id,
        })

        if detected_lang != "en":
            english = await asyncio.to_thread(
                _nllb_translate, transcript, detected_lang, "en"
            )
        else:
            english = transcript

        if target_lang != "en":
            translation = await asyncio.to_thread(
                _nllb_translate, english, "en", target_lang
            )
        else:
            translation = english

        # Push to output queue for TTS + delivery
        await queue.put({
            "segment_id": segment_id,
            "transcript": transcript,
            "source_lang": detected_lang,
            "translation": translation,
            "target_lang": target_lang,
            "english": english,
            "speed": speed,
        })

    except Exception as e:
        logger.exception(f"Segment {segment_id} processing error")


# ── Output WebSocket ─────────────────────────────────────────────────────────

@router.websocket("/output")
async def translate_live_output(websocket: WebSocket):
    """
    Consume segment results from the session queue, send transcript +
    translation JSON, then stream Kokoro TTS audio back.
    """
    await websocket.accept()
    session_id = None

    try:
        # 1. Config
        config = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        session_id = config.get("session_id", "")

        if not session_id:
            await websocket.send_json({"type": "error", "error": "session_id required"})
            await websocket.close()
            return

        queue = _get_session(session_id)
        await websocket.send_json({"type": "status", "status": "connected"})

        # 2. Process segments from queue
        while True:
            try:
                result = await asyncio.wait_for(queue.get(), timeout=120)
            except asyncio.TimeoutError:
                break  # no segments for 2 min — close

            if result is None:
                break  # end sentinel from input socket

            sid = result["segment_id"]

            # Send transcript
            await websocket.send_json({
                "type": "transcript",
                "text": result["transcript"],
                "source_lang": result["source_lang"],
                "segment_id": sid,
            })

            # Send translation
            await websocket.send_json({
                "type": "translation",
                "text": result["translation"],
                "target_lang": result["target_lang"],
                "english": result.get("english", ""),
                "segment_id": sid,
            })

            # Stream Kokoro TTS
            await websocket.send_json({
                "type": "status", "status": "synthesizing", "segment_id": sid,
            })

            try:
                await _kokoro_stream_segment(
                    websocket, result["translation"],
                    result["target_lang"], result.get("speed", 1.0), sid,
                )
            except Exception as e:
                logger.exception(f"TTS error for segment {sid}")

            await websocket.send_json({"type": "segment_done", "segment_id": sid})

        # Done
        await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.info(f"Live output disconnected (session={session_id})")
    except Exception as e:
        logger.exception(f"Live output error: {e}")
    finally:
        if session_id:
            _cleanup_session(session_id)


async def _kokoro_stream_segment(
    websocket: WebSocket, text: str, lang: str, speed: float, segment_id: int,
):
    """Stream Kokoro TTS for a single translated segment."""
    from routes.tts import (
        _get_kokoro, _pick_voice, _espeak_code, _preprocess_text,
        _to_wav, _tts_lock, DEFAULT_VOICE, _voices,
    )

    k = _get_kokoro()
    if not k:
        logger.warning("Kokoro not available — skipping TTS")
        return

    voice = _pick_voice(DEFAULT_VOICE, lang)
    voice = voice if voice in _voices else (_voices[0] if _voices else DEFAULT_VOICE)
    processed = _preprocess_text(text, lang)
    espeak = _espeak_code(lang)

    async with _tts_lock:
        try:
            async for samples, _ in k.create_stream(
                processed, voice=voice, speed=speed, lang=espeak
            ):
                wav = _to_wav(samples)
                await websocket.send_bytes(wav)
        except Exception as e:
            logger.exception(f"Kokoro stream error (segment {segment_id})")


# ── Health ───────────────────────────────────────────────────────────────────

@router.get("/health")
def translate_live_health():
    return {"active_sessions": len(_sessions)}
