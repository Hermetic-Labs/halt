"""
Medic Info API — FastAPI entrypoint.

This is the slim bootstrap file: CORS setup, router wiring, lifespan hooks,
and static frontend serving. All domain logic lives in the route modules.

Static serving: when a pre-built Vite PWA exists at viewer/dist/, it's mounted
here so the entire system (API + frontend) runs as a single process. SPA
fallback ensures client-side routing works — any unmatched GET returns
index.html. In dev mode Vite runs separately on port 5173.
"""
import asyncio
import logging
import time as _time
import sys as _sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from routes import health, inference, tts, stt, translate_stream
from routes import patients, wards, inventory, roster, tasks, mesh, translate, distribution

# ── Paths ──────────────────────────────────────────────────────────────────────
_API_DIR = Path(__file__).resolve().parent
_DIST_DIR = _API_DIR.parent / "viewer" / "dist"


# ── Lifespan ───────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger("triage.main")
    logger.info("Medic Info API starting — models will lazy-load on first use.")

    # Start mesh stale-client checker
    asyncio.create_task(mesh.stale_checker())

    # Background warmup — loads TTS model then signals readiness to health endpoint
    import threading
    def _warmup():
        from routes.tts import _get_kokoro
        from routes.health import set_models_ready
        try:
            _get_kokoro()  # Loads ONNX model + warmup step
            logger.info("Model warmup complete — marking system ready.")
        except Exception as e:
            logger.warning(f"TTS warmup failed: {e} — marking ready anyway.")
        set_models_ready()

    threading.Thread(target=_warmup, daemon=True, name="model-warmup").start()

    yield  # App is running


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Medic Info API", version="1.0.6", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Open for mesh clients on local WiFi
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Colored Access Logging ─────────────────────────────────────────────────────
# Replaces uvicorn's default access log with color-coded, friendlier output.

_IS_TTY = _sys.stdout.isatty()
_G = "\033[92m" if _IS_TTY else ""   # green
_B = "\033[94m" if _IS_TTY else ""   # blue
_Y = "\033[93m" if _IS_TTY else ""   # amber
_R = "\033[91m" if _IS_TTY else ""   # red
_D = "\033[90m" if _IS_TTY else ""   # dim
_E = "\033[0m"  if _IS_TTY else ""   # reset

_STATUS_TEXT = {
    200: f"{_G}200 OK{_E}",
    304: f"{_B}304 unchanged{_E}",
    404: f"{_Y}404 not found{_E}",
    422: f"{_Y}422 invalid{_E}",
    500: f"{_R}500 error{_E}",
}

# Paths to suppress from access log (noisy, uninteresting)
_QUIET_PATHS = {"/health", "/tts/voices", "/image/health"}


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        t0 = _time.perf_counter()
        response = await call_next(request)
        ms = (_time.perf_counter() - t0) * 1000

        path = request.url.path
        # Skip noisy health-check spam
        if path in _QUIET_PATHS:
            return response

        code = response.status_code
        status = _STATUS_TEXT.get(code)
        if not status:
            if code < 300:
                status = f"{_G}{code}{_E}"
            elif code < 400:
                status = f"{_B}{code}{_E}"
            elif code < 500:
                status = f"{_Y}{code}{_E}"
            else:
                status = f"{_R}{code}{_E}"

        method = request.method
        print(f"  {_D}{method:4s}{_E} {path} {_D}->{_E} {status} {_D}{ms:.0f}ms{_E}")
        return response


app.add_middleware(AccessLogMiddleware)

# Suppress uvicorn's default access log (we handle it above)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

# AI / model routes
app.include_router(health.router)
app.include_router(inference.router)
app.include_router(tts.router, prefix="/tts")
app.include_router(stt.router, prefix="/stt")
app.include_router(translate_stream.router, prefix="/translate-stream")


# Domain routes
app.include_router(patients.router)
app.include_router(wards.router)
app.include_router(inventory.router)
app.include_router(roster.router)
app.include_router(tasks.router)
app.include_router(mesh.router)
app.include_router(translate.router)
app.include_router(distribution.router)


# ── Static frontend (pre-built Vite PWA) ──────────────────────────────────────
if _DIST_DIR.is_dir():
    # Mount static assets — only if subdirectory actually exists
    for _name in ("assets", "locales", "data", "logos"):
        _sub = _DIST_DIR / _name
        if _sub.is_dir():
            app.mount(f"/{_name}", StaticFiles(directory=_sub), name=_name)

    # Serve PWA manifest, service worker, and icons at root level
    @app.get("/manifest.webmanifest")
    @app.get("/sw.js")
    @app.get("/registerSW.js")
    @app.get("/workbox-{rest:path}")
    @app.get("/icon-{rest:path}")
    @app.get("/Icon.ico")
    async def pwa_files(request: Request):
        file_path = _DIST_DIR / request.url.path.lstrip("/")
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_DIST_DIR / "index.html")

    # SPA fallback — any unmatched GET returns index.html for client-side routing
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        file_path = _DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_DIST_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=7778, reload=True)
