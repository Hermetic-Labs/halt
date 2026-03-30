"""
start.py — Universal cross-platform launcher for HALT.

Orchestrates:
  1. Model auto-download  — First-run downloads ~4 GB of AI models from
                            public Cloudflare R2 (zero credentials) with
                            progress bar. One-time operation.
  2. Backend API server    — FastAPI via uvicorn on port 7778.
  3. Frontend dev server   — Vite on port 5173 (dev mode), or serves the
                            pre-built dist/ via Python http.server (prod).
  4. Browser auto-open     — 2-second delayed launch after dev server ready.
  5. Graceful shutdown     — Ctrl+C terminates both processes cleanly.

Cross-platform: handles Windows (CREATE_NEW_PROCESS_GROUP), macOS (bundled
runtime re-exec via os.execv), and Linux. On macOS distribution builds,
detects the bundled Python in runtime/python/bin/python3 and re-execs to
ensure pre-installed dependencies are available.

Usage:
    python start.py [--no-browser] [--prod] [--api-port PORT]
"""

import argparse
import os
import sys
import subprocess
import threading
import time
import webbrowser
import signal
import zipfile
import urllib.request

# ── Public R2 URLs (zero credentials needed) ─────────────────────────────────
MODELS_URL = "https://pub-b841d8ac01084f8f822078f923a49a87.r2.dev/halt-dev-assets/models.zip"
MODELS_CHECK_FILE = "medgemma-4b-it-q4_K_M.gguf"

# ── Platform Detection ────────────────────────────────────────────────────────

IS_WINDOWS = sys.platform.startswith("win")
IS_MAC = sys.platform.startswith("darwin")
IS_LINUX = sys.platform.startswith("linux")

PLATFORM = "Windows" if IS_WINDOWS else "Mac" if IS_MAC else "Linux"

# ── Bundled Runtime Detection (macOS distribution) ────────────────────────────
# If we're in a macOS distribution with a bundled Python, re-exec using it
# so all pre-installed dependencies are available.
if IS_MAC:
    _script_dir = os.path.dirname(os.path.abspath(__file__))
    _bundled_python = os.path.join(_script_dir, "runtime", "python", "bin", "python3")
    if os.path.isfile(_bundled_python) and os.path.realpath(sys.executable) != os.path.realpath(_bundled_python):
        os.execv(_bundled_python, [_bundled_python] + sys.argv)

# ── Colors for terminal output ────────────────────────────────────────────────


class Colors:
    HEADER = "\033[95m" if sys.stdout.isatty() else ""
    BLUE = "\033[94m" if sys.stdout.isatty() else ""
    GREEN = "\033[92m" if sys.stdout.isatty() else ""
    YELLOW = "\033[93m" if sys.stdout.isatty() else ""
    RED = "\033[91m" if sys.stdout.isatty() else ""
    ENDC = "\033[0m" if sys.stdout.isatty() else ""
    BOLD = "\033[1m" if sys.stdout.isatty() else ""


def log(info_type, message, color=""):
    prefix = {
        "INFO": f"{Colors.BLUE}[INFO]{Colors.ENDC}",
        "OK": f"{Colors.GREEN}[OK]{Colors.ENDC}",
        "WARN": f"{Colors.YELLOW}[WARN]{Colors.ENDC}",
        "ERROR": f"{Colors.RED}[ERROR]{Colors.ENDC}",
        "START": f"{Colors.GREEN}[START]{Colors.ENDC}",
        "STOP": f"{Colors.YELLOW}[STOP]{Colors.ENDC}",
    }.get(info_type, f"[{info_type}]")
    print(f"{prefix} {color}{message}{Colors.ENDC}")


# ── Process Management ────────────────────────────────────────────────────────


class ProcessManager:
    def __init__(self):
        self.processes = []
        self.shutting_down = False

    def add(self, name, proc):
        self.processes.append((name, proc))

    def terminate_all(self):
        self.shutting_down = True
        for name, proc in self.processes:
            try:
                log("STOP", f"Stopping {name}...", Colors.YELLOW)
                if IS_WINDOWS:
                    proc.terminate()
                else:
                    proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                log("WARN", f"Force killing {name}", Colors.YELLOW)
                proc.kill()
            except Exception as e:
                log("WARN", f"Error stopping {name}: {e}", Colors.YELLOW)
        self.processes.clear()

    def is_any_running(self):
        return any(p.poll() is None for _, p in self.processes if p)


# ── Directory Detection ───────────────────────────────────────────────────────


def find_project_root():
    """Find the project root (where api/, viewer/ exist)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [script_dir, os.path.dirname(script_dir)]
    for candidate in candidates:
        if os.path.isdir(os.path.join(candidate, "api")) and os.path.isdir(os.path.join(candidate, "viewer")):
            return candidate
    return script_dir


# ── Integrity Verification ────────────────────────────────────────────────────


def verify_integrity(root_dir):
    """Verify core files against MANIFEST.sha256 if present.

    Non-blocking — logs warnings but never prevents startup. In the field
    you might have a partially corrupt download with no way to re-download.
    Better to run with a warning than refuse to start.
    """
    manifest_path = os.path.join(root_dir, "MANIFEST.sha256")
    if not os.path.exists(manifest_path):
        return True  # No manifest = dev environment or pre-manifest build

    import hashlib

    log("INFO", "Verifying core file integrity...", Colors.BLUE)
    all_ok = True
    checked = 0

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # Format: <sha256>  <relative_path>
                parts = line.split("  ", 1)
                if len(parts) != 2:
                    continue
                expected_hash, rel_path = parts
                file_path = os.path.join(root_dir, rel_path)

                if not os.path.exists(file_path):
                    log("WARN", f"Missing: {rel_path}", Colors.YELLOW)
                    all_ok = False
                    continue

                actual_hash = hashlib.sha256(open(file_path, "rb").read()).hexdigest()
                if actual_hash != expected_hash:
                    log("WARN", f"CORRUPT: {rel_path} (hash mismatch)", Colors.RED)
                    all_ok = False
                else:
                    checked += 1

    except Exception as e:
        log("WARN", f"Manifest check error: {e}", Colors.YELLOW)
        return True  # Don't block on manifest read errors

    if all_ok:
        log("OK", f"All {checked} core files verified ✓", Colors.GREEN)
    else:
        log("WARN", "Some core files failed integrity check — system may be unstable", Colors.RED)
        log("WARN", "Re-download from https://github.com/Hermetic-Labs/halt/releases", Colors.RED)

    return all_ok


# ── Model Auto-Download ──────────────────────────────────────────────────────


def ensure_models(root_dir):
    """Check if AI models are present; download from public R2 if not."""
    models_dir = os.path.join(root_dir, "models")
    check_file = os.path.join(models_dir, MODELS_CHECK_FILE)

    if os.path.exists(check_file):
        log("OK", "AI models found", Colors.GREEN)
        return True

    log("INFO", "AI models not found — downloading from Cloudflare R2...")
    log("INFO", "This is a one-time ~4 GB download. Grab a coffee. ☕")
    print()

    zip_path = os.path.join(root_dir, "models.zip")

    try:
        # Get file size
        req = urllib.request.Request(MODELS_URL, method="HEAD")
        with urllib.request.urlopen(req):
            pass  # HEAD request confirms URL is reachable

        # Download with progress
        downloaded = [0]

        def report(block_num, block_size, total):
            downloaded[0] += block_size
            if total > 0:
                pct = min(downloaded[0] / total * 100, 100)
                mb = downloaded[0] / (1024**2)
                total_mb = total / (1024**2)
                sys.stdout.write(f"\r  [GET]     {pct:.0f}% ({mb:.0f} / {total_mb:.0f} MB)")
                sys.stdout.flush()

        # Add explicit User-Agent to bypass Cloudflare R2's 403 Forbidden block
        opener = urllib.request.build_opener()
        opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HALT/1.0.3')]
        urllib.request.install_opener(opener)

        urllib.request.urlretrieve(MODELS_URL, zip_path, reporthook=report)
        print()  # newline after progress
        log("OK", "Download complete", Colors.GREEN)

    except Exception as e:
        print()
        log("ERROR", f"Download failed: {e}", Colors.RED)
        log("INFO", "You can download models manually from:", Colors.BLUE)
        log("INFO", f"  {MODELS_URL}", Colors.BLUE)
        log("INFO", f"  Extract to: {models_dir}/", Colors.BLUE)
        return False

    # Extract
    log("INFO", "Extracting models...")
    try:
        os.makedirs(models_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(models_dir)
        log("OK", "Models ready", Colors.GREEN)
    except Exception as e:
        log("ERROR", f"Extraction failed: {e}", Colors.RED)
        return False
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)

    print()
    return True


# ── Backend Server ───────────────────────────────────────────────────────────


def start_backend(root_dir, port=7778, manager=None, use_reload=False):
    """Start the FastAPI backend server.

    Production mode (default): no --reload, matches Electron packaging.
    Dev mode (use_reload=True): enables hot-reload for backend development.
    """
    backend_dir = os.path.join(root_dir, "api")

    # Check if backend exists
    main_py = os.path.join(backend_dir, "main.py")
    if not os.path.exists(main_py):
        log("ERROR", f"Backend not found at {backend_dir}", Colors.RED)
        return None

    log("INFO", f"Starting API server on port {port}...")

    env = os.environ.copy()
    env["PORT"] = str(port)

    # Set HALT env vars if not already set (matches Electron's startBackend)
    if "HALT_MODELS_DIR" not in env:
        env["HALT_MODELS_DIR"] = os.path.join(root_dir, "models")
    if "HALT_DATA_DIR" not in env:
        env["HALT_DATA_DIR"] = os.path.join(root_dir, "patients")

    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(port)]
    if use_reload:
        cmd.append("--reload")

    try:
        kwargs = dict(
            cwd=backend_dir,
            env=env,
        )
        if IS_WINDOWS:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

        proc = subprocess.Popen(cmd, **kwargs)

        if manager:
            manager.add("API Server", proc)

        # Wait for server to be ready
        for i in range(30):  # 30 second timeout
            time.sleep(1)
            if proc.poll() is not None:
                log("ERROR", "API server exited prematurely", Colors.RED)
                return None
            # Check if port is listening
            if is_port_open("127.0.0.1", port):
                log("OK", f"API server ready on http://localhost:{port}", Colors.GREEN)
                return proc
        else:
            log("WARN", "API server taking long to start...", Colors.YELLOW)
            return proc

    except FileNotFoundError:
        log("ERROR", "Python or uvicorn not found. Is the virtual environment activated?", Colors.RED)
        return None
    except Exception as e:
        log("ERROR", f"Failed to start API server: {e}", Colors.RED)
        return None


def is_port_open(host, port):
    """Check if a port is open."""
    import socket

    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


# ── Frontend Server ───────────────────────────────────────────────────────────


def start_frontend(root_dir, api_port=7778, open_browser=True):
    """Handle frontend: in production, the API serves the PWA directly.

    Production (viewer/dist/ exists): Just open browser to the API port.
    Dev (HALT_DEV=1): Start Vite dev server on port 5173.
    """
    viewer_dir = os.path.join(root_dir, "viewer")
    dist_dir = os.path.join(viewer_dir, "dist")
    use_dev = os.environ.get("HALT_DEV", "")

    if os.path.isdir(dist_dir) and not use_dev:
        # Production mode — API server handles everything on one port
        log("INFO", f"Frontend served by API on port {api_port} (production mode)")
        if open_browser:
            def delayed_open():
                time.sleep(2)
                webbrowser.open(f"http://localhost:{api_port}")
            threading.Thread(target=delayed_open, daemon=True).start()
        return True

    elif use_dev:
        # Dev mode — Vite dev server for frontend hot-reload
        log("INFO", "Starting Vite dev server (HALT_DEV=1)...")
        npm_cmd = "npm.cmd" if IS_WINDOWS else "npm"
        port = 5173
        env = os.environ.copy()
        try:
            proc = subprocess.Popen(
                [npm_cmd, "run", "dev", "--", "--host", "0.0.0.0", "--port", str(port)],
                cwd=viewer_dir,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            for i in range(60):
                time.sleep(1)
                if proc.poll() is not None:
                    log("ERROR", "Vite dev server exited prematurely", Colors.RED)
                    return None
                if is_port_open("127.0.0.1", port):
                    url = f"http://localhost:{port}"
                    log("OK", f"Dev server ready at {url}", Colors.GREEN)
                    if open_browser:
                        def delayed_open():
                            time.sleep(2)
                            webbrowser.open(url)
                        threading.Thread(target=delayed_open, daemon=True).start()
                    return proc
            log("WARN", "Vite dev server taking long to start...", Colors.YELLOW)
            return proc
        except FileNotFoundError:
            log("ERROR", "npm not found. Is Node.js installed?", Colors.RED)
            return None
    else:
        log("WARN", "No viewer/dist/ found and HALT_DEV not set. Frontend unavailable.", Colors.YELLOW)
        log("INFO", "Run 'cd viewer && npm run build' to build the frontend, or set HALT_DEV=1 for dev mode.", Colors.BLUE)
        return True




# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="HALT Launcher")
    parser.add_argument("--no-browser", action="store_true", help="Don't open browser automatically")
    parser.add_argument("--prod", action="store_true", help="Use production build (no --reload)")
    parser.add_argument("--api-port", type=int, default=7778, help="API port (default: 7778)")
    args = parser.parse_args()

    # Set environment
    os.environ["PORT"] = str(args.api_port)

    # Determine if we should use hot-reload (dev mode)
    use_reload = not args.prod and os.environ.get("HALT_DEV", "") == "1"

    root = find_project_root()
    log("INFO", f"Project root: {root}")
    log("INFO", f"Platform: {PLATFORM}")
    log("INFO", f"Mode: {'development (--reload)' if use_reload else 'production'}")

    if not os.path.exists(os.path.join(root, "api", "main.py")):
        log("ERROR", "api/main.py not found. Are you in the right directory?", Colors.RED)
        sys.exit(1)

    # Verify core file integrity (non-blocking — warns but never prevents startup)
    verify_integrity(root)

    # Auto-download models if missing
    if not ensure_models(root):
        log("WARN", "Continuing without AI models — some features will be unavailable", Colors.YELLOW)

    manager = ProcessManager()

    # Handle Ctrl+C
    def signal_handler(sig, frame):
        print()  # New line after ^C
        manager.terminate_all()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, signal_handler)

    # Start backend (single process — serves API + static PWA)
    api_proc = start_backend(root, args.api_port, manager, use_reload=use_reload)
    if not api_proc:
        log("ERROR", "Failed to start API server", Colors.RED)
        sys.exit(1)

    # Handle frontend (open browser or start Vite dev server)
    start_frontend(root, api_port=args.api_port, open_browser=not args.no_browser)

    # Running
    print()
    log("START", "HALT is running!", Colors.GREEN + Colors.BOLD)
    print(
        f"""
  App & API:   http://localhost:{args.api_port}
  Lookup:      http://localhost:{args.api_port}/lookup

  Press Ctrl+C to stop.
"""
    )

    # Keep alive
    try:
        while manager.is_any_running():
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        manager.terminate_all()


if __name__ == "__main__":
    main()
