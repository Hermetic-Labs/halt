"""
Translate — POST /api/translate
Offline neural translation via NLLB-200 using CTranslate2 (lean, no PyTorch).
Model loads lazily on first request from MODELS_DIR/nllb-200-distilled-600M-ct2/.
"""
import logging
import asyncio
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from config import MODELS_DIR

logger = logging.getLogger("triage.translate")
router = APIRouter(tags=["translate"])

# ── NLLB Singleton ─────────────────────────────────────────────────────────────

_translator = None
_sp = None  # SentencePiece processor

MODEL_DIR = MODELS_DIR / "nllb-200-distilled-600M-ct2"

# Map UI language codes → NLLB BCP-47 codes
NLLB_LANG_MAP = {
    "en": "eng_Latn", "es": "spa_Latn", "fr": "fra_Latn", "ar": "arb_Arab",
    "bn": "ben_Beng", "de": "deu_Latn", "he": "heb_Hebr", "hi": "hin_Deva",
    "id": "ind_Latn", "it": "ita_Latn", "ja": "jpn_Jpan", "ko": "kor_Hang",
    "la": "lat_Latn", "nl": "nld_Latn", "pl": "pol_Latn", "pt": "por_Latn",
    "ru": "rus_Cyrl", "sw": "swh_Latn", "th": "tha_Thai", "tl": "tgl_Latn",
    "tr": "tur_Latn", "ur": "urd_Arab", "vi": "vie_Latn", "zh": "zho_Hans",
    "am": "amh_Ethi", "ha": "hau_Latn", "ig": "ibo_Latn", "jw": "jav_Latn",
    "ku": "ckb_Arab", "mg": "plt_Latn", "mr": "mar_Deva", "my": "mya_Mymr",
    "ps": "pbt_Arab", "so": "som_Latn", "ta": "tam_Taml", "te": "tel_Telu",
    "uk": "ukr_Cyrl", "yo": "yor_Latn", "zu": "zul_Latn", "xh": "xho_Latn",
    "fa": "pes_Arab", "km": "khm_Khmr",
}


def _load_nllb():
    """Lazy-load CTranslate2 translator + SentencePiece tokenizer."""
    global _translator, _sp
    if _translator and _sp:
        return _translator, _sp

    if not MODEL_DIR.exists():
        logger.warning(f"NLLB model not found at {MODEL_DIR}. Run scripts/download_nllb.py first.")
        return None, None

    try:
        import ctranslate2
        import sentencepiece as spm

        logger.info(f"Loading NLLB-CT2 from {MODEL_DIR}...")
        _translator = ctranslate2.Translator(str(MODEL_DIR), device="cpu", compute_type="int8")

        # SentencePiece model lives alongside the CT2 model
        sp_path = MODEL_DIR / "sentencepiece.bpe.model"
        if not sp_path.exists():
            # Fallback: check for other common names
            for name in ["spm.model", "tokenizer.model"]:
                alt = MODEL_DIR / name
                if alt.exists():
                    sp_path = alt
                    break

        _sp = spm.SentencePieceProcessor()
        _sp.Load(str(sp_path))
        logger.info("NLLB translation model ready (CTranslate2 + SentencePiece).")
        return _translator, _sp
    except Exception as e:
        logger.error(f"Failed to load NLLB: {e}")
        return None, None


def _translate(text: str, source: str, target: str) -> str:
    """Translate text using CTranslate2 NLLB. Returns original on failure."""
    translator, sp = _load_nllb()
    if not translator or not sp:
        return text

    nllb_src = NLLB_LANG_MAP.get(source, "eng_Latn")
    nllb_tgt = NLLB_LANG_MAP.get(target, "eng_Latn")

    if nllb_src == nllb_tgt:
        return text

    try:
        # Tokenize with SentencePiece, wrap in NLLB format: [src_lang] + tokens + [</s>]
        tokens = sp.Encode(text, out_type=str)
        src_tokens = [nllb_src] + tokens + ["</s>"]

        # Translate
        results = translator.translate_batch(
            [src_tokens],
            target_prefix=[[nllb_tgt]],
            max_decoding_length=512,
            beam_size=4,
        )

        # Decode: strip language prefix and EOS tokens
        output_tokens = results[0].hypotheses[0]
        clean_tokens = [t for t in output_tokens if t not in (nllb_tgt, "</s>")]
        translated_text = sp.Decode(clean_tokens)
        return translated_text
    except Exception as e:
        logger.error(f"Translation failed: {e}")
        return text


# ── Schemas ────────────────────────────────────────────────────────────────────

class TranslateRequest(BaseModel):
    text: str
    source: str = "en"
    target: str = "en"


class TranslateBatchRequest(BaseModel):
    texts: list[str]
    source: str = "en"
    target: str = "en"


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/api/translate")
async def translate_text(req: TranslateRequest):
    """Translate a single text string."""
    if req.source == req.target or not req.text.strip():
        return {"translated": req.text, "source": req.source, "target": req.target}

    translated = await asyncio.to_thread(_translate, req.text, req.source, req.target)
    return {"translated": translated, "source": req.source, "target": req.target}


@router.post("/api/translate/batch")
async def translate_batch(req: TranslateBatchRequest):
    """Translate multiple texts in one call (reduces HTTP overhead for chat)."""
    if req.source == req.target or not req.texts:
        return {"translations": req.texts, "source": req.source, "target": req.target}

    def _batch():
        results = []
        for text in req.texts:
            if not text.strip():
                results.append(text)
            else:
                results.append(_translate(text, req.source, req.target))
        return results

    translations = await asyncio.to_thread(_batch)
    return {"translations": translations, "source": req.source, "target": req.target}


@router.get("/api/translate/status")
async def translate_status():
    """Check if NLLB model is loaded and available."""
    return {
        "available": _translator is not None,
        "model_downloaded": MODEL_DIR.exists(),
        "model_path": str(MODEL_DIR),
        "languages": len(NLLB_LANG_MAP),
    }
