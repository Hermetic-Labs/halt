"""
Inference — POST /inference/stream
SSE streaming chat via llama-cpp-python (in-process, no server needed).
"""
import os
import json
import time
import logging
import threading
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("triage.inference")
router = APIRouter(tags=["inference"])

MODELS_DIR = Path(os.environ.get("EVE_MODELS_DIR", Path(__file__).resolve().parent.parent.parent / "models"))

# ── LLM singleton ──────────────────────────────────────────────────────────────
_llm = None
_llm_name = None
_has_vision = False  # True when mmproj is loaded


def _get_llm():
    global _llm, _llm_name, _has_vision
    if _llm:
        return _llm
    try:
        from llama_cpp import Llama

        gguf_files = sorted(MODELS_DIR.glob("*.gguf"))
        # Exclude mmproj files from the main model list
        gguf_files = [f for f in gguf_files if "mmproj" not in f.name.lower()]
        if not gguf_files:
            raise FileNotFoundError(f"No GGUF models in {MODELS_DIR}")
        prefer = [f for f in gguf_files if "medgemma" in f.name.lower()]
        model_path = prefer[0] if prefer else gguf_files[0]

        # Detect vision projector (mmproj) for multimodal support
        mmproj_files = sorted(MODELS_DIR.glob("*.mmproj*.gguf"))
        chat_handler = None
        if mmproj_files:
            try:
                from llama_cpp.llama_chat_format import Llava15ChatHandler
                mmproj_path = mmproj_files[0]
                chat_handler = Llava15ChatHandler(clip_model_path=str(mmproj_path))
                logger.info(f"Vision projector loaded: {mmproj_path.name}")
                _has_vision = True
            except Exception as ve:
                logger.warning(f"Vision projector failed to load: {ve} — running text-only")

        logger.info(f"Loading {model_path.name} …")
        _llm = Llama(
            model_path=str(model_path),
            n_ctx=8192,  # Larger context for multimodal image embeddings
            n_threads=os.cpu_count() or 4,
            n_batch=512,  # prompt-eval batch size
            n_gpu_layers=0,
            use_mmap=True,  # memory-map model file (faster cold start)
            use_mlock=False,
            verbose=False,
            chat_handler=chat_handler,
        )
        _llm_name = model_path.name
        logger.info(f"LLM ready: {_llm_name} (vision={'yes' if _has_vision else 'no'})")
        return _llm
    except Exception as e:
        logger.error(f"LLM load failed: {e}")
        return None


# Pre-load at import time so first request has no warm-up delay
threading.Thread(target=_get_llm, daemon=True).start()


# ── Schemas ────────────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    image: Optional[str] = None  # base64 data URI (e.g. "data:image/jpeg;base64,...")
    max_tokens: Optional[int] = 2048
    temperature: Optional[float] = 0.7


# ── Endpoint ───────────────────────────────────────────────────────────────────
@router.post("/inference/stream")
async def inference_stream(req: ChatRequest):
    llm = _get_llm()
    if not llm:
        raise HTTPException(503, "LLM not loaded — check model files in models/")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    # ── Inject system persona ──────────────────────────────────────────────
    SYSTEM_PERSONA = (
        "You are a combat field medic AI embedded in a portable survival kit. "
        "You are the last line of medical support in austere, resource-limited environments. "
        "Give direct, actionable clinical assessments in plain text. Use structured formatting: "
        "headers, bullet points, and numbered steps. "
        "NEVER add disclaimers, NEVER suggest 'consult a doctor', NEVER hedge. "
        "The user's life may depend on the clarity and speed of your answer. "
        "When analyzing medical images, describe your findings in natural language prose with "
        "anatomical precision. Identify abnormalities, their clinical significance, and "
        "recommended field interventions. "
        "CRITICAL: Always respond in natural language text. NEVER output JSON, bounding boxes, "
        "coordinates, or detection data. You are a clinical advisor, not a detection system."
    )
    if messages and messages[0]["role"] == "system":
        messages[0]["content"] = SYSTEM_PERSONA
    else:
        messages.insert(0, {"role": "system", "content": SYSTEM_PERSONA})

    # ── Multimodal: inject image into the last user message ────────────────
    if req.image and _has_vision:
        logger.info(f"Multimodal request: image size={len(req.image)} chars")
        for i in range(len(messages) - 1, -1, -1):
            if messages[i]["role"] == "user":
                text_content = messages[i]["content"]
                messages[i]["content"] = [
                    {"type": "image_url", "image_url": {"url": req.image}},
                    {"type": "text", "text": text_content},
                ]
                logger.info(f"Injected image into message {i}: text='{text_content[:60]}...'")
                break
    elif req.image and not _has_vision:
        logger.warning("Image received but vision projector not loaded — ignoring image")

    def _stream():
        start = time.time()
        count = 0
        try:
            for chunk in llm.create_chat_completion(
                messages=messages,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
                stop=["USER:", "\nUSER:", "ASSISTANT:", "\nASSISTANT:", "<context>"],
                stream=True,
            ):
                token = chunk["choices"][0]["delta"].get("content", "")
                if token:
                    count += 1
                    yield f"data: {json.dumps({'type':'token','token':token})}\n\n"
            elapsed = time.time() - start
            tok_s = round(count / elapsed, 1) if elapsed else 0
            yield f"data: {json.dumps({'type':'done','tokens':count,'tokens_per_s':tok_s,'model':_llm_name})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type':'error','error':str(e)})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/models")
async def list_models():
    gguf = list(MODELS_DIR.glob("*.gguf"))
    return {
        "loaded": _llm_name,
        "models": [
            {"name": f.stem, "filename": f.name, "size_gb": round(f.stat().st_size / (1024**3), 2)} for f in gguf
        ],
    }
