"""
Inference — POST /inference/stream
SSE streaming chat via llama-cpp-python (in-process, no server needed).
"""
import os
import json
import time
import logging
import asyncio
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("triage.inference")
router = APIRouter(tags=["inference"])

MODELS_DIR = Path(os.environ.get("EVE_MODELS_DIR",
                  Path(__file__).resolve().parent.parent.parent / "models"))

# ── LLM singleton ──────────────────────────────────────────────────────────────
_llm = None
_llm_name = None

def _get_llm():
    global _llm, _llm_name
    if _llm:
        return _llm
    try:
        from llama_cpp import Llama
        gguf_files = sorted(MODELS_DIR.glob("*.gguf"))
        if not gguf_files:
            raise FileNotFoundError(f"No GGUF models in {MODELS_DIR}")
        prefer = [f for f in gguf_files if "medgemma" in f.name.lower()]
        model_path = prefer[0] if prefer else gguf_files[0]
        logger.info(f"Loading {model_path.name} …")
        _llm = Llama(
            model_path=str(model_path),
            n_ctx=4096,
            n_threads=os.cpu_count() or 4,
            n_batch=512,        # prompt-eval batch size
            n_gpu_layers=0,
            use_mmap=True,      # memory-map model file (faster cold start)
            use_mlock=False,
            verbose=False,
        )
        _llm_name = model_path.name
        logger.info(f"LLM ready: {_llm_name}")
        return _llm
    except Exception as e:
        logger.error(f"LLM load failed: {e}")
        return None

# Pre-load at import time so first request has no warm-up delay
import threading
threading.Thread(target=_get_llm, daemon=True).start()

# ── Schemas ────────────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    max_tokens: Optional[int] = 512
    temperature: Optional[float] = 0.7

# ── Endpoint ───────────────────────────────────────────────────────────────────
@router.post("/inference/stream")
async def inference_stream(req: ChatRequest):
    llm = _get_llm()
    if not llm:
        raise HTTPException(503, "LLM not loaded — check model files in models/")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    def _stream():
        start = time.time()
        count = 0
        try:
            for chunk in llm.create_chat_completion(
                messages=messages,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
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
        "models": [{"name": f.stem, "filename": f.name,
                    "size_gb": round(f.stat().st_size / (1024**3), 2)} for f in gguf],
    }
