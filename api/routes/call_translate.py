"""
Call Translate — WS /call-translate/ws
Long-lived WebSocket for in-call rolling translation.

Client sends:
  1. JSON config: {target_lang, source_lang, mode: "subtitles" | "full"}
  2. Binary audio chunks (rolling 4s windows, continuously)
  3. JSON {type: "end_session"} when call ends

Server sends:
  1. JSON {type: "transcript", text, source_lang}   (each chunk)
  2. JSON {type: "translation", text, target_lang}   (if mode=full)
  3. Binary WAV chunks (Kokoro TTS, only if mode=full)
  4. JSON {type: "chunk_done"}                        (chunk boundary)
  5. JSON {type: "error", error}                      (non-fatal)
"""
import json
import asyncio
import logging
import contextlib
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("triage.call_translate")
router = APIRouter(tags=["call-translate"])


@router.websocket("/ws")
async def call_translate_ws(websocket: WebSocket):
    """Long-lived call translation WebSocket."""
    await websocket.accept()

    try:
        # 1. Receive config
        config_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        target_lang = config_msg.get("target_lang", "en")
        source_lang = config_msg.get("source_lang", "auto")
        mode = config_msg.get("mode", "subtitles")  # "subtitles" or "full"
        speed = float(config_msg.get("speed", 1.0))

        await websocket.send_json({"type": "status", "status": "ready", "mode": mode})
        logger.info(
            f"Call translate session started: {source_lang} → {target_lang}, mode={mode}"
        )

        # 2. Process rolling audio chunks until end_session
        while True:
            audio_chunks = []

            # Accumulate one chunk window (binary frames until next text message)
            while True:
                msg = await websocket.receive()
                if "bytes" in msg and msg["bytes"]:
                    audio_chunks.append(msg["bytes"])
                elif "text" in msg and msg["text"]:
                    data = json.loads(msg["text"])
                    if data.get("type") == "end_session":
                        logger.info("Call translate session ended by client")
                        await websocket.send_json({"type": "session_ended"})
                        await websocket.close()
                        return
                    elif data.get("type") == "end_chunk":
                        break  # Process this chunk
                    # Ignore unknown text messages

            if not audio_chunks:
                continue

            audio_data = b"".join(audio_chunks)
            if len(audio_data) < 500:
                continue  # Skip tiny fragments

            # 3. Transcribe with Whisper
            try:
                transcript_text, detected_lang = await _whisper_transcribe(
                    audio_data, source_lang
                )
                if not transcript_text.strip():
                    await websocket.send_json({"type": "chunk_done", "empty": True})
                    continue

                # Send transcript immediately
                await websocket.send_json(
                    {
                        "type": "transcript",
                        "text": transcript_text,
                        "source_lang": detected_lang,
                    }
                )

                # 4. Translate if mode=full and languages differ
                if mode == "full" and detected_lang != target_lang:
                    try:
                        translated = await asyncio.to_thread(
                            _nllb_translate, transcript_text, detected_lang, target_lang
                        )
                        await websocket.send_json(
                            {
                                "type": "translation",
                                "text": translated,
                                "target_lang": target_lang,
                            }
                        )

                        # 5. Kokoro TTS for the translation
                        try:
                            await _kokoro_stream(
                                websocket, translated, target_lang, speed
                            )
                        except Exception as tts_err:
                            logger.warning(f"Kokoro TTS error (non-fatal): {tts_err}")

                    except Exception as tr_err:
                        logger.warning(f"Translation error (non-fatal): {tr_err}")
                        await websocket.send_json(
                            {"type": "error", "error": f"Translation: {tr_err}"}
                        )

                await websocket.send_json({"type": "chunk_done"})

            except Exception as chunk_err:
                logger.warning(f"Chunk processing error (non-fatal): {chunk_err}")
                await websocket.send_json(
                    {"type": "error", "error": str(chunk_err)}
                )

    except WebSocketDisconnect:
        logger.info("Call translate client disconnected")
    except asyncio.TimeoutError:
        logger.warning("Call translate timeout waiting for config")
    except Exception as e:
        logger.exception("Call translate session error")
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "error": str(e)})


# ── Reuse pipeline helpers from translate_stream ─────────────────────────────


async def _whisper_transcribe(audio_data: bytes, source_lang: str) -> tuple[str, str]:
    """Run Faster Whisper on raw audio bytes. Returns (text, detected_language)."""
    from routes.translate_stream import _whisper_transcribe as _wt

    return await _wt(audio_data, source_lang)


def _nllb_translate(text: str, source: str, target: str) -> str:
    """Translate using NLLB."""
    from routes.translate_stream import _nllb_translate as _nt

    return _nt(text, source, target)


async def _kokoro_stream(websocket: WebSocket, text: str, lang: str, speed: float) -> int:
    """Stream Kokoro TTS chunks. Reuses the lock from tts.py."""
    from routes.translate_stream import _kokoro_stream as _ks

    return await _ks(websocket, text, lang, speed)
