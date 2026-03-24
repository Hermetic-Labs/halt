"""
HALT Dev Setup — Post-clone asset downloader
=============================================
Downloads AI models and portable Python runtime from Cloudflare R2.
This is a DEV-ONLY tool. The built app already bundles everything.

Usage:
  python dev/setup.py           # Download everything
  python dev/setup.py --models  # Models only (~2.8GB)
  python dev/setup.py --runtime # Runtime only (~500MB)
  python dev/setup.py --check   # Check what's installed
"""

import os
import sys
import shutil
import zipfile
import argparse
import threading
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
MODELS_DIR = REPO_ROOT / "models"
RUNTIME_DIR = REPO_ROOT / "runtime"

# ── R2 Configuration (same bucket as build_and_deploy.py) ────────────────────
R2_ACCOUNT_ID = "ad23f2f0adb042be51b65f0cfc214835"
R2_ACCESS_KEY = "e6b0de29a4383b45dc52478b7d158b51"
R2_SECRET_KEY = "e472c058cf6e47685e022767e1befdea5e9dbba507addbe2ff5e4eb2d3f0d1e5"
R2_BUCKET = "hermetic-labs-triage"
R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

ASSETS = {
    "models": {
        "r2_key": "halt-dev-assets/models.zip",
        "dest": MODELS_DIR,
        "size_hint": "~2.8 GB",
        "check_file": "medgemma-4b-it-q4_K_M.gguf",
    },
    "runtime": {
        "r2_key": "halt-dev-assets/runtime-windows.zip",
        "dest": RUNTIME_DIR,
        "size_hint": "~500 MB",
        "check_file": os.path.join("python", "python.exe"),
    },
}


def banner():
    print()
    print("  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — Dev Setup                    ║")
    print("  ╚═══════════════════════════════════════╝")
    print()
    print("  Downloads AI models and runtime for development.")
    print("  The built app already bundles everything — this is dev-only.")
    print()


def get_s3_client():
    try:
        import boto3
    except ImportError:
        print("  [ERROR]   boto3 not installed. Run: pip install boto3")
        sys.exit(1)

    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )


def check_asset(name):
    """Check if an asset is already installed."""
    info = ASSETS[name]
    check_path = info["dest"] / info["check_file"]
    return check_path.exists()


def download_asset(s3, name):
    """Download and extract an asset from R2."""
    info = ASSETS[name]

    if check_asset(name):
        print(f"  [SKIP]    {name}/ already installed")
        return True

    zip_path = REPO_ROOT / f"{name}.zip"
    print(f"  [GET]     Downloading {name} ({info['size_hint']})...")
    print(f"            From: {R2_BUCKET}/{info['r2_key']}")

    # Get file size for progress
    try:
        head = s3.head_object(Bucket=R2_BUCKET, Key=info["r2_key"])
        total_size = head["ContentLength"]
    except Exception as e:
        print(f"  [ERROR]   Asset not found on R2: {info['r2_key']}")
        print(f"            Upload assets first: python dev/build_and_deploy.py --upload-assets")
        return False

    # Download with progress
    seen = [0]
    lock = threading.Lock()

    def progress(bytes_amount):
        with lock:
            seen[0] += bytes_amount
            pct = (seen[0] / total_size) * 100
            mb = seen[0] / (1024 ** 2)
            total_mb = total_size / (1024 ** 2)
            sys.stdout.write(f"\r            {pct:.0f}% ({mb:.0f} / {total_mb:.0f} MB)")
            sys.stdout.flush()

    try:
        s3.download_file(R2_BUCKET, info["r2_key"], str(zip_path), Callback=progress)
        print()
    except Exception as e:
        print(f"\n  [ERROR]   Download failed: {e}")
        return False

    # Extract
    print(f"  [UNZIP]   Extracting to {name}/...")
    try:
        info["dest"].mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(zip_path), 'r') as zf:
            zf.extractall(str(info["dest"]))
        print(f"  [OK]      {name}/ ready")
    except Exception as e:
        print(f"  [ERROR]   Extraction failed: {e}")
        return False
    finally:
        if zip_path.exists():
            zip_path.unlink()

    return True


def check_all():
    """Report on what's installed."""
    print("  Status:")
    for name, info in ASSETS.items():
        installed = check_asset(name)
        status = "✓ installed" if installed else "✗ missing"
        print(f"    {name:12s} {status}")

        if installed:
            total_files = sum(1 for _ in info["dest"].rglob("*") if _.is_file())
            total_size = sum(f.stat().st_size for f in info["dest"].rglob("*") if f.is_file())
            print(f"                  {total_files} files, {total_size / (1024**3):.2f} GB")
    print()


def main():
    parser = argparse.ArgumentParser(description="HALT Dev Setup")
    parser.add_argument("--models", action="store_true", help="Download models only")
    parser.add_argument("--runtime", action="store_true", help="Download runtime only")
    parser.add_argument("--check", action="store_true", help="Check installation status")
    args = parser.parse_args()

    banner()

    if args.check:
        check_all()
        return

    s3 = get_s3_client()

    # Download what's needed
    download_models = args.models or (not args.models and not args.runtime)
    download_runtime = args.runtime or (not args.models and not args.runtime)

    success = True
    if download_models and not download_asset(s3, "models"):
        success = False
    if download_runtime and not download_asset(s3, "runtime"):
        success = False

    print()
    if success:
        check_all()
        print("  Ready to develop! Run start_on_Windows.bat or ./start_on_Mac.sh")
    else:
        print("  [WARN]    Some downloads failed. See errors above.")
        print("            Make sure assets are uploaded: python dev/build_and_deploy.py --upload-assets")

    print()


if __name__ == "__main__":
    main()
