import json
from fastapi import FastAPI, WebSocket
import uvicorn
import ctranslate2
import sentencepiece as spm
from pathlib import Path
from phonemizer.backend import EspeakBackend

app = FastAPI()

# ── Model paths ────────────────────────────────────────────────────────────
_MODELS_DIR = Path(__file__).resolve().parent / "models" if not __import__("os").environ.get("EVE_MODELS_DIR") else Path(__import__("os").environ["EVE_MODELS_DIR"])
_CT2_DIR = _MODELS_DIR / "nllb-200-distilled-600M-ct2"

# Map UI Language Codes to NLLB codes
NLLB_LANG_MAP = {
    "en": "eng_Latn",
    "es": "spa_Latn",
    "fr": "fra_Latn",
    "ar": "arb_Arab",
    "bn": "ben_Beng",
    "de": "deu_Latn",
    "he": "heb_Hebr",
    "hi": "hin_Deva",
    "id": "ind_Latn",
    "it": "ita_Latn",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
    "la": "lat_Latn",
    "nl": "nld_Latn",
    "pl": "pol_Latn",
    "pt": "por_Latn",
    "ru": "rus_Cyrl",
    "sw": "swh_Latn",
    "th": "tha_Thai",
    "tl": "tgl_Latn",
    "tr": "tur_Latn",
    "ur": "urd_Arab",
    "vi": "vie_Latn",
    "zh": "zho_Hans",
    "am": "amh_Ethi",
    "ha": "hau_Latn",
    "ig": "ibo_Latn",
    "jw": "jav_Latn",
    "ku": "ckb_Arab", # Sorani Kurdish
    "mg": "plt_Latn", # Plateau Malagasy
    "mr": "mar_Deva",
    "my": "mya_Mymr",
    "ps": "pbt_Arab", # Southern Pashto
    "so": "som_Latn",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "uk": "ukr_Cyrl",
    "yo": "yor_Latn",
    "zu": "zul_Latn",
    "xh": "xho_Latn",
    "fa": "pes_Arab", # Iranian Persian
    "km": "khm_Khmr"
}

# Map UI Language Codes to Espeak-ng language codes
ESPEAK_LANG_MAP = {
    "en": "en-us", "es": "es", "fr": "fr", "ar": "ar", "bn": "bn", "de": "de", 
    "hi": "hi", "id": "id", "it": "it", "ja": "ja", "ko": "ko", "nl": "nl",
    "pl": "pl", "pt": "pt", "ru": "ru", "sw": "sw", "th": "th", "tr": "tr", 
    "ur": "ur", "vi": "vi", "zh": "zh", "am": "am", "ha": "ha", "ku": "ku",
    "mr": "mr", "my": "my", "ta": "ta", "te": "te", "uk": "uk",
    # Approximations/fallbacks for languages espeak doesn't natively support
    "he": "he", "la": "la", "tl": "tl", "ig": "en", "jw": "id", "mg": "fr",
    "ps": "fa", "so": "sw", "yo": "en", "zu": "sw", "xh": "sw", "fa": "fa", 
    "km": "vi"
}

print("==================================================")
print(" EVE-OS UNIVERSAL TRANSLATION BRIDGE INITIALIZING ")
print("==================================================")

# ── Lazy-loaded CT2 model ──────────────────────────────────────────────────
_translator = None
_sp = None

def _load_model():
    global _translator, _sp
    if _translator is not None:
        return True
    if not _CT2_DIR.exists():
        print(f"[BRIDGE] NLLB CT2 model not found at {_CT2_DIR}")
        return False
    try:
        print("[NLLB-CT2] Loading CTranslate2 NLLB model...")
        _translator = ctranslate2.Translator(str(_CT2_DIR), device="cpu", inter_threads=2)
        _sp = spm.SentencePieceProcessor(str(_CT2_DIR / "sentencepiece.bpe.model"))
        print("[NLLB-CT2] Translation ready (CTranslate2 pipeline).")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to load NLLB CT2 model: {e}")
        return False


def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    """Translates text using CTranslate2 NLLB pipeline."""
    if not _load_model() or not _translator or not _sp:
        return text

    nllb_source = NLLB_LANG_MAP.get(source_lang, "eng_Latn")
    nllb_target = NLLB_LANG_MAP.get(target_lang, "eng_Latn")

    if nllb_source == nllb_target:
        return text

    tokens = _sp.encode(text, out_type=str)
    results = _translator.translate_batch(
        [tokens],
        target_prefix=[[nllb_target]],
        beam_size=4,
        max_decoding_length=512,
    )
    output_tokens = results[0].hypotheses[0]
    # Strip the target language token prefix
    if output_tokens and output_tokens[0] == nllb_target:
        output_tokens = output_tokens[1:]
    result = _sp.decode(output_tokens)
    return result

def transliterate_phonetics(text: str, source_lang: str) -> str:
    """Uses espeak-ng to convert native text into raw IPA phonetics for Kokoro."""
    espeak_code = ESPEAK_LANG_MAP.get(source_lang, "en-us")
    try:
        backend = EspeakBackend(espeak_code, language_switch='remove-flags')
        phonetics = backend.phonemize([text], strip=True)[0]
        return phonetics
    except Exception as e:
        print(f"[BRIDGE] Phonemizer Error for {source_lang}: {e}")
        return text

@app.websocket("/api/bridge/translate")
async def websocket_translator(websocket: WebSocket):
    await websocket.accept()
    print("[BRIDGE] Native Language Client Connected.")
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            action = payload.get("action", "translate")
            text = payload.get("text", "")
            source = payload.get("source", "en")
            msg_id = payload.get("id", "0")
            
            if action == "phonemize":
                phonetics = transliterate_phonetics(text, source)
                await websocket.send_text(json.dumps({
                    "id": msg_id,
                    "action": action,
                    "text": phonetics,
                    "original": text,
                    "source": source
                }))
                continue
                
            # Semantic Translation Routing
            target = payload.get("target", "en")
            
            # Fast pass-through for English
            if source == "en" and target == "en":
                translated = text
            else:
                translated = translate_text(text, source, target)
                
            await websocket.send_text(json.dumps({
                "id": msg_id,
                "action": action,
                "text": translated,
                "original": text,
                "source": source,
                "target": target
            }))
            
    except Exception as e:
        print(f"[BRIDGE] Client Disconnected or Error: {e}")

if __name__ == "__main__":
    # Run the universal bridge
    uvicorn.run(app, host="0.0.0.0", port=7779)
