"""
HALT Packaging Test Harness
----------------------------
Runs stage → electron build → zip → unzip → validate in a temp folder.
Tests the full packaging cycle without touching git or R2.

Usage:  python dev/test_packaging.py
"""
import sys
import os
import time
import shutil
import zipfile
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent
PKG_JSON = REPO_ROOT / "dev" / "electron-launcher" / "package.json"

# build_and_deploy must be imported after SCRIPT_DIR is on sys.path
sys.path.insert(0, str(SCRIPT_DIR))
import build_and_deploy as bd  # noqa: E402


def main():
    print("\n  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — Packaging Test Harness        ║")
    print("  ╚═══════════════════════════════════════╝\n")

    version = bd.read_version()
    print("  [INFO]    Version: " + version)
    print("  [INFO]    Testing in temp folder (auto-cleanup)\n")

    # ── Stage ────────────────────────────────────────────────────────────
    t0 = time.time()
    stage_dir = bd.stage_app(version)
    stage_time = time.time() - t0
    stage_files = sum(1 for _, _, fs in os.walk(stage_dir) for f in fs)
    stage_mb = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(stage_dir) for f in fs) / (1024**2)
    print(f"  [TIMING]  Stage: {stage_time:.1f}s ({stage_files:,} files, {stage_mb:.0f} MB)\n")

    # ── Electron Build ───────────────────────────────────────────────────
    t0 = time.time()
    build_dir = bd.build_electron(version)
    build_time = time.time() - t0
    if build_dir is None:
        print("  [FAIL]    Electron build failed!")
        sys.exit(1)
    build_files = sum(1 for _, _, fs in os.walk(build_dir) for f in fs)
    build_mb = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(build_dir) for f in fs) / (1024**2)
    print(f"  [TIMING]  Electron build: {build_time:.1f}s ({build_files:,} files, {build_mb:.0f} MB)\n")

    # ── Zip ──────────────────────────────────────────────────────────────
    t0 = time.time()
    zip_path = bd.zip_distribution(build_dir, version, "Windows")
    zip_time = time.time() - t0
    zip_size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"  [TIMING]  Zip: {zip_time:.1f}s ({zip_size_mb:.0f} MB)\n")

    # ── Unzip to Temp ────────────────────────────────────────────────────
    test_dir = Path(tempfile.mkdtemp(prefix="HALT_test_"))
    print(f"  [UNZIP]   Extracting to: {test_dir}")
    t0 = time.time()
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        zf.extractall(str(test_dir))
    unzip_time = time.time() - t0
    unzip_files = sum(1 for _, _, fs in os.walk(test_dir) for f in fs)
    print(f"  [TIMING]  Unzip: {unzip_time:.1f}s ({unzip_files:,} files)\n")

    # ── Validate ─────────────────────────────────────────────────────────
    print("  [CHECK]   Validating key files...")
    contents = list(test_dir.iterdir())
    root = contents[0] if len(contents) == 1 and contents[0].is_dir() else test_dir

    checks = [
        ("Electron exe", "HALT - Medical Triage.exe"),
        ("main.js", "main.js"),
        ("start.py", "start.py"),
        ("Python runtime", "python.exe"),
        ("viewer index", "index.html"),
        ("MANIFEST", "MANIFEST.sha256"),
    ]

    all_ok = True
    for name, filename in checks:
        found = list(root.rglob(filename))
        status = "✓" if found else "✗"
        if found:
            detail = str(found[0].relative_to(test_dir))
        else:
            detail = "NOT FOUND"
            all_ok = False
        print(f"            {status} {name}: {detail}")

    # Models check
    model_files = list(root.rglob("*.gguf")) + list(root.rglob("*.onnx"))
    if model_files:
        total_model_mb = sum(f.stat().st_size for f in model_files) / (1024**2)
        print(f"            ✓ Models: {len(model_files)} files ({total_model_mb:.0f} MB)")
    else:
        print("            ⚠ Models: none found (will auto-download on first launch)")

    # ── Summary ──────────────────────────────────────────────────────────
    print("  ╔═══════════════════════════════════════╗")
    print("  ║   Packaging Test Results                ║")
    print("  ╠═══════════════════════════════════════╣")
    print(f"  ║   Stage:  {stage_time:>6.1f}s  {stage_files:>6,} files  {stage_mb:>5.0f} MB ║")
    print(f"  ║   Build:  {build_time:>6.1f}s  {build_files:>6,} files  {build_mb:>5.0f} MB ║")
    print(f"  ║   Zip:    {zip_time:>6.1f}s             {zip_size_mb:>5.0f} MB ║")
    print(f"  ║   Unzip:  {unzip_time:>6.1f}s  {unzip_files:>6,} files         ║")
    print(f"  ║   Result: {'ALL PASS' if all_ok else 'ISSUES':>8}                     ║")
    print("  ╚═══════════════════════════════════════╝\n")

    # ── Cleanup ──────────────────────────────────────────────────────────
    answer = input("  [?]       Delete test folder? (y/n): ").strip().lower()
    if answer in ("y", "yes", ""):
        print(f"  [CLEAN]   Removing {test_dir}...")
        shutil.rmtree(test_dir, ignore_errors=True)
        print("  [DONE]    Cleaned up.\n")
    else:
        print(f"  [KEEP]    Test output at: {test_dir}\n")


if __name__ == "__main__":
    main()
