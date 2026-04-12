"""
Distribution — Model pack download, verification, and extraction.

Endpoints:
  GET  /api/distribution/status       — Check which packs are installed
  POST /api/distribution/download      — Download & extract a single pack
  GET  /api/distribution/progress     — SSE progress stream
  POST /api/distribution/download-all — Download all packs sequentially
"""
import asyncio
import hashlib
import json
import logging
import tarfile
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.responses import StreamingResponse
from urllib.request import urlopen, Request
from urllib.error import HTTPError

from config import MODELS_DIR

logger = logging.getLogger("triage.distribution")
router = APIRouter(tags=["distribution"])

# ── Pack Definitions ────────────────────────────────────────────────────────────

PACKS = {
    "voice": {
        "files": ["kokoro-v1.0.onnx", "voices-v1.0.bin"],
        "size_mb": 89,
        "check": lambda: ((MODELS_DIR / "kokoro-v1.0.onnx").exists() and (MODELS_DIR / "voices-v1.0.bin").exists()),
    },
    "stt": {
        "files": ["faster-whisper-base/"],
        "size_mb": 141,
        "check": lambda: (MODELS_DIR / "faster-whisper-base").is_dir(),
    },
    "translation": {
        "files": ["nllb-200-distilled-600M-ct2/"],
        "size_mb": 2361,
        "check": lambda: (MODELS_DIR / "nllb-200-distilled-600M-ct2").is_dir(),
    },
    "ai": {
        "files": ["*.gguf"],
        "size_mb": 2375,
        "check": lambda: bool(list(MODELS_DIR.glob("*.gguf"))),
    },
}

# Checksums are populated at release time
# Format: { "pack_name": { "filename": "sha256:..." } }
CHECKSUMS: dict[str, dict[str, str]] = {}

# ── Download State ───────────────────────────────────────────────────────────────

_download_lock = asyncio.Lock()
_active_download: dict = {"pack": None, "phase": None, "percent": 0, "bytes_done": 0, "bytes_total": 0}
_progress_queue: Optional[asyncio.Queue] = None


def _publish_progress(**kwargs):
    """Thread-safe progress update."""
    for key, value in kwargs.items():
        _active_download[key] = value
    if _progress_queue:
        try:
            _progress_queue.put_nowait(json.dumps(_active_download.copy()))
        except RuntimeError:
            pass  # Queue full, skip


async def _download_pack(pack_id: str, url: str):
    """Download, verify, and extract a model pack. Runs in background thread."""
    global _progress_queue

    if pack_id not in PACKS:
        _publish_progress(phase="error", percent=0, error=f"Unknown pack: {pack_id}")
        return

    pack = PACKS[pack_id]
    archive_path = MODELS_DIR / f"{pack_id}.tar.gz"

    # Initialize queue for this download
    _progress_queue = asyncio.Queue(maxsize=100)
    _publish_progress(pack=pack_id, phase="downloading", percent=0, bytes_done=0, bytes_total=0)

    try:
        # ── Download Phase ──────────────────────────────────────────────────────
        headers = {}
        existing_size = 0

        if archive_path.exists():
            existing_size = archive_path.stat().st_size
            headers["Range"] = f"bytes={existing_size}-"
            logger.info(f"[distribution] Resuming {pack_id} from byte {existing_size}")

        # Get total size first
        try:
            req = Request(url, method="HEAD", headers=headers)
            with urlopen(req, timeout=30) as resp:
                total_size = int(resp.headers.get("Content-Length", pack["size_mb"] * 1024 * 1024))
                if existing_size > 0 and "Content-Range" in resp.headers:
                    # Server confirmed resume
                    pass
                elif existing_size > 0:
                    # Can't resume, start over
                    existing_size = 0
                    archive_path.unlink(missing_ok=True)
                    headers = {}
        except Exception:
            total_size = pack["size_mb"] * 1024 * 1024  # Fallback estimate

        _publish_progress(bytes_total=total_size)

        # Stream download
        req = Request(url, headers=headers)
        with urlopen(req, timeout=300) as resp:
            mode = "ab" if existing_size > 0 and resp.status == 206 else "wb"
            with open(archive_path, mode) as f:
                downloaded = existing_size
                chunk_size = 8 * 1024  # 8KB chunks
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    percent = int((downloaded / total_size) * 100) if total_size > 0 else 0
                    _publish_progress(bytes_done=downloaded, percent=percent)

        # ── Verify Phase ───────────────────────────────────────────────────────
        _publish_progress(phase="verifying", percent=100)

        # Get expected hash for this pack
        pack_checksums = CHECKSUMS.get(pack_id, {})
        if pack_checksums:
            # Verify the archive matches
            file_hash = hashlib.sha256(archive_path.read_bytes()).hexdigest()
            expected = pack_checksums.get(f"{pack_id}.tar.gz", "")
            if expected and file_hash != expected:
                archive_path.unlink(missing_ok=True)
                _publish_progress(phase="error", error="Checksum mismatch - file corrupted")
                logger.error(f"[distribution] {pack_id} checksum mismatch: {file_hash} != {expected}")
                return

        # ── Extract Phase ─────────────────────────────────────────────────────
        _publish_progress(phase="extracting", percent=0)

        with tarfile.open(archive_path, "r:gz") as tar:
            members = tar.getmembers()
            total_members = len(members)
            for i, member in enumerate(members):
                tar.extract(member, MODELS_DIR)
                percent = int(((i + 1) / total_members) * 100)
                _publish_progress(percent=percent)

        # Cleanup archive
        archive_path.unlink(missing_ok=True)

        # ── Complete ───────────────────────────────────────────────────────────
        _publish_progress(phase="complete", percent=100)
        logger.info(f"[distribution] {pack_id} installed successfully")

    except HTTPError as e:
        _publish_progress(phase="error", error=f"HTTP {e.code}: {e.reason}")
        logger.exception(f"[distribution] HTTP error downloading {pack_id}")
        if archive_path.exists():
            archive_path.unlink(missing_ok=True)
    except Exception as e:
        _publish_progress(phase="error", error=str(e))
        logger.exception(f"[distribution] Error downloading {pack_id}")
        if archive_path.exists():
            archive_path.unlink(missing_ok=True)
    finally:
        _publish_progress(pack=None)
        _progress_queue = None


# ── Schemas ──────────────────────────────────────────────────────────────────────


class DownloadRequest(BaseModel):
    pack: str
    url: str


class DownloadAllRequest(BaseModel):
    packs: list[str]
    urls: dict[str, str]


class PackStatus(BaseModel):
    installed: bool
    size_mb: int


# ── Endpoints ───────────────────────────────────────────────────────────────────


@router.get("/api/distribution/status")
async def get_status():
    """Return installation status for all model packs."""
    result = {}
    for pack_id, pack in PACKS.items():
        installed = pack["check"]()
        result[pack_id] = {
            "installed": installed,
            "size_mb": pack["size_mb"],
        }

    return {
        "packs": result,
        "models_dir": str(MODELS_DIR),
    }


@router.post("/api/distribution/download")
async def download_pack(req: DownloadRequest):
    """Download and install a single model pack."""
    async with _download_lock:
        if _active_download.get("pack") is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Download already in progress: {_active_download['pack']}",
            )

        # Kick off download in background
        asyncio.create_task(_download_pack(req.pack, req.url))

    return {"status": "started", "pack": req.pack}


@router.get("/api/distribution/progress")
async def progress_stream():
    """SSE endpoint streaming download progress."""

    async def event_generator():
        # Wait for a download to start
        for _ in range(300):  # 30s max wait
            if _progress_queue is not None:
                break
            if _active_download.get("phase") == "complete":
                yield 'data: {"phase": "complete"}\n\n'
                return
            await asyncio.sleep(0.1)
            yield ": keepalive\n\n"

        if _progress_queue is None:
            yield 'data: {"phase": "idle"}\n\n'
            return

        # Read from the shared queue that the download writes to
        while True:
            try:
                data = await asyncio.wait_for(_progress_queue.get(), timeout=30)
                yield f"data: {data}\n\n"
                parsed = json.loads(data)
                if parsed.get("phase") in ("complete", "error") or parsed.get("pack") is None:
                    break
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                if _active_download.get("pack") is None:
                    break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/distribution/download-all")
async def download_all(req: DownloadAllRequest):
    """Download and install multiple packs sequentially."""
    async with _download_lock:
        if _active_download.get("pack") is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Download already in progress: {_active_download['pack']}",
            )

        # Queue all downloads
        for pack_id in req.packs:
            if pack_id not in PACKS:
                raise HTTPException(status_code=400, detail=f"Unknown pack: {pack_id}")
            url = req.urls.get(pack_id)
            if not url:
                raise HTTPException(status_code=400, detail=f"No URL provided for {pack_id}")

        # Start sequential downloads
        asyncio.create_task(_run_download_all(req.packs, req.urls))

    return {"status": "started", "packs": req.packs}


async def _run_download_all(pack_ids: list[str], urls: dict[str, str]):
    """Run downloads sequentially."""
    for pack_id in pack_ids:
        await _download_pack(pack_id, urls[pack_id])
        # Brief pause between packs
        await asyncio.sleep(1)


@router.get("/api/distribution/checksums")
async def get_checksums():
    """Return expected checksums for verification (populated at release time)."""
    return {"checksums": CHECKSUMS}


@router.post("/api/distribution/checksums")
async def set_checksums(data: dict[str, dict[str, str]]):
    """Set checksums for verification. Called during setup/release."""
    CHECKSUMS.update(data)
    return {"status": "ok", "packs_with_checksums": list(data.keys())}
