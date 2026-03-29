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
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routes import health, inference, tts, stt
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

    yield  # App is running


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(title="Medic Info API", version="1.0.3", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Open for mesh clients on local WiFi
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI / model routes
app.include_router(health.router)
app.include_router(inference.router)
app.include_router(tts.router, prefix="/tts")
app.include_router(stt.router, prefix="/stt")


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
