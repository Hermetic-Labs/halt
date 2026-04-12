"""
Inference — POST /inference/stream
SSE streaming chat via llama-cpp-python (in-process, no server needed).
Includes a FIFO queue with position feedback for multi-user mesh scenarios.
"""
import os
import json
import time
import logging
import asyncio
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from config import MODELS_DIR

logger = logging.getLogger("triage.inference")
router = APIRouter(tags=["inference"])

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
            n_threads=max(1, (os.cpu_count() or 4) - 2),  # Leave cores for Kokoro TTS Pipeline
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
        logger.exception("LLM load failed")
        return None


# Model lazy-loads on first call; background warmup is triggered by main.py startup.


# ── Inference Queue ────────────────────────────────────────────────────────────
# Single-threaded LLM can only serve one request at a time.
# The lock serializes requests; the counter gives queue position feedback.

_inference_lock = asyncio.Lock()
_queue_waiting = 0  # number of requests waiting for the lock
_queue_active = False  # whether a generation is currently running
_active_user = ""  # name of the user currently generating


# ── Schemas ────────────────────────────────────────────────────────────────────
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    image: Optional[str] = None  # base64 data URI (e.g. "data:image/jpeg;base64,...")
    max_tokens: Optional[int] = 2048
    temperature: Optional[float] = 0.7
    user_name: Optional[str] = ""  # for queue position feedback


# ── Main Endpoint ──────────────────────────────────────────────────────────────
@router.post("/inference/stream")
async def inference_stream(req: ChatRequest):
    global _queue_waiting

    # If lock is held, send queue position while waiting
    if _inference_lock.locked():
        _queue_waiting += 1
        position = _queue_waiting

        async def _queued_stream():
            global _queue_waiting, _queue_active, _active_user
            try:
                # Tell the client their position
                yield f"data: {json.dumps({'type': 'queued', 'position': position, 'active_user': _active_user})}\n\n"

                # Wait for our turn
                async with _inference_lock:
                    _queue_waiting = max(0, _queue_waiting - 1)
                    _queue_active = True
                    _active_user = req.user_name or "Unknown"

                    # Now generate
                    async for chunk in _do_generate(req):
                        yield chunk

                    _queue_active = False
                    _active_user = ""
            except Exception as e:
                _queue_waiting = max(0, _queue_waiting - 1)
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        return StreamingResponse(
            _queued_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # No queue — generate immediately
    async def _immediate_stream():
        global _queue_active, _active_user
        async with _inference_lock:
            _queue_active = True
            _active_user = req.user_name or "Unknown"
            async for chunk in _do_generate(req):
                yield chunk
            _queue_active = False
            _active_user = ""

    return StreamingResponse(
        _immediate_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _do_generate(req: ChatRequest):
    """Core generation logic — yields SSE chunks."""
    llm = await asyncio.to_thread(_get_llm)
    if not llm:
        yield f"data: {json.dumps({'type': 'error', 'error': 'LLM not loaded — check model files in models/'})}\n\n"
        return

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    # ── Inject system persona ──────────────────────────────────────────────
    # Override the default chat template's generic prompt with our field medic persona.
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
    # Prepend system message (or replace if one already exists)
    if messages and messages[0]["role"] == "system":
        messages[0]["content"] = SYSTEM_PERSONA
    else:
        messages.insert(0, {"role": "system", "content": SYSTEM_PERSONA})

    # ── Multimodal: inject image into the last user message ────────────────
    if req.image and _has_vision:
        logger.info(f"Multimodal request: image size={len(req.image)} chars")
        # Find last user message and convert to multimodal content array
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

    def _sync_stream():
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
                    yield json.dumps({"type": "token", "token": token})
            elapsed = time.time() - start
            tok_s = round(count / elapsed, 1) if elapsed else 0
            yield json.dumps({"type": "done", "tokens": count, "tokens_per_s": tok_s, "model": _llm_name})
        except Exception as e:
            yield json.dumps({"type": "error", "error": str(e)})

    # Run synchronous generator in thread, yield SSE chunks
    import queue

    result_q: queue.Queue = queue.Queue()

    def _run():
        for item in _sync_stream():
            result_q.put(item)
        result_q.put(None)  # sentinel

    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run)

    while True:
        try:
            item = await asyncio.to_thread(result_q.get, timeout=30)
            if item is None:
                break
            yield f"data: {item}\n\n"
        except Exception:
            break


# ── Queue Status ───────────────────────────────────────────────────────────────
@router.get("/inference/queue")
def inference_queue_status():
    """Current queue state — useful for UI indicators."""
    return {
        "active": _queue_active,
        "active_user": _active_user,
        "waiting": _queue_waiting,
        "model": _llm_name,
        "vision": _has_vision,
    }


@router.get("/models")
async def list_models():
    gguf = list(MODELS_DIR.glob("*.gguf"))
    return {
        "loaded": _llm_name,
        "models": [
            {"name": f.stem, "filename": f.name, "size_gb": round(f.stat().st_size / (1024**3), 2)} for f in gguf
        ],
    }
