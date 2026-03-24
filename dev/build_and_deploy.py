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
    
    print(f"  [STAGE]   Preparing app bundle...")
    
    # Clean previous stage
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir()
    
    # Copy source directories into stage
    copies = [
        (REPO_ROOT / "api",      stage_dir / "api"),
        (REPO_ROOT / "electron",  stage_dir / "electron"),
        (REPO_ROOT / "viewer",    stage_dir / "viewer"),
        (REPO_ROOT / "triage",    stage_dir / "triage"),
        (REPO_ROOT / "models",    stage_dir / "models"),
        (REPO_ROOT / "runtime",   stage_dir / "runtime"),
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
    
    print(f"  [OK]      App staged")
    return stage_dir


def build_electron(version):
    """Run electron-builder to produce the Windows distribution."""
    print(f"  [BUILD]   Running electron-builder (Windows)...")
    
    # Ensure node_modules exist
    if not (ELECTRON_DIR / "node_modules").exists():
        print(f"            Installing npm dependencies...")
        subprocess.run(["npm", "install"], cwd=str(ELECTRON_DIR), check=True, shell=True)
    
    # Run the build
    result = subprocess.run(
        ["npm", "run", "build:win"],
        cwd=str(ELECTRON_DIR),
        shell=True,
    )
    
    if result.returncode != 0:
        print(f"  [ERROR]   electron-builder failed (exit {result.returncode})")
        return None
    
    # Find the win-unpacked output
    dist_dir = ELECTRON_DIR / "dist"
    win_unpacked = dist_dir / "win-unpacked"
    
    if win_unpacked.exists():
        print(f"  [OK]      Build complete: {win_unpacked}")
        return win_unpacked
    else:
        print(f"  [ERROR]   win-unpacked not found in {dist_dir}")
        return None


# ── macOS Build ──────────────────────────────────────────────────────────────

# Standalone Python URLs (python-build-standalone)
PYTHON_VERSION = "3.13.3"
PYTHON_RELEASE = "20250517"
PYTHON_URLS = {
    "arm64": f"https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE}/cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-aarch64-apple-darwin-install_only.tar.gz",
    "x64":   f"https://github.com/astral-sh/python-build-standalone/releases/download/{PYTHON_RELEASE}/cpython-{PYTHON_VERSION}+{PYTHON_RELEASE}-x86_64-apple-darwin-install_only.tar.gz",
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
        print(f"  [UNZIP]   Extracting...")

        runtime_dir.mkdir(exist_ok=True)
        subprocess.run(["tar", "-xzf", str(tarball), "-C", str(runtime_dir)], check=True)
        tarball.unlink()

        if not python_bin.exists():
            print(f"  [ERROR]   Python binary not found at {python_bin}")
            sys.exit(1)

        print(f"  [OK]      Python {PYTHON_VERSION} ready")

    # Step 2: Install deps
    print(f"  [PIP]     Installing dependencies...")
    subprocess.run([str(python_bin), "-m", "pip", "install", "--upgrade", "pip", "--quiet"], check=True)
    subprocess.run([str(python_bin), "-m", "pip", "install", "-r", str(REPO_ROOT / "requirements.txt"), "--quiet"], check=True)

    # GPU acceleration for llama-cpp-python (Metal on ARM, CPU-only on Intel)
    env = os.environ.copy()
    if arch == "arm64":
        print(f"  [GPU]     Installing llama-cpp-python with Metal acceleration...")
        env["CMAKE_ARGS"] = "-DGGML_METAL=on"
    else:
        print(f"  [CPU]     Installing llama-cpp-python (CPU-only, no Metal on Intel)...")
        env["CMAKE_ARGS"] = "-DGGML_METAL=off"
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "llama-cpp-python", "--quiet", "--force-reinstall", "--no-cache-dir"],
        env=env, check=True,
    )

    # Step 3: Verify critical imports
    print(f"  [CHECK]   Verifying critical packages...")
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

    print(f"  [STAGE]   Preparing macOS bundle...")

    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)

    copies = [
        (REPO_ROOT / "api",      stage_dir / "api"),
        (REPO_ROOT / "viewer",   stage_dir / "viewer"),
        (REPO_ROOT / "triage",   stage_dir / "triage"),
        (REPO_ROOT / "runtime",  stage_dir / "runtime"),
        (REPO_ROOT / "assets",   stage_dir / "assets"),
    ]

    for src, dst in copies:
        if src.exists():
            print(f"            copying {src.name}/...")
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            print(f"            [WARN] {src.name}/ not found")

    # Copy top-level files
    for f in ["start.py", "requirements.txt", "README.md", "LICENSE", "HALT.command"]:
        src = REPO_ROOT / f
        if src.exists():
            shutil.copy2(src, stage_dir / f)

    # Make launcher executable
    launcher = stage_dir / "HALT.command"
    if launcher.exists():
        os.chmod(str(launcher), 0o755)

    # Empty models dir (auto-downloads on first run)
    (stage_dir / "models").mkdir(exist_ok=True)

    # Clean up __pycache__ and raw source data
    for p in stage_dir.rglob("__pycache__"):
        shutil.rmtree(p, ignore_errors=True)
    for p in stage_dir.rglob("*.pyc"):
        p.unlink(missing_ok=True)
    icd_dir = stage_dir / "triage" / "_source" / "icd10cm-2025"
    if icd_dir.exists():
        shutil.rmtree(icd_dir, ignore_errors=True)
    icd_zip = stage_dir / "triage" / "_source" / "icd10cm-2025.zip"
    icd_zip.unlink(missing_ok=True)

    print(f"  [OK]      macOS bundle staged: {stage_dir}")
    return stage_dir


def zip_distribution(source_dir, version, platform_name="Windows"):
    """Zip the distribution into builds/ folder using ZIP64 for large archives."""
    BUILDS_DIR.mkdir(exist_ok=True)
    
    zip_name = f"HALT-v{version}-{platform_name}.zip"
    zip_path = BUILDS_DIR / zip_name
    
    print(f"  [ZIP]     Creating {zip_name} (ZIP64)...")
    print(f"            Source: {source_dir}")
    
    # Count files first for progress
    all_files = []
    for root, dirs, files in os.walk(source_dir):
        for f in files:
            all_files.append(os.path.join(root, f))
    
    total = len(all_files)
    print(f"            {total} files to compress...")
    
    with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for i, filepath in enumerate(all_files, 1):
            arcname = os.path.relpath(filepath, str(source_dir.parent))
            zf.write(filepath, arcname)
            if i % 500 == 0 or i == total:
                pct = (i / total) * 100
                sys.stdout.write(f"\r            {pct:.0f}% ({i}/{total} files)")
                sys.stdout.flush()
    
    print()
    size_gb = os.path.getsize(str(zip_path)) / (1024 ** 3)
    print(f"  [OK]      {zip_path} ({size_gb:.2f} GB, ZIP64)")
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
                mb_done = self._seen / (1024 ** 2)
                mb_total = self._total / (1024 ** 2)
                sys.stdout.write(f"\r            {pct:.1f}% ({mb_done:.0f} / {mb_total:.0f} MB)")
                sys.stdout.flush()
    
    try:
        s3.upload_file(
            zip_path,
            R2_BUCKET,
            object_name,
            Config=config,
            Callback=Progress(file_size),
        )
        print()
        print(f"  [OK]      Upload complete!")
        
        # Also upload as latest (direct upload, not copy — R2 copy hangs on large objects)
        latest_name = f"HALT-latest-{platform_name}.zip"
        print(f"  [UPLOAD]  Uploading as {latest_name}...")
        s3.upload_file(
            zip_path,
            R2_BUCKET,
            latest_name,
            Config=config,
            Callback=Progress(file_size),
        )
        print()
        print(f"  [OK]      Latest pointer updated")
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
        ("models",  REPO_ROOT / "models",  "halt-dev-assets/models.zip"),
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
        with zipfile.ZipFile(str(zip_path), 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
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
            s3.upload_file(str(zip_path), R2_BUCKET, r2_key,
                          Config=config, Callback=Progress(file_size))
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
    print(f"            Staged all changes")
    
    # Check if there's anything to commit
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=str(REPO_ROOT), capture_output=True, text=True
    )
    if not status.stdout.strip():
        print(f"  [SKIP]    Nothing to commit — working tree clean")
    else:
        if not run_git("commit", "-m", f"release: v{version}"):
            return False
        print(f"            Committed: release: v{version}")
    
    # Tag (delete existing tag first if needed)
    tag = f"v{version}"
    subprocess.run(
        ["git", "tag", "-d", tag],
        cwd=str(REPO_ROOT), capture_output=True, text=True
    )  # ignore errors — tag may not exist
    if not run_git("tag", "-a", tag, "-m", f"Release {tag}"):
        return False
    print(f"            Tagged: {tag}")
    
    # Push commit + tags
    if not run_git("push", "origin", "main"):
        return False
    print(f"            Pushed to origin/main")
    
    if not run_git("push", "origin", tag):
        return False
    print(f"            Pushed tag {tag}")
    
    print(f"  [OK]      Git release complete")
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
        "gh", "release", "create", tag,
        "--title", f"HALT {tag}",
        "--notes", notes,
        "--repo", "Hermetic-Labs/halt",
    ]
    if is_prerelease:
        cmd.append("--prerelease")
    
    result = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True)
    
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "gh" in stderr.lower() and "not found" in stderr.lower() or "not recognized" in stderr.lower():
            print(f"  [SKIP]    gh CLI not installed — create release manually at:")
            print(f"            https://github.com/Hermetic-Labs/halt/releases/new?tag={tag}")
            return True  # non-fatal
        print(f"  [WARN]    GitHub release failed: {stderr}")
        print(f"            Create manually: https://github.com/Hermetic-Labs/halt/releases/new?tag={tag}")
        return True  # non-fatal — git + R2 already succeeded
    
    print(f"            {result.stdout.strip()}")
    print(f"  [OK]      GitHub Release created")
    return True


def main():
    parser = argparse.ArgumentParser(description="HALT Build & Deploy Pipeline")
    parser.add_argument("--platform", choices=["win", "mac"], default="win",
                        help="Target platform: win (default) or mac")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch",
                        help="Version bump level (default: patch)")
    parser.add_argument("--no-bump", action="store_true",
                        help="Skip version bump")
    parser.add_argument("--deploy", action="store_true",
                        help="Upload to Cloudflare R2 after building")
    parser.add_argument("--release", action="store_true",
                        help="Full release: build → zip → git commit+tag+push → R2 upload")
    parser.add_argument("--zip-only", action="store_true",
                        help="Skip build, just zip existing build folder")
    parser.add_argument("--upload-assets", action="store_true",
                        help="Zip and upload models/ + runtime/ to R2")
    args = parser.parse_args()
    
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
                print(f"  [ERROR]   No macOS build folder found in builds/")
                sys.exit(1)
            source_dir = candidates[0]
            print(f"  [SKIP]    Using existing build: {source_dir}")
        else:
            build_macos_runtime(version)
            source_dir = stage_macos(version)
    else:
        # Windows path: Electron build
        platform_name = "Windows"

        if args.zip_only:
            candidates = [
                REPO_ROOT / f"HALT-v{version}",
                REPO_ROOT / "HALT-v1.0.01",  # legacy folder name
            ]
            source_dir = None
            for c in candidates:
                if c.exists():
                    source_dir = c
                    break
            if source_dir is None:
                print(f"  [ERROR]   No build folder found. Tried: {[str(c) for c in candidates]}")
                sys.exit(1)
            print(f"  [SKIP]    Using existing build: {source_dir}")
        else:
            stage_dir = stage_app(version)
            source_dir = build_electron(version)
            if source_dir is None:
                print("\n  Build failed. Use --zip-only to package existing build.")
                sys.exit(1)
    
    # ── Zip ───────────────────────────────────────────────────────────────
    zip_path = zip_distribution(source_dir, version, platform_name)
    
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
    
    if not args.deploy and not args.release:
        print()
        print()
        print(f"  [INFO]    To deploy, re-run with --deploy")
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
    print(f"  ║   {' → '.join(steps)}" + " " * max(1, 36 - len(' → '.join(steps))) + "║")
    print("  ╚═══════════════════════════════════════╝")
    print()


if __name__ == "__main__":
    main()

