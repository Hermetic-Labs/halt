"""
Triage Image Generation — SD C++ (GGUF, Offline)
Generates clean grayscale medical instructional diagrams.
Runs natively via C++ on CPU. No HuggingFace networking required.

Model: models/sd-turbo/sd-turbo-f16.gguf
"""
import io
import os
import logging
import asyncio
from pathlib import Path
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

logger = logging.getLogger("triage.image")
router = APIRouter(tags=["image"])

MODELS_DIR = Path(os.environ.get("EVE_MODELS_DIR",
                  Path(__file__).resolve().parent.parent.parent / "models"))

_pipeline = None

def _get_pipeline():
    global _pipeline
    if _pipeline:
        return _pipeline

    # Searching for the SD-Turbo GGUF file
    model_path = next(MODELS_DIR.rglob("sd-turbo*.gguf"), None)
    if not model_path:
        logger.error(f"SD-Turbo GGUF model not found in {MODELS_DIR}")
        return None

    try:
        from stable_diffusion_cpp import StableDiffusion
        logger.info(f"Loading SD C++ backend from: {model_path}")
        
        # Load the single indestructible GGUF file
        # n_threads uses CPU limits
        _pipeline = StableDiffusion(
            model_path=str(model_path),
            n_threads=os.cpu_count() or 4,
            rng_type="STD_DEFAULT"
        )
        
        logger.info(f"SD C++ pipeline ready.")
        return _pipeline
    except Exception as e:
        logger.error(f"Image pipeline load error: {e}")
        return None

class ImageRequest(BaseModel):
    prompt: str
    steps: int = 4

@router.get("/health")
async def image_health():
    model_path = next(MODELS_DIR.rglob("sd-turbo*.gguf"), None)
    return {
        "loaded": _pipeline is not None,
        "model": str(model_path) if model_path else "Missing",
        "exists": model_path is not None
    }

@router.post("/generate")
async def generate_image(req: ImageRequest):
    pipe = _get_pipeline()
    if not pipe:
        raise HTTPException(503, "Image generator offline. Missing SD-Turbo GGUF model.")

    loop = asyncio.get_event_loop()
    try:
        def _run():
            styled = (
                f"{req.prompt.strip()}, black and white medical illustration, "
                "clean line art, instructional diagram, anatomical textbook style, "
                "step-by-step procedure, high contrast, minimal"
            )
            
            neg = "color, realistic, photo, messy"

            # stable-diffusion.cpp interface
            # Turbo models only require 1 to 4 steps
            images = pipe.generate_image(
                prompt=styled,
                negative_prompt=neg,
                sample_steps=max(1, min(req.steps, 8)),
                cfg_scale=1.5,
            )
            
            image = images[0]

            # Force true grayscale
            image = image.convert("L").convert("RGB")
            buf = io.BytesIO()
            image.save(buf, format="JPEG", quality=88)
            return buf.getvalue()

        jpeg_bytes = await loop.run_in_executor(None, _run)
        return Response(content=jpeg_bytes, media_type="image/jpeg")
    except Exception as e:
        logger.error(f"Image generation error: {e}")
        raise HTTPException(500, str(e))
