"""
HALT Build & Deploy Pipeline
=============================
Builds the Electron app, bumps version, zips it, and uploads to Cloudflare R2.

Usage:
  python build_and_deploy.py                 # Build only
  python build_and_deploy.py --deploy        # Build + upload to R2
  python build_and_deploy.py --bump minor    # Bump minor version before build
  python build_and_deploy.py --bump major    # Bump major version before build
  python build_and_deploy.py --zip-only      # Just zip existing build folder and deploy
"""

import os
import sys
import json
import shutil
import subprocess
import argparse
import threading
import zipfile
from pathlib import Path

# ── Paths (all relative to repo root) ────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
ELECTRON_DIR = REPO_ROOT / "dev" / "electron-launcher"
PKG_JSON = ELECTRON_DIR / "package.json"
BUILDS_DIR = REPO_ROOT / "builds"

# ── R2 Configuration ─────────────────────────────────────────────────────────
R2_ACCOUNT_ID = "ad23f2f0adb042be51b65f0cfc214835"
R2_ACCESS_KEY = "e6b0de29a4383b45dc52478b7d158b51"
R2_SECRET_KEY = "e472c058cf6e47685e022767e1befdea5e9dbba507addbe2ff5e4eb2d3f0d1e5"
R2_BUCKET = "hermetic-labs-triage"
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


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


def zip_distribution(source_dir, version):
    """Zip the distribution into builds/ folder using ZIP64 for large archives."""
    BUILDS_DIR.mkdir(exist_ok=True)
    
    zip_name = f"HALT-v{version}-Windows.zip"
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


def upload_to_r2(zip_path, version):
    """Upload the zip to Cloudflare R2 using multipart upload."""
    try:
        import boto3
        from boto3.s3.transfer import TransferConfig
    except ImportError:
        print("  [ERROR]   boto3 not installed. Run: pip install boto3")
        return False
    
    object_name = f"HALT-v{version}-Windows.zip"
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
        latest_name = "HALT-latest-Windows.zip"
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


def main():
    parser = argparse.ArgumentParser(description="HALT Build & Deploy Pipeline")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch",
                        help="Version bump level (default: patch)")
    parser.add_argument("--no-bump", action="store_true",
                        help="Skip version bump")
    parser.add_argument("--deploy", action="store_true",
                        help="Upload to Cloudflare R2 after building")
    parser.add_argument("--release", action="store_true",
                        help="Full release: build → zip → git commit+tag+push → R2 upload")
    parser.add_argument("--zip-only", action="store_true",
                        help="Skip electron build, just zip existing build folder and optionally deploy")
    parser.add_argument("--upload-assets", action="store_true",
                        help="Zip and upload models/ + runtime/ to R2 for dev/setup.py")
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
    
    # ── Build or Zip-Only ─────────────────────────────────────────────────
    if args.zip_only:
        # Use existing built distribution — try versioned folder, then fallback
        candidates = [
            REPO_ROOT / f"HALT-v{version}",
            REPO_ROOT / "HALT-v1.0.01",  # legacy folder name
        ]
        existing = None
        for c in candidates:
            if c.exists():
                existing = c
                break
        if existing is None:
            print(f"  [ERROR]   No build folder found. Tried: {[str(c) for c in candidates]}")
            sys.exit(1)
        print(f"  [SKIP]    Using existing build: {existing}")
        source_dir = existing
    else:
        # Stage and build
        stage_dir = stage_app(version)
        source_dir = build_electron(version)
        if source_dir is None:
            print("\n  Build failed. Use --zip-only to package existing build.")
            sys.exit(1)
    
    # ── Zip ───────────────────────────────────────────────────────────────
    zip_path = zip_distribution(source_dir, version)
    
    # ── Git Release ───────────────────────────────────────────────────────
    if args.release:
        print()
        if not git_release(version):
            print("  [ABORT]   Git release failed — skipping R2 upload")
            sys.exit(1)
    
    # ── Deploy ────────────────────────────────────────────────────────────
    if args.deploy:
        print()
        success = upload_to_r2(zip_path, version)
        if not success:
            sys.exit(1)
    else:
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
    
    print()
    print("  ╔═══════════════════════════════════════╗")
    print(f"  ║   HALT v{version}" + " " * (30 - len(version)) + "║")
    print(f"  ║   {' → '.join(steps)}" + " " * max(1, 36 - len(' → '.join(steps))) + "║")
    print("  ╚═══════════════════════════════════════╝")
    print()


if __name__ == "__main__":
    main()

