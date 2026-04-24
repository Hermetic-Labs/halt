"""
HALT Build & Deploy Pipeline
=============================
Builds the app for Windows (Electron) or macOS (standalone Python), bumps
version, zips, and uploads to Cloudflare R2.

Usage:
  python build_and_deploy.py                       # Build Windows (default)
  python build_and_deploy.py --platform mac        # Build macOS (run on a Mac)
  python build_and_deploy.py --deploy              # Build + upload to R2
  python build_and_deploy.py --bump minor          # Bump minor version
  python build_and_deploy.py --zip-only            # Zip existing build
  python build_and_deploy.py --release             # Full release pipeline
  python build_and_deploy.py --upload-assets       # Upload dev assets to R2
"""

import os
import sys
import json
import shutil
import subprocess
import argparse
import threading
import zipfile
import platform as platform_mod
from pathlib import Path

# ── Paths (all relative to repo root) ────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
ELECTRON_DIR = REPO_ROOT / "dev" / "electron-launcher"
PKG_JSON = ELECTRON_DIR / "package.json"
BUILDS_DIR = REPO_ROOT / "builds"

# ── R2 Configuration (from environment — never commit secrets) ────────────────
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY", "")
R2_SECRET_KEY = os.environ.get("R2_SECRET_KEY", "")
R2_BUCKET = "hermetic-labs-triage"
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else ""


def banner():
    print()
    print("  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — Build & Deploy Pipeline      ║")
    print("  ╚═══════════════════════════════════════╝")
    print()


def read_version():
    """Read current version from electron-launcher package.json."""
    pkg = json.loads(PKG_JSON.read_text(encoding="utf-8"))
    return pkg["version"]


def bump_version(level="patch"):
    """Bump version in package.json. Preserves pre-release suffix (e.g. -alpha)."""
    pkg = json.loads(PKG_JSON.read_text(encoding="utf-8"))
    old_version = pkg["version"]

    # Separate pre-release suffix (e.g. '1.0.1-alpha' → '1.0.1', '-alpha')
    base = old_version.split("-")[0]
    suffix = "-" + old_version.split("-", 1)[1] if "-" in old_version else ""

    parts = [int(x) for x in base.split(".")]

    if level == "major":
        parts = [parts[0] + 1, 0, 0]
    elif level == "minor":
        parts = [parts[0], parts[1] + 1, 0]
    else:  # patch
        parts = [parts[0], parts[1], parts[2] + 1]

    new_version = ".".join(str(p) for p in parts) + suffix
    pkg["version"] = new_version
    PKG_JSON.write_text(json.dumps(pkg, indent=4) + "\n", encoding="utf-8")

    print(f"  [VERSION] {old_version} → {new_version}")
    return new_version


def stage_app(version):
    """
    Stage the app source into the electron-launcher directory structure
    so electron-builder can package it. Mirrors the resources/app/ layout
    that the production build uses.
    """
    stage_dir = ELECTRON_DIR / "app-stage"

    print("  [STAGE]   Preparing app bundle...")

    # Clean previous stage
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir()

    # Build frontend from source (viewer/src → viewer/dist)
    viewer_src = REPO_ROOT / "viewer" / "src"
    viewer_pkg = REPO_ROOT / "viewer" / "package.json"
    if viewer_src.exists() and viewer_pkg.exists():
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        viewer_dir = REPO_ROOT / "viewer"

        # Ensure node_modules are installed (uses lock file + offline cache if air-gapped)
        if not (viewer_dir / "node_modules").exists():
            print("  [BUILD]   Installing frontend dependencies (npm install)...")
            result = subprocess.run(
                [npm_cmd, "install"],
                cwd=viewer_dir,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"            [ERROR] npm install failed:\n{result.stderr}")
                sys.exit(1)

        print("  [BUILD]   Building frontend (npm run build)...")
        result = subprocess.run([npm_cmd, "run", "build"], cwd=viewer_dir)
        if result.returncode != 0:
            print("            [ERROR] Frontend build failed (see output above)")
            sys.exit(1)
        print("  [OK]      Frontend built")
    else:
        print("            [INFO] No viewer source found, using existing dist/")

    # Copy directories into stage.
    # NOTE: viewer/ — only ship the compiled dist/, NOT src/node_modules/configs.
    # Full source lives in git; only the production build goes into the Electron package.
    # triage/ has ~44K raw ICD-10 source files already compiled
    # into viewer/dist/data/conditions-index.json. We don't ship this raw source data.
    copies = [
        (REPO_ROOT / "api", stage_dir / "api"),
        (REPO_ROOT / "electron", stage_dir / "electron"),
        (REPO_ROOT / "viewer" / "dist", stage_dir / "viewer" / "dist"),
        (REPO_ROOT / "models", stage_dir / "models"),
        (REPO_ROOT / "runtime", stage_dir / "runtime"),
    ]

    for src, dst in copies:
        if src.exists():
            print(f"            copying {src.name}/...")
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            print(f"            [WARN] {src.name}/ not found, skipping")

    # Copy start.py
    start_py = REPO_ROOT / "start.py"
    if start_py.exists():
        shutil.copy2(start_py, stage_dir / "start.py")

    print("  [OK]      App staged")
    return stage_dir


def build_tauri(version):
    """Run Tauri builder to produce the native Windows MSIX/NSIS distributions."""
    print("  [BUILD]   Running Tauri (Windows Native)...")

    viewer_dir = REPO_ROOT / "viewer"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    # Ensure node_modules exist
    if not (viewer_dir / "node_modules").exists():
        print("            Installing npm dependencies...")
        subprocess.run([npm_cmd, "install"], cwd=str(viewer_dir), check=True, shell=sys.platform == "win32")

    # Sync icons to native framework
    repo_logo = REPO_ROOT / "assets" / "logo.png"
    if repo_logo.exists():
        print("  [ICONS]   Regenerating Tauri asset pool from D:\\Halt\\assets\\logo.png")
        subprocess.run([npm_cmd, "run", "tauri", "icon", str(repo_logo)], cwd=str(viewer_dir), shell=sys.platform == "win32")

    # ── Azure Trusted Signing (Authenticode — removes SmartScreen warning) ────
    _signing_vars = [
        "AZURE_TENANT_ID",
        "AZURE_CLIENT_ID",
        "AZURE_CLIENT_SECRET",
    ]
    _signing_env = {k: os.environ[k] for k in _signing_vars if k in os.environ}

    build_env = os.environ.copy()
    if len(_signing_env) == len(_signing_vars):
        build_env.update(_signing_env)
        print("  [SIGN]    Azure Trusted Signing credentials detected — build will be signed")
        print("            Account: haltsigning | Profile: HaltSigningProfile")
    else:
        _missing = [k for k in _signing_vars if k not in os.environ]
        print(f"  [SIGN]    Skipping — missing env vars: {', '.join(_missing)}")
        print("            Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET to sign")

    # ── CARGO TARGET DIR BYPASS (OS Error 4551 Mitigation) ────
    # Cargo allows us to offload the execution of unverified binaries to a different drive.
    # We will map the target output strictly to the User's C-Drive profile.
    c_drive_target = Path(os.path.expanduser("~/Halt-Tauri-Target"))
    build_env["CARGO_TARGET_DIR"] = str(c_drive_target)
    print(f"  [RUST]    Offloading compile target to: {c_drive_target}")

    result = subprocess.run(
        [npm_cmd, "run", "tauri", "build", "--", "--bundles", "nsis"],
        cwd=str(viewer_dir),
        shell=sys.platform == "win32",
        env=build_env,
    )

    if result.returncode != 0:
        print(f"  [ERROR]   Tauri build failed (exit {result.returncode})")
        return None

    # Find the output
    bundle_dir = c_drive_target / "release" / "bundle"
    if bundle_dir.exists():
        print(f"  [OK]      Build complete: {bundle_dir}")
        return bundle_dir
    else:
        print(f"  [ERROR]   bundle out not found in {bundle_dir}")
        return None


# ── macOS Build ──────────────────────────────────────────────────────────────

# Standalone Python URLs (python-build-standalone)
PYTHON_VERSION = "3.13.3"
PYTHON_RELEASE = "20250517"
PYTHON_URLS = {
    "arm64": f"https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE}/cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-aarch64-apple-darwin-install_only.tar.gz",
    "x64": f"https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE}/cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-x86_64-apple-darwin-install_only.tar.gz",
}


def detect_mac_arch():
    """Detect current Mac architecture."""
    machine = platform_mod.machine()
    if machine == "arm64":
        return "arm64"
    elif machine == "x86_64":
        return "x64"
    else:
        print(f"  [ERROR]   Unsupported architecture: {machine}")
        sys.exit(1)


def build_macos_runtime(version):
    """Download standalone Python and install all deps for macOS distribution."""
    arch = detect_mac_arch()
    print(f"  [BUILD]   Building macOS runtime ({arch})...")

    runtime_dir = REPO_ROOT / "runtime"
    python_dir = runtime_dir / "python"
    python_bin = python_dir / "bin" / "python3"

    # Step 1: Download standalone Python if needed
    if python_bin.exists():
        print(f"  [SKIP]    Standalone Python already at {python_dir}")
    else:
        url = PYTHON_URLS[arch]
        tarball = REPO_ROOT / "python-standalone.tar.gz"
        print(f"  [GET]     Downloading Python {PYTHON_VERSION} ({arch})...")

        import urllib.request

        urllib.request.urlretrieve(url, str(tarball))
        print("  [UNZIP]   Extracting...")

        runtime_dir.mkdir(exist_ok=True)
        subprocess.run(["tar", "-xzf", str(tarball), "-C", str(runtime_dir)], check=True)
        tarball.unlink()

        if not python_bin.exists():
            print(f"  [ERROR]   Python binary not found at {python_bin}")
            sys.exit(1)

        print(f"  [OK]      Python {PYTHON_VERSION} ready")

    # Step 2: Install deps
    print("  [PIP]     Installing dependencies...")
    subprocess.run([str(python_bin), "-m", "pip", "install", "--upgrade", "pip", "--quiet"], check=True)
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "-r", str(REPO_ROOT / "requirements.txt"), "--quiet"], check=True
    )

    # GPU acceleration for llama-cpp-python (Metal on ARM, CPU-only on Intel)
    env = os.environ.copy()
    if arch == "arm64":
        print("  [GPU]     Installing llama-cpp-python with Metal acceleration...")
        env["CMAKE_ARGS"] = "-DGGML_METAL=on"
    else:
        print("  [CPU]     Installing llama-cpp-python (CPU-only, no Metal on Intel)...")
        env["CMAKE_ARGS"] = "-DGGML_METAL=off"
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "llama-cpp-python", "--quiet", "--force-reinstall", "--no-cache-dir"],
        env=env,
        check=True,
    )

    # Step 3: Verify critical imports
    print("  [CHECK]   Verifying critical packages...")
    critical = ["fastapi", "uvicorn", "llama_cpp", "kokoro_onnx", "onnxruntime", "faster_whisper", "ctranslate2"]
    for pkg in critical:
        result = subprocess.run([str(python_bin), "-c", f"import {pkg}"], capture_output=True)
        status = "✓" if result.returncode == 0 else "✗"
        print(f"            {status} {pkg}")
        if result.returncode != 0:
            print(f"  [ERROR]   {pkg} failed to import")
            sys.exit(1)

    print(f"  [OK]      macOS runtime ready ({arch})")
    return arch


def stage_macos(version):
    """Stage the macOS distribution into a build folder."""
    arch = detect_mac_arch()
    folder_name = f"HALT-v{version}-macOS-{arch}"
    stage_dir = BUILDS_DIR / folder_name

    print("  [STAGE]   Preparing macOS bundle...")

    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)

    # Build frontend if viewer source exists (same as Windows path)
    viewer_src = REPO_ROOT / "viewer" / "src"
    viewer_pkg = REPO_ROOT / "viewer" / "package.json"
    if viewer_src.exists() and viewer_pkg.exists():
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        viewer_dir = REPO_ROOT / "viewer"

        if not (viewer_dir / "node_modules").exists():
            print("  [BUILD]   Installing frontend dependencies (npm install)...")
            result = subprocess.run(
                [npm_cmd, "install"],
                cwd=viewer_dir,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"            [ERROR] npm install failed:\n{result.stderr}")
                sys.exit(1)

        print("  [BUILD]   Building frontend (npm run build)...")
        result = subprocess.run([npm_cmd, "run", "build"], cwd=viewer_dir)
        if result.returncode != 0:
            print("            [ERROR] Frontend build failed (see output above)")
            sys.exit(1)
        print("  [OK]      Frontend built")
    else:
        print("            [INFO] No viewer source found, using existing dist/")

    # Copy directories into stage.
    # NOTE: viewer/ — only ship the compiled dist/, NOT src/node_modules/configs.
    # triage/ has ~44K raw ICD-10 source files already compiled
    # into viewer/dist/data/conditions-index.json. We don't ship this raw source data.
    copies = [
        (REPO_ROOT / "api", stage_dir / "api"),
        (REPO_ROOT / "viewer" / "dist", stage_dir / "viewer" / "dist"),
        (REPO_ROOT / "models", stage_dir / "models"),
        (REPO_ROOT / "runtime", stage_dir / "runtime"),
        (REPO_ROOT / "assets", stage_dir / "assets"),
        (REPO_ROOT / "viewer" / "src-tauri" / "icons", stage_dir / "icons"),
    ]

    for src, dst in copies:
        if src.exists():
            print(f"            copying {src.name}/...")
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            print(f"            [WARN] {src.name}/ not found, skipping")

    # Copy top-level files
    for f in ["start.py", "requirements.txt", "README.md", "LICENSE", "HALT.command"]:
        src = REPO_ROOT / f
        if src.exists():
            shutil.copy2(src, stage_dir / f)

    # Make launcher executable
    launcher = stage_dir / "HALT.command"
    if launcher.exists():
        os.chmod(str(launcher), 0o755)

    # Clean up __pycache__
    for p in stage_dir.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)
    for p in stage_dir.rglob("*.pyc"):
        p.unlink(missing_ok=True)

    # Generate comprehensive git metadata for Apple deployment
    print("  [META]    Extracting build metadata from Git...")
    try:
        def get_git(cmd_arg):
            return subprocess.check_output(["git"] + cmd_arg, cwd=str(REPO_ROOT)).decode("utf-8").strip()

        meta = {
            "version": version,
            "commit": get_git(["rev-parse", "HEAD"]),
            "branch": get_git(["rev-parse", "--abbrev-ref", "HEAD"]),
            "author": get_git(["log", "-1", "--format=%an <%ae>"]),
            "date": get_git(["log", "-1", "--format=%cd"]),
            "platform": "macOS",
            "arch": detect_mac_arch(),
        }
        meta_path = stage_dir / "build_metadata.json"
        meta_path.write_text(json.dumps(meta, indent=2))
        print("            Metadata written to build_metadata.json")
    except Exception as e:
        print(f"            [WARN] Could not extract git metadata: {e}")

    print(f"  [OK]      macOS bundle staged: {stage_dir}")
    return stage_dir


def zip_distribution(source_dir, version, platform_name="Windows"):
    """Zip the distribution into builds/ using smart compression.

    Binary/incompressible formats (.gguf, .onnx, .exe, .dll, etc.) are stored
    with ZIP_STORED (no compression) since they don't shrink further — this
    makes packing and unpacking dramatically faster for multi-GB archives.
    Source files (.py, .json, .html, .js, .css) use ZIP_DEFLATED for real savings.

    Also generates a SHA-256 integrity manifest (MANIFEST.sha256) for critical
    core files so the launcher can verify nothing got corrupted in transit.
    """
    BUILDS_DIR.mkdir(exist_ok=True)

    zip_name = f"HALT-v{version}-{platform_name}.zip"
    zip_path = BUILDS_DIR / zip_name

    print(f"  [ZIP]     Creating {zip_name} (ZIP64, smart compression)...")
    print(f"            Source: {source_dir}")

    # ── File extensions that don't benefit from compression ────────────────
    # These are already compressed or binary-packed. Deflating them wastes
    # minutes on multi-GB files with near-zero size reduction.
    STORED_EXTENSIONS = {
        # AI models
        ".gguf",
        ".onnx",
        ".bin",
        ".model",
        ".safetensors",
        # Python runtime binaries
        ".exe",
        ".dll",
        ".pyd",
        ".so",
        ".dylib",
        ".node",
        # Pre-compressed archives and packages
        ".whl",
        ".zip",
        ".gz",
        ".tar",
        ".bz2",
        ".xz",
        ".zst",
        # Media (already compressed)
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".ico",
        ".gif",
        ".mp3",
        ".mp4",
        ".webm",
        ".wav",
        ".ogg",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        # Misc binary
        ".pyc",
        ".pyo",
        ".db",
        ".sqlite",
    }

    # ── Core files that get SHA-256 integrity hashes ──────────────────────
    # These are the files that absolutely cannot be corrupt — if any of
    # these are wrong, the system won't function correctly.
    # Paths match the Electron build layout (resources/app/...) and also
    # the standalone macOS layout (direct root).
    CORE_FILENAMES = {"start.py", "main.py", "config.py", "storage.py", "bridge.py"}

    # Collect all files (skip __pycache__ — Python regenerates .pyc on first import)
    all_files = []
    for root, dirs, files in os.walk(source_dir):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            if f.endswith(".pyc") or f.endswith(".pyo"):
                continue
            all_files.append(os.path.join(root, f))

    total = len(all_files)
    stored_count = 0
    deflated_count = 0
    stored_bytes = 0
    deflated_bytes = 0
    manifest_entries = []

    print(f"            {total} files to package...")

    import hashlib

    with zipfile.ZipFile(str(zip_path), "w", allowZip64=True) as zf:
        for i, filepath in enumerate(all_files, 1):
            arcname = os.path.relpath(filepath, str(source_dir.parent))
            ext = os.path.splitext(filepath)[1].lower()
            file_size = os.path.getsize(filepath)

            # Create explicit ZipInfo to preserve filesystem permissions (e.g. chmod +x)
            zinfo = zipfile.ZipInfo.from_file(filepath, arcname)

            # Smart compression: store binaries, deflate source
            if ext in STORED_EXTENSIONS:
                zinfo.compress_type = zipfile.ZIP_STORED
                stored_count += 1
                stored_bytes += file_size
            else:
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                deflated_count += 1
                deflated_bytes += file_size

            with open(filepath, "rb") as f:
                zf.writestr(zinfo, f.read())

            # SHA-256 for core files — match by filename in relevant directories.
            # Works for both Electron (resources/app/api/main.py) and standalone layouts.
            rel_in_stage = os.path.relpath(filepath, str(source_dir))
            fname = os.path.basename(filepath)
            if fname in CORE_FILENAMES and fname.endswith(".py"):
                # Only hash files that are in api/ or project root — not random
                # main.py files buried in runtime/python/Lib/...
                rel_parts = rel_in_stage.replace("\\", "/").split("/")
                # Accept if the file is at root level or its parent is "api"
                is_core = (
                    len(rel_parts) == 1  # root level (start.py)
                    or any(
                        part == "api" and idx == len(rel_parts) - 2 for idx, part in enumerate(rel_parts)
                    )  # api/X.py
                    or "resources/app/api" in rel_in_stage.replace("\\", "/")  # Electron: resources/app/api/X.py
                    or rel_in_stage.replace("\\", "/").endswith(
                        "resources/app/start.py"
                    )  # Electron: resources/app/start.py
                )
                if is_core:
                    file_hash = hashlib.sha256(open(filepath, "rb").read()).hexdigest()
                    manifest_entries.append(f"{file_hash}  {rel_in_stage}")

            if i % 500 == 0 or i == total:
                pct = (i / total) * 100
                sys.stdout.write(f"\r            {pct:.0f}% ({i}/{total} files)")
                sys.stdout.flush()

        # Write manifest into the ZIP
        if manifest_entries:
            manifest_content = "\n".join(sorted(manifest_entries)) + "\n"
            zf.writestr(
                os.path.join(os.path.basename(str(source_dir)), "MANIFEST.sha256"),
                manifest_content,
                compress_type=zipfile.ZIP_DEFLATED,
            )

    print()
    size_gb = os.path.getsize(str(zip_path)) / (1024**3)
    stored_mb = stored_bytes / (1024**2)
    deflated_mb = deflated_bytes / (1024**2)
    print(f"  [OK]      {zip_path} ({size_gb:.2f} GB, ZIP64)")
    print(f"            STORED: {stored_count} files ({stored_mb:.0f} MB) — no compression (binary)")
    print(f"            DEFLATED: {deflated_count} files ({deflated_mb:.0f} MB) — compressed (source)")
    print(f"            MANIFEST: {len(manifest_entries)} core files SHA-256 verified")
    return str(zip_path)


def upload_to_r2(zip_path, version, platform_name="Windows"):
    """Upload the zip to Cloudflare R2 using multipart upload."""
    if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY]):
        print("  [ERROR]   R2 credentials not set. Export these env vars:")
        print("            R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY")
        return False
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
    except ImportError:
        print("  [ERROR]   boto3 not installed. Run: pip install boto3")
        return False

    object_name = f"HALT-v{version}-{platform_name}.zip"
    file_size = os.path.getsize(zip_path)

    print(f"  [UPLOAD]  {object_name} ({file_size / (1024**3):.2f} GB)")
    print(f"            Bucket: {R2_BUCKET}")
    print(f"            Endpoint: {R2_ENDPOINT}")

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )

    # 100MB chunks, 4 threads
    config = TransferConfig(
        multipart_threshold=100 * 1024 * 1024,
        max_concurrency=4,
        multipart_chunksize=100 * 1024 * 1024,
        use_threads=True,
    )

    class Progress:
        def __init__(self, total):
            self._total = float(total)
            self._seen = 0
            self._lock = threading.Lock()

        def __call__(self, bytes_amount):
            with self._lock:
                self._seen += bytes_amount
                pct = (self._seen / self._total) * 100
                mb_done = self._seen / (1024**2)
                mb_total = self._total / (1024**2)
                sys.stdout.write(f"\r            {pct:.1f}% ({mb_done:.0f} / {mb_total:.0f} MB)")
                sys.stdout.flush()

    try:
        s3.upload_file(
            zip_path,
            R2_BUCKET,
            object_name,
            Config=config,
            Callback=Progress(file_size),
            ExtraArgs={
                "ContentDisposition": f'attachment; filename="{object_name}"',
                "ContentType": "application/zip",
            },
        )
        print()
        print("  [OK]      Upload complete!")

        # Also upload as latest (direct upload, not copy — R2 copy hangs on large objects)
        latest_name = f"HALT-latest-{platform_name}.zip"
        print(f"  [UPLOAD]  Uploading as {latest_name}...")
        s3.upload_file(
            zip_path,
            R2_BUCKET,
            latest_name,
            Config=config,
            Callback=Progress(file_size),
            ExtraArgs={
                "ContentDisposition": f'attachment; filename="{latest_name}"',
                "ContentType": "application/zip",
            },
        )
        print()
        print("  [OK]      Latest pointer updated")
        return True

    except Exception as e:
        print(f"\n  [ERROR]   Upload failed: {e}")
        return False


def upload_dev_assets():
    """Zip models/ and runtime/ and upload to R2 for dev/setup.py to download."""
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
    except ImportError:
        print("  [ERROR]   boto3 not installed. Run: pip install boto3")
        return False

    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )

    config = TransferConfig(
        multipart_threshold=100 * 1024 * 1024,
        max_concurrency=4,
        multipart_chunksize=100 * 1024 * 1024,
        use_threads=True,
    )

    assets = [
        ("models", REPO_ROOT / "models", "halt-dev-assets/models.zip"),
        ("runtime", REPO_ROOT / "runtime", "halt-dev-assets/runtime-windows.zip"),
    ]

    for name, source_dir, r2_key in assets:
        if not source_dir.exists():
            print(f"  [SKIP]    {name}/ not found, skipping")
            continue

        zip_path = REPO_ROOT / f"{name}.zip"
        print(f"  [ZIP]     Creating {name}.zip (ZIP64)...")

        # Count and zip
        all_files = []
        for root, dirs, files in os.walk(source_dir):
            for f in files:
                all_files.append(os.path.join(root, f))

        total = len(all_files)
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for i, filepath in enumerate(all_files, 1):
                arcname = os.path.relpath(filepath, str(source_dir))
                zf.write(filepath, arcname)
                if i % 500 == 0 or i == total:
                    sys.stdout.write(f"\r            {(i/total)*100:.0f}% ({i}/{total} files)")
                    sys.stdout.flush()
        print()

        file_size = os.path.getsize(str(zip_path))
        print(f"  [UPLOAD]  {r2_key} ({file_size / (1024**3):.2f} GB)...")

        class Progress:
            def __init__(self, total):
                self._total = float(total)
                self._seen = 0
                self._lock = threading.Lock()

            def __call__(self, bytes_amount):
                with self._lock:
                    self._seen += bytes_amount
                    pct = (self._seen / self._total) * 100
                    mb = self._seen / (1024**2)
                    total_mb = self._total / (1024**2)
                    sys.stdout.write(f"\r            {pct:.0f}% ({mb:.0f} / {total_mb:.0f} MB)")
                    sys.stdout.flush()

        try:
            s3.upload_file(str(zip_path), R2_BUCKET, r2_key, Config=config, Callback=Progress(file_size))
            print()
            print(f"  [OK]      {name} uploaded")
        except Exception as e:
            print(f"\n  [ERROR]   Upload failed: {e}")
            return False
        finally:
            zip_path.unlink(missing_ok=True)

    print()
    print("  [OK]      Dev assets uploaded. Devs can now run: python dev/setup.py")
    return True


def git_release(version):
    """Commit all changes, tag with version, and push to origin."""
    print(f"  [GIT]     Committing and tagging v{version}...")

    def run_git(*cmd):
        result = subprocess.run(
            ["git"] + list(cmd),
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  [ERROR]   git {' '.join(cmd)} failed:")
            print(f"            {result.stderr.strip()}")
            return False
        return True

    # Stage all changes
    if not run_git("add", "-A"):
        return False
    print("            Staged all changes")

    # Check if there's anything to commit
    status = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO_ROOT), capture_output=True, text=True)
    if not status.stdout.strip():
        print("  [SKIP]    Nothing to commit — working tree clean")
    else:
        if not run_git("commit", "-m", f"release: v{version}"):
            return False
        print(f"            Committed: release: v{version}")

    # Tag (delete existing tag first if needed)
    tag = f"v{version}"
    subprocess.run(
        ["git", "tag", "-d", tag], cwd=str(REPO_ROOT), capture_output=True, text=True
    )  # ignore errors — tag may not exist
    if not run_git("tag", "-a", tag, "-m", f"Release {tag}"):
        return False
    print(f"            Tagged: {tag}")

    # Push commit + tags
    if not run_git("push", "origin", "main"):
        return False
    print("            Pushed to origin/main")

    if not run_git("push", "origin", tag):
        return False
    print(f"            Pushed tag {tag}")

    print("  [OK]      Git release complete")
    return True


def github_release(version):
    """Create a GitHub Release from the tag using gh CLI."""
    tag = f"v{version}"
    is_prerelease = any(x in version for x in ["-alpha", "-beta", "-rc"])

    # Extract release notes from CHANGELOG.md
    notes = ""
    changelog = REPO_ROOT / "CHANGELOG.md"
    if changelog.exists():
        lines = changelog.read_text(encoding="utf-8").splitlines()
        capture = False
        for line in lines:
            if line.startswith(f"## [{version}]"):
                capture = True
                continue
            elif capture and line.startswith("## ["):
                break
            elif capture and line.strip() == "---":
                break
            elif capture:
                notes += line + "\n"
        notes = notes.strip()

    if not notes:
        notes = f"Release {tag}"

    print(f"  [GITHUB]  Creating release {tag}...")

    cmd = [
        "gh",
        "release",
        "create",
        tag,
        "--title",
        f"HALT {tag}",
        "--notes",
        notes,
        "--repo",
        "Hermetic-Labs/halt",
    ]
    if is_prerelease:
        cmd.append("--prerelease")

    result = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)

    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "gh" in stderr.lower() and "not found" in stderr.lower() or "not recognized" in stderr.lower():
            print("  [SKIP]    gh CLI not installed — create release manually at:")
            print(f"            https://github.com/Hermetic-Labs/halt/releases/new?tag={tag}")
            return True  # non-fatal
        print(f"  [WARN]    GitHub release failed: {stderr}")
        print(f"            Create manually: https://github.com/Hermetic-Labs/halt/releases/new?tag={tag}")
        return True  # non-fatal — git + R2 already succeeded

    print(f"            {result.stdout.strip()}")
    print("  [OK]      GitHub Release created")
    return True


# ── MSIX Packaging (Microsoft Store) ─────────────────────────────────────

MAKEAPPX_PATHS = [
    Path(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe"),
    Path(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\makeappx.exe"),
    Path(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22000.0\x64\makeappx.exe"),
    Path(r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\makeappx.exe"),
]

MSIX_MANIFEST_TEMPLATE = REPO_ROOT / "viewer" / "src-tauri" / "msix" / "AppxManifest.xml"


def find_makeappx():
    """Locate makeappx.exe from the Windows SDK."""
    # Check PATH first
    result = subprocess.run(
        ["where.exe", "makeappx.exe"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        return Path(result.stdout.strip().splitlines()[0])

    # Check known SDK locations
    for p in MAKEAPPX_PATHS:
        if p.exists():
            return p

    # Glob search as last resort
    sdk_root = Path(r"C:\Program Files (x86)\Windows Kits\10\bin")
    if sdk_root.exists():
        hits = sorted(sdk_root.glob("*/x64/makeappx.exe"), reverse=True)
        if hits:
            return hits[0]

    return None


def build_msix(version):
    """Package the Tauri build output into a Store-ready .msix file.

    Flow:
      1. Locate the compiled HALT.exe from the Cargo target dir
      2. Stage all app files + icons into an MSIX layout directory
      3. Inject a version-stamped AppxManifest.xml
      4. Run makeappx.exe pack to produce the .msix
    """
    print("  [MSIX]    Packaging for Microsoft Store...")

    # ── Locate tools ──────────────────────────────────────────────────────
    makeappx = find_makeappx()
    if not makeappx:
        print("  [ERROR]   makeappx.exe not found.")
        print("            Install the Windows 10/11 SDK:")
        print("            https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/")
        return None
    print(f"            SDK: {makeappx}")

    # ── Locate the built Tauri executable ─────────────────────────────────
    c_drive_target = Path(os.path.expanduser("~/Halt-Tauri-Target"))
    default_target = REPO_ROOT / "viewer" / "src-tauri" / "target"
    
    tauri_exe = None
    for target_dir in [c_drive_target, default_target]:
        candidate = target_dir / "release" / "HALT.exe"
        if candidate.exists():
            tauri_exe = candidate
            break
        candidate = target_dir / "release" / "halt-triage.exe"
        if candidate.exists():
            tauri_exe = candidate
            break
        # Also check for any .exe in the release dir that might be our binary
        candidates = list((target_dir / "release").glob("halt*.exe"))
        if candidates:
            tauri_exe = candidates[0]
            break

    if tauri_exe is None or not tauri_exe.exists():
        print(f"  [ERROR]   HALT.exe not found in {c_drive_target} or {default_target}")
        print("            Run a Tauri build first: python build_and_deploy.py --no-bump")
        return None
    print(f"            EXE: {tauri_exe} ({tauri_exe.stat().st_size / (1024**2):.1f} MB)")
    release_dir = tauri_exe.parent

    # ── Prepare MSIX staging directory ────────────────────────────────────
    msix_stage = BUILDS_DIR / "msix-stage"
    if msix_stage.exists():
        shutil.rmtree(msix_stage)
    msix_stage.mkdir(parents=True)

    # Copy the main executable (always stage as HALT.exe to match AppxManifest)
    print("            Staging HALT.exe...")
    shutil.copy2(tauri_exe, msix_stage / "HALT.exe")

    # Copy WebView2Loader if present (Tauri dependency)
    wv2_loader = release_dir / "WebView2Loader.dll"
    if wv2_loader.exists():
        shutil.copy2(wv2_loader, msix_stage / "WebView2Loader.dll")

    # Copy any additional DLLs from the release dir
    for dll in release_dir.glob("*.dll"):
        dest = msix_stage / dll.name
        if not dest.exists():
            shutil.copy2(dll, dest)

    # Copy bundled resources (api, patients, start.py)
    # NOTE: models/ intentionally excluded — multi-GB GGUF files exceed Store size
    #        limits and cause packaging to hang. Models are sideloaded post-install.
    resources = [
        (REPO_ROOT / "api", msix_stage / "api"),
        (REPO_ROOT / "patients", msix_stage / "patients"),
    ]
    ignore_patterns = shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo")
    for src, dst in resources:
        if src.exists():
            print(f"            Staging {src.name}/...")
            shutil.copytree(src, dst, dirs_exist_ok=True, ignore=ignore_patterns)

    # Copy start.py
    start_py = REPO_ROOT / "start.py"
    if start_py.exists():
        shutil.copy2(start_py, msix_stage / "start.py")

    # Copy the frontend dist (Tauri embeds this, but include for sidecar access)
    viewer_dist = REPO_ROOT / "viewer" / "dist"
    if viewer_dist.exists():
        print("            Staging viewer/dist/...")
        shutil.copytree(viewer_dist, msix_stage / "viewer" / "dist", dirs_exist_ok=True)

    # ── Stage icon assets ─────────────────────────────────────────────────
    assets_dir = msix_stage / "Assets"
    assets_dir.mkdir()
    icons_src = REPO_ROOT / "viewer" / "src-tauri" / "icons"

    icon_map = [
        "StoreLogo.png",
        "Square44x44Logo.png",
        "Square71x71Logo.png",
        "Square150x150Logo.png",
        "Square310x310Logo.png",
    ]
    for icon in icon_map:
        src = icons_src / icon
        if src.exists():
            shutil.copy2(src, assets_dir / icon)
        else:
            print(f"            [WARN] Missing icon: {icon}")

    # ── Inject version-stamped AppxManifest.xml ───────────────────────────
    if not MSIX_MANIFEST_TEMPLATE.exists():
        print(f"  [ERROR]   Manifest template not found: {MSIX_MANIFEST_TEMPLATE}")
        return None

    # MSIX requires 4-part version (Major.Minor.Patch.Revision)
    parts = version.split("-")[0].split(".")
    while len(parts) < 4:
        parts.append("0")
    msix_version = ".".join(parts[:4])

    manifest_content = MSIX_MANIFEST_TEMPLATE.read_text(encoding="utf-8")
    manifest_content = manifest_content.replace("{{VERSION}}", msix_version)
    (msix_stage / "AppxManifest.xml").write_text(manifest_content, encoding="utf-8")
    print(f"            Manifest version: {msix_version}")

    # ── Clean up __pycache__ and .pyc ─────────────────────────────────────
    for p in msix_stage.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)
    for p in msix_stage.rglob("*.pyc"):
        p.unlink(missing_ok=True)

    # ── Count staged files ────────────────────────────────────────────────
    file_count = sum(1 for _ in msix_stage.rglob("*") if _.is_file())
    stage_size = sum(f.stat().st_size for f in msix_stage.rglob("*") if f.is_file())
    print(f"            Staged: {file_count} files ({stage_size / (1024**2):.0f} MB)")

    # ── Run makeappx.exe pack ─────────────────────────────────────────────
    BUILDS_DIR.mkdir(exist_ok=True)
    msix_output = BUILDS_DIR / f"HALT-v{version}.msix"

    print(f"  [PACK]    Running makeappx.exe...")
    result = subprocess.run(
        [
            str(makeappx),
            "pack",
            "/d", str(msix_stage),
            "/p", str(msix_output),
            "/o",  # overwrite existing
            "/l",  # log output
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"  [ERROR]   makeappx.exe failed (exit {result.returncode})")
        print(f"            {result.stderr.strip()}")
        if result.stdout.strip():
            print(f"            {result.stdout.strip()[:500]}")
        return None

    msix_size = msix_output.stat().st_size
    print(f"  [OK]      {msix_output.name} ({msix_size / (1024**2):.1f} MB)")
    print(f"            Path: {msix_output}")
    print()
    print("            ┌─────────────────────────────────────────┐")
    print("            │  Upload this file to Partner Center:    │")
    print("            │  Submission 1 → Packages → drag & drop  │")
    print("            └─────────────────────────────────────────┘")

    return str(msix_output)


def main():
    parser = argparse.ArgumentParser(description="HALT Build & Deploy Pipeline")
    parser.add_argument(
        "--platform", choices=["win", "mac"], default="win", help="Target platform: win (default) or mac"
    )
    parser.add_argument(
        "--bump", choices=["patch", "minor", "major"], default="patch", help="Version bump level (default: patch)"
    )
    parser.add_argument("--no-bump", action="store_true", help="Skip version bump")
    parser.add_argument("--deploy", action="store_true", help="Upload to Cloudflare R2 after building")
    parser.add_argument(
        "--release", action="store_true", help="Full release: build → zip → git commit+tag+push → R2 upload"
    )
    parser.add_argument("--zip-only", action="store_true", help="Skip build, just zip existing build folder")
    parser.add_argument("--upload-assets", action="store_true", help="Zip and upload models/ + runtime/ to R2")
    parser.add_argument(
        "--dev", action="store_true", help="Dev mode: portable folder only, skip NSIS installer (faster)"
    )
    parser.add_argument(
        "--msix", action="store_true", help="Build MSIX package for Microsoft Store submission"
    )
    args = parser.parse_args()

    # --dev produces a portable folder only (no installer) — block accidental releases
    if args.dev and (args.deploy or args.release):
        print("  [ERROR]   --dev cannot be combined with --deploy or --release.")
        print("            --dev builds are for local testing only (no NSIS installer).")
        print("            Remove --dev for production builds.")
        sys.exit(1)

    # --release implies --deploy
    if args.release:
        args.deploy = True

    banner()

    # ── Upload dev assets (standalone mode) ───────────────────────────────
    if args.upload_assets:
        success = upload_dev_assets()
        sys.exit(0 if success else 1)

    # ── Version ───────────────────────────────────────────────────────────
    if args.no_bump:
        version = read_version()
        print(f"  [VERSION] {version} (no bump)")
    else:
        version = bump_version(args.bump)

    # ── Build ─────────────────────────────────────────────────────────────
    if args.platform == "mac":
        # macOS path: standalone Python + raw ZIP (no Electron)
        platform_name = f"macOS-{detect_mac_arch()}"

        if args.zip_only:
            candidates = list(BUILDS_DIR.glob(f"HALT-v{version}-macOS-*"))
            if not candidates:
                print("  [ERROR]   No macOS build folder found in builds/")
                sys.exit(1)
            source_dir = candidates[0]
            print(f"  [SKIP]    Using existing build: {source_dir}")
        else:
            build_macos_runtime(version)
            source_dir = stage_macos(version)

            # ── macOS Developer ID signing + notarization ─────────────────────
            # Requires: CSC_LINK (base64 .p12), CSC_KEY_PASSWORD, APPLE_TEAM_ID
            # Optional: APPLE_ID + APPLE_ID_PASSWORD for notarization (recommended)
            # Only runs on macOS — codesign is a Mac-only tool.
            if sys.platform == "darwin":
                _mac_sign_vars = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_TEAM_ID"]
                _mac_sign_env = {k: os.environ[k] for k in _mac_sign_vars if k in os.environ}

                if len(_mac_sign_env) == len(_mac_sign_vars):
                    import base64
                    import tempfile

                    print("  [SIGN]    macOS Developer ID signing credentials detected")

                    # Write .p12 to temp file
                    p12_bytes = base64.b64decode(_mac_sign_env["CSC_LINK"])
                    with tempfile.NamedTemporaryFile(suffix=".p12", delete=False) as f:
                        f.write(p12_bytes)
                        p12_tmp = f.name

                    team_id = _mac_sign_env["APPLE_TEAM_ID"]
                    p12_pass = _mac_sign_env["CSC_KEY_PASSWORD"]
                    sign_id = f"Developer ID Application: Hermetic Labs LLC ({team_id})"

                    # Import cert into temp keychain
                    kc_tmp = tempfile.mktemp(suffix=".keychain-db")
                    subprocess.run(["security", "create-keychain", "-p", "halt-build", kc_tmp], check=True)
                    subprocess.run(["security", "unlock-keychain", "-p", "halt-build", kc_tmp], check=True)
                    subprocess.run(
                        [
                            "security",
                            "import",
                            p12_tmp,
                            "-k",
                            kc_tmp,
                            "-P",
                            p12_pass,
                            "-T",
                            "/usr/bin/codesign",
                        ],
                        check=True,
                    )
                    subprocess.run(
                        [
                            "security",
                            "set-key-partition-list",
                            "-S",
                            "apple-tool:,apple:",
                            "-s",
                            "-k",
                            "halt-build",
                            kc_tmp,
                        ],
                        check=True,
                    )

                    # Sign the bundle (deep — signs all nested binaries)
                    print("  [SIGN]    Signing bundle with codesign --deep...")
                    subprocess.run(
                        [
                            "codesign",
                            "--deep",
                            "--force",
                            "--verify",
                            "--verbose=1",
                            "--sign",
                            sign_id,
                            "--keychain",
                            kc_tmp,
                            "--options",
                            "runtime",
                            str(source_dir),
                        ],
                        check=True,
                    )
                    print("  [OK]      Bundle signed")

                    # Cleanup temp keychain + p12
                    subprocess.run(["security", "delete-keychain", kc_tmp])
                    os.unlink(p12_tmp)

                    # Notarize (optional — needs APPLE_ID + APPLE_ID_PASSWORD)
                    _notarize_vars = ["APPLE_ID", "APPLE_ID_PASSWORD"]
                    if all(v in os.environ for v in _notarize_vars):
                        print("  [NOTARIZE] Submitting to Apple notary service...")
                        zip_for_notary = str(source_dir) + "-notary.zip"
                        subprocess.run(
                            ["ditto", "-c", "-k", "--keepParent", str(source_dir), zip_for_notary], check=True
                        )
                        subprocess.run(
                            [
                                "xcrun",
                                "notarytool",
                                "submit",
                                zip_for_notary,
                                "--apple-id",
                                os.environ["APPLE_ID"],
                                "--password",
                                os.environ["APPLE_ID_PASSWORD"],
                                "--team-id",
                                team_id,
                                "--wait",
                            ],
                            check=True,
                        )
                        os.unlink(zip_for_notary)
                        print("  [OK]      Notarization complete")
                    else:
                        print("  [NOTARIZE] Skipping — set APPLE_ID + APPLE_ID_PASSWORD to notarize")
                else:
                    _missing = [k for k in _mac_sign_vars if k not in os.environ]
                    print(f"  [SIGN]    Skipping macOS signing — missing: {', '.join(_missing)}")
                    print("            Set CSC_LINK, CSC_KEY_PASSWORD, APPLE_TEAM_ID to enable")

    else:
        # Windows path: Electron build
        platform_name = "Windows"

        if args.zip_only:
            # Look for existing build output in the standard locations
            candidates = [
                ELECTRON_DIR / "dist" / "win-unpacked",  # electron-builder output
                BUILDS_DIR / f"HALT-v{version}-Windows",  # staged build folder
                REPO_ROOT / f"HALT-v{version}",  # legacy folder name
            ]
            source_dir = None
            for c in candidates:
                if c.exists():
                    source_dir = c
                    break
            if source_dir is None:
                # Check if a ZIP already exists — skip zip, go straight to upload
                existing_zip = BUILDS_DIR / f"HALT-v{version}-{platform_name}.zip"
                if existing_zip.exists() and args.deploy:
                    print(f"  [SKIP]    ZIP already exists: {existing_zip}")
                    print("            Re-uploading with fresh headers...")
                    zip_path = existing_zip
                    # Jump directly to deploy
                    success = upload_to_r2(zip_path, version, platform_name)
                    if success:
                        print()
                        print("  ╔═══════════════════════════════════════╗")
                        print(f"  ║   HALT v{version:<28s}║")
                        print("  ║   re-uploaded to R2                   ║")
                        print("  ╚═══════════════════════════════════════╝")
                    sys.exit(0 if success else 1)
                if not args.msix:
                    print(f"  [ERROR]   No build folder found. Tried: {[str(c) for c in candidates]}")
                    sys.exit(1)
                else:
                    print(f"  [WARN]    No build folder found for zip, but proceeding to MSIX packaging.")
            else:
                print(f"  [SKIP]    Using existing build: {source_dir}")
        else:
            source_dir = build_tauri(version)
            if source_dir is None:
                print("\n  Build failed. Use --zip-only to package existing build.")
                # Don't exit if --msix was requested — the EXE may still exist
                if not args.msix:
                    sys.exit(1)

    # ── Zip ───────────────────────────────────────────────────────────────
    if source_dir is not None:
        zip_path = zip_distribution(source_dir, version, platform_name)
    else:
        zip_path = None

    # ── Git Release ───────────────────────────────────────────────────────
    if args.release:
        print()
        if not git_release(version):
            print("  [ABORT]   Git release failed — skipping R2 upload")
            sys.exit(1)

    # ── Deploy ────────────────────────────────────────────────────────────
    if args.deploy:
        print()
        success = upload_to_r2(zip_path, version, platform_name)
        if not success:
            sys.exit(1)

    # ── GitHub Release ────────────────────────────────────────────────────
    if args.release:
        print()
        github_release(version)

    # ── MSIX Packaging (Microsoft Store) ───────────────────────────────
    if args.msix and args.platform == "win":
        print()
        msix_path = build_msix(version)
        if msix_path is None:
            print("  [ERROR]   MSIX packaging failed")
            sys.exit(1)

    if not args.deploy and not args.release:
        print()
        print()
        print("  [INFO]    To deploy, re-run with --deploy")
        print(f"            python {Path(__file__).name} --zip-only --no-bump --deploy")

    # ── Done ──────────────────────────────────────────────────────────────
    steps = []
    if not args.zip_only:
        steps.append("built")
    steps.append("zipped")
    if args.release:
        steps.append("tagged")
        steps.append("pushed")
    if args.deploy:
        steps.append("deployed")
    if args.release:
        steps.append("released")

    print()
    print("  ╔═══════════════════════════════════════╗")
    print(f"  ║   HALT v{version}" + " " * (30 - len(version)) + "║")
    print(f"  ║   {' → '.join(steps)}" + " " * max(1, 36 - len(" → ".join(steps))) + "║")
    print("  ╚═══════════════════════════════════════╝")
    print()


if __name__ == "__main__":
    main()
