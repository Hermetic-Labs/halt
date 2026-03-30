"""
TTS — Kokoro ONNX text-to-speech with WebSocket streaming.

Two interfaces:
  - POST /tts/synthesize  — One-shot WAV generation (for short phrases).
  - WS   /tts/ws          — Streaming: client sends JSON text, receives binary
                            WAV chunks sentence-by-sentence for low-latency
                            playback during long speech synthesis.

Voice selection is language-aware: if the user hasn't explicitly chosen a
voice, the system auto-swaps to a native Kokoro voice for the target language
(e.g. Spanish → ef_dora, French → ff_siwis). Japanese gets special handling:
text is morphologically analyzed via fugashi, converted from katakana to
romaji, then synthesized through the English voice pipeline.

The model lazy-loads on first request. An ONNX warmup call runs during
startup to avoid first-generation latency spikes.
"""
import io
import re
import struct
import asyncio
import logging
from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

logger = logging.getLogger("triage.tts")
router = APIRouter(tags=["tts"])

from config import MODELS_DIR

MODEL_PATH = MODELS_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = MODELS_DIR / "voices-v1.0.bin"

_kokoro = None
_voices: list = []

# Map UI lang codes → espeak-ng codes for Kokoro phonemization
# All codes verified against espeak-ng backend
ESPEAK_LANG_MAP = {
    "en": "en-us",
    "es": "es",
    "fr": "fr-fr",
    "ar": "ar",
    "bn": "bn",
    "de": "de",
    "hi": "hi",
    "id": "id",
    "it": "it",
    "ja": "en-us",
    "ko": "ko",
    "nl": "nl",
    "pl": "pl",
    "pt": "pt-br",
    "ru": "ru",
    "sw": "sw",
    "th": "th",
    "tr": "tr",
    "ur": "ur",
    "vi": "vi",
    "zh": "cmn",
    "am": "am",
    "ha": "en-us",
    "ku": "ku",
    "mr": "mr",
    "my": "my",
    "ta": "ta",
    "te": "te",
    "uk": "uk",
    "he": "he",
    "la": "la",
    "tl": "en-us",
    "ig": "en-us",
    "jw": "id",
    "mg": "fr-fr",
    "ps": "fa",
    "so": "sw",
    "yo": "en-us",
    "zu": "sw",
    "xh": "sw",
    "fa": "fa",
    "km": "vi",
}

# Best native Kokoro voice per language (first letter = lang, second = gender)
KOKORO_VOICE_MAP = {
    "en": "af_heart",  # American English
    "es": "ef_dora",  # Spanish
    "fr": "ff_siwis",  # French
    "hi": "hf_alpha",  # Hindi
    # Note: ja excluded — uses romaji + English voice instead
    "it": "if_sara",  # Italian
    "pt": "pf_dora",  # Portuguese
    "zh": "zf_xiaobei",  # Chinese
}
DEFAULT_VOICE = "af_heart"


def _pick_voice(voice: str, lang: str) -> str:
    """Auto-select voice: if user picked an English voice but lang isn't English, swap.

    Kokoro English voices start with 'a' (American) or 'b' (British).
    Both should trigger the language-aware swap.
    """
    is_english_voice = voice.startswith("a") or voice.startswith("b")
    if is_english_voice and lang != "en" and lang in KOKORO_VOICE_MAP:
        return KOKORO_VOICE_MAP[lang]
    return voice


def _espeak_code(lang: str) -> str:
    """Map UI lang code to espeak-ng code. Always goes through the map."""
    return ESPEAK_LANG_MAP.get(lang, "en-us")


# ── Japanese romaji preprocessor (fugashi + katakana→romaji) ────────────────
_KATA = {
    "ア": "a",
    "イ": "i",
    "ウ": "u",
    "エ": "e",
    "オ": "o",
    "カ": "ka",
    "キ": "ki",
    "ク": "ku",
    "ケ": "ke",
    "コ": "ko",
    "サ": "sa",
    "シ": "shi",
    "ス": "su",
    "セ": "se",
    "ソ": "so",
    "タ": "ta",
    "チ": "chi",
    "ツ": "tsu",
    "テ": "te",
    "ト": "to",
    "ナ": "na",
    "ニ": "ni",
    "ヌ": "nu",
    "ネ": "ne",
    "ノ": "no",
    "ハ": "ha",
    "ヒ": "hi",
    "フ": "fu",
    "ヘ": "he",
    "ホ": "ho",
    "マ": "ma",
    "ミ": "mi",
    "ム": "mu",
    "メ": "me",
    "モ": "mo",
    "ヤ": "ya",
    "ユ": "yu",
    "ヨ": "yo",
    "ラ": "ra",
    "リ": "ri",
    "ル": "ru",
    "レ": "re",
    "ロ": "ro",
    "ワ": "wa",
    "ヲ": "wo",
    "ン": "n",
    "ガ": "ga",
    "ギ": "gi",
    "グ": "gu",
    "ゲ": "ge",
    "ゴ": "go",
    "ザ": "za",
    "ジ": "ji",
    "ズ": "zu",
    "ゼ": "ze",
    "ゾ": "zo",
    "ダ": "da",
    "ヂ": "di",
    "ヅ": "du",
    "デ": "de",
    "ド": "do",
    "バ": "ba",
    "ビ": "bi",
    "ブ": "bu",
    "ベ": "be",
    "ボ": "bo",
    "パ": "pa",
    "ピ": "pi",
    "プ": "pu",
    "ペ": "pe",
    "ポ": "po",
    "キャ": "kya",
    "キュ": "kyu",
    "キョ": "kyo",
    "シャ": "sha",
    "シュ": "shu",
    "ショ": "sho",
    "チャ": "cha",
    "チュ": "chu",
    "チョ": "cho",
    "ニャ": "nya",
    "ニュ": "nyu",
    "ニョ": "nyo",
    "ヒャ": "hya",
    "ヒュ": "hyu",
    "ヒョ": "hyo",
    "ミャ": "mya",
    "ミュ": "myu",
    "ミョ": "myo",
    "リャ": "rya",
    "リュ": "ryu",
    "リョ": "ryo",
    "ギャ": "gya",
    "ギュ": "gyu",
    "ギョ": "gyo",
    "ジャ": "ja",
    "ジュ": "ju",
    "ジョ": "jo",
    "ビャ": "bya",
    "ビュ": "byu",
    "ビョ": "byo",
    "ピャ": "pya",
    "ピュ": "pyu",
    "ピョ": "pyo",
    "ッ": "",
    "ー": "",
}
_ja_tagger = None


def _kata_to_romaji(text: str) -> str:
    result, i = [], 0
    while i < len(text):
        if i + 1 < len(text) and text[i : i + 2] in _KATA:
            result.append(_KATA[text[i : i + 2]])
            i += 2
        elif text[i] in _KATA:
            if text[i] == "ッ" and i + 1 < len(text) and text[i + 1] in _KATA:
                nxt = _KATA.get(text[i + 1], "")
                if nxt:
                    result.append(nxt[0])
            else:
                result.append(_KATA[text[i]])
            i += 1
        else:
            result.append(text[i])
            i += 1
    return "".join(result)


def _ja_to_romaji(text: str) -> str:
    global _ja_tagger
    try:
        import fugashi

        if _ja_tagger is None:
            _ja_tagger = fugashi.Tagger()
        parts = []
        for w in _ja_tagger(text):
            if hasattr(w, "feature") and len(w.feature) > 6 and w.feature[6]:
                parts.append(_kata_to_romaji(w.feature[6]))
            else:
                parts.append(str(w))
        return " ".join(parts)
    except ImportError:
        return text  # fallback: pass through unchanged


def _preprocess_text(text: str, lang: str) -> str:
    """Pre-process text before phonemization. Japanese → romaji."""
    if lang == "ja":
        return _ja_to_romaji(text)
    return text


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
            _kokoro.create("Hello.", voice=v_def)
            logger.info("Kokoro warmup complete.")
        except Exception:
            pass
        return _kokoro
    except Exception as e:
        logger.error(f"Kokoro load error: {e}")
        return None


# Kokoro lazy-loads on first call; background warmup is triggered by main.py startup.


async def _wait_kokoro(timeout: float = 60.0):
    """Lazy-load Kokoro upon first actual invocation."""
    if _kokoro:
        return _kokoro
    try:
        import asyncio

        return await asyncio.to_thread(_get_kokoro)
    except Exception as e:
        logger.error(f"Wait kokoro err: {e}")
        return None


def _to_wav(samples, sample_rate: int = 24000) -> bytes:
    import numpy as np

    audio = (samples * 32767).astype(np.int16)
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + len(audio) * 2))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", len(audio) * 2))
    buf.write(audio.tobytes())
    return buf.getvalue()


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?;:])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _synth(text: str, voice: str, speed: float, lang: str = "en"):
    k = _get_kokoro()
    if not k:
        raise RuntimeError("Kokoro not loaded")
    v = _pick_voice(voice, lang)
    v = v if v in _voices else (_voices[0] if _voices else DEFAULT_VOICE)
    text = _preprocess_text(text, lang)
    samples, sr = k.create(text=text, voice=v, speed=speed, lang=_espeak_code(lang))
    return _to_wav(samples, sr)


# ── REST fallback ──────────────────────────────────────────────────────────────
class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str = Field(default="af_heart")
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    lang: str = Field(default="en")


@router.get("/health")
def tts_health():
    return {"loaded": _kokoro is not None, "voices": len(_voices)}


@router.get("/voices")
def tts_voices():
    _get_kokoro()
    return {
        "voices": [
            {
                "id": v,
                "name": v.split("_")[1].title() if "_" in v else v,
                "language": "American" if v.startswith("a") else "British",
                "gender": "Female" if len(v) > 1 and v[1] == "f" else "Male",
            }
            for v in _voices
        ],
        "default": "af_heart",
    }


@router.post("/synthesize")
async def synthesize(req: TTSRequest):
    k = await _wait_kokoro(30)
    if not k:
        raise HTTPException(503, "TTS not ready — Kokoro still loading")
    loop = asyncio.get_event_loop()
    try:
        wav = await loop.run_in_executor(None, _synth, req.text, req.voice, req.rate, req.lang)
        return Response(
            content=wav, media_type="audio/wav", headers={"Content-Disposition": "inline; filename=speech.wav"}
        )
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
    queue = asyncio.Queue()

    async def _generator():
        try:
            while True:
                req = await queue.get()
                if req is None:
                    break
                text, voice, speed, lang = req
                text = _preprocess_text(text, lang)
                try:
                    espeak = _espeak_code(lang)
                    async for samples, phonemes in k.create_stream(text, voice=voice, speed=speed, lang=espeak):
                        wav = _to_wav(samples)
                        await websocket.send_bytes(wav)
                except Exception as e:
                    logger.error(f"WS TTS stream error: {e}")

                await websocket.send_json({"type": "done"})
        except Exception as e:
            logger.error(f"Generator err: {e}")

    gen_task = asyncio.create_task(_generator())

    try:
        while True:
            msg = await websocket.receive_json()
            text = msg.get("text", "").strip()
            if not text or text.isspace():
                continue
            voice = msg.get("voice", "af_heart")
            speed = float(msg.get("speed", 1.0))
            lang = msg.get("lang", "en")
            voice = _pick_voice(voice, lang)
            await queue.put((text, voice, speed, lang))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS TTS error: {e}")
    finally:
        await queue.put(None)
        await gen_task
