#!/usr/bin/env python3
"""
start.py - Universal launcher for HALT

Handles:
- Backend API server (FastAPI on port 7777)
- Frontend viewer (Vite dev server on port 5173, or serve dist/)
- Automatic browser opening
- Graceful shutdown on Ctrl+C

Usage:
    python start.py [--no-browser] [--prod] [--port PORT]
"""

import argparse
import os
import sys
import subprocess
import threading
import time
import webbrowser
import shutil
import signal
import zipfile
import urllib.request

# ── Public R2 URLs (zero credentials needed) ─────────────────────────────────
MODELS_URL = "https://pub-b841d8ac01084f8f822078f923a49a87.r2.dev/halt-dev-assets/models.zip"
MODELS_CHECK_FILE = "medgemma-4b-it-q4_K_M.gguf"

# ── Platform Detection ────────────────────────────────────────────────────────

IS_WINDOWS = sys.platform.startswith('win')
IS_MAC = sys.platform.startswith('darwin')
IS_LINUX = sys.platform.startswith('linux')

PLATFORM = "Windows" if IS_WINDOWS else "Mac" if IS_MAC else "Linux"

# ── Bundled Runtime Detection (macOS distribution) ────────────────────────────
# If we're in a macOS distribution with a bundled Python, re-exec using it
# so all pre-installed dependencies are available.
if IS_MAC:
    _script_dir = os.path.dirname(os.path.abspath(__file__))
    _bundled_python = os.path.join(_script_dir, 'runtime', 'python', 'bin', 'python3')
    if os.path.isfile(_bundled_python) and os.path.realpath(sys.executable) != os.path.realpath(_bundled_python):
        os.execv(_bundled_python, [_bundled_python] + sys.argv)

# ── Colors for terminal output ────────────────────────────────────────────────

class Colors:
    HEADER = '\033[95m' if sys.stdout.isatty() else ''
    BLUE = '\033[94m' if sys.stdout.isatty() else ''
    GREEN = '\033[92m' if sys.stdout.isatty() else ''
    YELLOW = '\033[93m' if sys.stdout.isatty() else ''
    RED = '\033[91m' if sys.stdout.isatty() else ''
    ENDC = '\033[0m' if sys.stdout.isatty() else ''
    BOLD = '\033[1m' if sys.stdout.isatty() else ''


def log(info_type, message, color=''):
    prefix = {
        'INFO': f'{Colors.BLUE}[INFO]{Colors.ENDC}',
        'OK': f'{Colors.GREEN}[OK]{Colors.ENDC}',
        'WARN': f'{Colors.YELLOW}[WARN]{Colors.ENDC}',
        'ERROR': f'{Colors.RED}[ERROR]{Colors.ENDC}',
        'START': f'{Colors.GREEN}[START]{Colors.ENDC}',
        'STOP': f'{Colors.YELLOW}[STOP]{Colors.ENDC}',
    }.get(info_type, f'[{info_type}]')
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
                log('STOP', f'Stopping {name}...', Colors.YELLOW)
                if IS_WINDOWS:
                    proc.terminate()
                else:
                    proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                log('WARN', f'Force killing {name}', Colors.YELLOW)
                proc.kill()
            except Exception as e:
                log('WARN', f'Error stopping {name}: {e}', Colors.YELLOW)
        self.processes.clear()

    def is_any_running(self):
        return any(p.poll() is None for _, p in self.processes if p)


# ── Directory Detection ───────────────────────────────────────────────────────

def find_project_root():
    """Find the project root (where api/, viewer/ exist)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [script_dir, os.path.dirname(script_dir)]
    for candidate in candidates:
        if os.path.isdir(os.path.join(candidate, 'api')) and os.path.isdir(os.path.join(candidate, 'viewer')):
            return candidate
    return script_dir


# ── Model Auto-Download ──────────────────────────────────────────────────────

def ensure_models(root_dir):
    """Check if AI models are present; download from public R2 if not."""
    models_dir = os.path.join(root_dir, 'models')
    check_file = os.path.join(models_dir, MODELS_CHECK_FILE)

    if os.path.exists(check_file):
        log('OK', 'AI models found', Colors.GREEN)
        return True

    log('INFO', 'AI models not found — downloading from Cloudflare R2...')
    log('INFO', f'This is a one-time ~4 GB download. Grab a coffee. ☕')
    print()

    zip_path = os.path.join(root_dir, 'models.zip')

    try:
        # Get file size
        req = urllib.request.Request(MODELS_URL, method='HEAD')
        with urllib.request.urlopen(req) as resp:
            total_size = int(resp.headers.get('Content-Length', 0))

        # Download with progress
        downloaded = [0]
        def report(block_num, block_size, total):
            downloaded[0] += block_size
            if total > 0:
                pct = min(downloaded[0] / total * 100, 100)
                mb = downloaded[0] / (1024 ** 2)
                total_mb = total / (1024 ** 2)
                sys.stdout.write(f'\r  [GET]     {pct:.0f}% ({mb:.0f} / {total_mb:.0f} MB)')
                sys.stdout.flush()

        urllib.request.urlretrieve(MODELS_URL, zip_path, reporthook=report)
        print()  # newline after progress
        log('OK', 'Download complete', Colors.GREEN)

    except Exception as e:
        print()
        log('ERROR', f'Download failed: {e}', Colors.RED)
        log('INFO', 'You can download models manually from:', Colors.BLUE)
        log('INFO', f'  {MODELS_URL}', Colors.BLUE)
        log('INFO', f'  Extract to: {models_dir}/', Colors.BLUE)
        return False

    # Extract
    log('INFO', 'Extracting models...')
    try:
        os.makedirs(models_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(models_dir)
        log('OK', 'Models ready', Colors.GREEN)
    except Exception as e:
        log('ERROR', f'Extraction failed: {e}', Colors.RED)
        return False
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)

    print()
    return True


# ── Backend Server ───────────────────────────────────────────────────────────

def start_backend(root_dir, port=7777, manager=None):
    """Start the FastAPI backend server."""
    backend_dir = os.path.join(root_dir, 'api')
    
    # Check if backend exists
    main_py = os.path.join(backend_dir, 'main.py')
    if not os.path.exists(main_py):
        log('ERROR', f'Backend not found at {backend_dir}', Colors.RED)
        return None
    
    log('INFO', f'Starting API server on port {port}...')
    
    env = os.environ.copy()
    env['PORT'] = str(port)
    
    try:
        if IS_WINDOWS:
            proc = subprocess.Popen(
                [sys.executable, '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', str(port), '--reload'],
                cwd=backend_dir,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0,
            )
        else:
            proc = subprocess.Popen(
                [sys.executable, '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', str(port), '--reload'],
                cwd=backend_dir,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        
        if manager:
            manager.add('API Server', proc)
        
        # Wait for server to be ready
        for i in range(30):  # 30 second timeout
            time.sleep(1)
            if proc.poll() is not None:
                log('ERROR', 'API server exited prematurely', Colors.RED)
                return None
            # Check if port is listening
            if is_port_open('127.0.0.1', port):
                log('OK', f'API server ready on http://localhost:{port}', Colors.GREEN)
                return proc
        else:
            log('WARN', 'API server taking long to start...', Colors.YELLOW)
            return proc
            
    except FileNotFoundError:
        log('ERROR', 'Python or uvicorn not found. Is the virtual environment activated?', Colors.RED)
        return None
    except Exception as e:
        log('ERROR', f'Failed to start API server: {e}', Colors.RED)
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

def start_frontend(root_dir, port=5173, manager=None, open_browser=True):
    """Start the Vite dev server or serve production build."""
    viewer_dir = os.path.join(root_dir, 'viewer')
    
    dist_dir = os.path.join(viewer_dir, 'dist')
    use_prod = os.path.isdir(dist_dir) and not os.environ.get('EVE_DEV', '')
    
    if use_prod:
        return start_frontend_prod(viewer_dir, port, manager)
    else:
        return start_frontend_dev(viewer_dir, port, manager, open_browser)


def start_frontend_dev(viewer_dir, port, manager=None, open_browser=True):
    """Start Vite development server."""
    log('INFO', f'Starting Vite dev server on port {port}...')
    
    env = os.environ.copy()
    env['VITE_PORT'] = str(port)
    
    try:
        # Find npm/node
        npm_cmd = 'npm.cmd' if IS_WINDOWS else 'npm'
        
        proc = subprocess.Popen(
            [npm_cmd, 'run', 'dev', '--', '--host', '0.0.0.0', '--port', str(port)],
            cwd=viewer_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        
        if manager:
            manager.add('Vite Dev', proc)
        
        # Wait for server to be ready
        for i in range(60):  # 60 second timeout
            time.sleep(1)
            if proc.poll() is not None:
                log('ERROR', 'Vite dev server exited prematurely', Colors.RED)
                return None
            if is_port_open('127.0.0.1', port):
                url = f'http://localhost:{port}'
                log('OK', f'Dev server ready at {url}', Colors.GREEN)
                if open_browser:
                    def delayed_open():
                        time.sleep(2)
                        webbrowser.open(url)
                    threading.Thread(target=delayed_open, daemon=True).start()
                return proc
        else:
            log('WARN', 'Vite dev server taking long to start...', Colors.YELLOW)
            return proc
            
    except FileNotFoundError:
        log('ERROR', 'npm not found. Is Node.js installed?', Colors.RED)
        return None
    except Exception as e:
        log('ERROR', f'Failed to start Vite dev server: {e}', Colors.RED)
        return None


def start_frontend_prod(viewer_dir, port, manager=None):
    """Serve production build using Python http.server."""
    import http.server
    import socketserver
    
    log('INFO', f'Serving production build on port {port}...')
    
    dist_dir = os.path.join(viewer_dir, 'dist')
    
    class SPAHandler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            # Serve index.html for SPA routes
            index_path = os.path.join(dist_dir, 'index.html')
            if os.path.exists(index_path):
                self.path = '/index.html'
            super().do_GET()
        
        def log_message(self, format, *args):
            pass  # Suppress logging
    
    Handler = lambda: SPAHandler
    Handler.directory = dist_dir
    
    try:
        with socketserver.TCPServer(('0.0.0.0', port), Handler) as httpd:
            url = f'http://localhost:{port}'
            log('OK', f'Production server ready at {url}', Colors.GREEN)
            
            # Run in a thread
            def serve():
                httpd.serve_forever()
            
            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            
            if manager:
                # For production, we can't easily terminate the thread, so we just flag it
                manager.add('Static Server', type('DummyProc', (), {'poll': lambda: None})())
            
            return httpd
            
    except Exception as e:
        log('ERROR', f'Failed to start production server: {e}', Colors.RED)
        return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='HALT Launcher')
    parser.add_argument('--no-browser', action='store_true', help='Don\'t open browser automatically')
    parser.add_argument('--prod', action='store_true', help='Use production build')
    parser.add_argument('--port', type=int, default=7777, help='Frontend port (default: 7777)')
    parser.add_argument('--api-port', type=int, default=7778, help='API port (default: 7778)')
    args = parser.parse_args()

    # Set environment
    if args.prod:
        os.environ['EVE_DEV'] = ''
    
    root = find_project_root()
    log('INFO', f'Project root: {root}')
    log('INFO', f'Platform: {PLATFORM}')
    
    if not os.path.exists(os.path.join(root, 'api', 'main.py')):
        log('ERROR', 'api/main.py not found. Are you in the right directory?', Colors.RED)
        sys.exit(1)
    
    if not os.path.exists(os.path.join(root, 'viewer', 'package.json')):
        log('ERROR', 'viewer/package.json not found. Are you in the right directory?', Colors.RED)
        sys.exit(1)
    
    # Auto-download models if missing
    if not ensure_models(root):
        log('WARN', 'Continuing without AI models — some features will be unavailable', Colors.YELLOW)
    
    manager = ProcessManager()
    
    # Handle Ctrl+C
    def signal_handler(sig, frame):
        print()  # New line after ^C
        manager.terminate_all()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, signal_handler)
    
    # Start backend
    api_proc = start_backend(root, args.api_port, manager)
    if not api_proc:
        log('ERROR', 'Failed to start API server', Colors.RED)
        sys.exit(1)
    
    # Start frontend
    frontend_proc = start_frontend(root, args.port, manager, open_browser=not args.no_browser)
    if not frontend_proc:
        log('ERROR', 'Failed to start frontend', Colors.RED)
        manager.terminate_all()
        sys.exit(1)
    
    # Wait for shutdown
    print()
    log('START', 'HALT is running!', Colors.GREEN + Colors.BOLD)
    print(f"""
  API Server:  http://localhost:{args.api_port}
  Web UI:      http://localhost:{args.port}
  Lookup:      http://localhost:{args.port}/lookup
  
  Press Ctrl+C to stop.
""")
    
    # Keep alive
    try:
        while manager.is_any_running():
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        manager.terminate_all()


if __name__ == '__main__':
    main()
