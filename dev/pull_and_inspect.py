"""
pull_and_inspect.py — Live R2 Build Inspection
------------------------------------------------
Downloads HALT-latest-Windows.zip directly from the public Cloudflare R2
URL, extracts it to __fresh_test__/, and validates it using the same
checks as test_packaging.py.

Use this to verify what end users actually receive from the live download.
Run test_packaging.py to verify a local build before deploying.

Usage:
    python dev/pull_and_inspect.py                # inspect latest
    python dev/pull_and_inspect.py --version 1.0.3-alpha  # inspect specific version
"""
import sys
import os
import time
import shutil
import zipfile
import hashlib
import argparse
import urllib.request
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
FRESH_TEST_DIR = REPO_ROOT / "__fresh_test__"

R2_BASE = "https://pub-b841d8ac01084f8f822078f923a49a87.r2.dev"
LATEST_URL = f"{R2_BASE}/HALT-latest-Windows.zip"

# Key files that must exist in a valid build
CHECKS = [
    ("Electron exe", "HALT - Medical Triage.exe"),
    ("main.js", "main.js"),
    ("start.py", "start.py"),
    ("Python runtime", "python.exe"),
    ("viewer index", "index.html"),
    ("MANIFEST", "MANIFEST.sha256"),
    ("Splash logo", "logo.png"),  # Electron splash screen logo
]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _progress_bar(downloaded: int, total: int, width: int = 40) -> str:
    """Return a simple ASCII progress bar string."""
    if total <= 0:
        return f"  {downloaded / (1024 ** 2):>8.1f} MB downloaded"
    pct = downloaded / total
    filled = int(width * pct)
    bar = "█" * filled + "░" * (width - filled)
    mb_done = downloaded / (1024**2)
    mb_total = total / (1024**2)
    return f"  [{bar}] {pct * 100:>5.1f}%  {mb_done:>7.1f} / {mb_total:.1f} MB"


def _make_hook(total_size: int):
    """Return a urllib reporthook closure that prints a live progress bar."""
    start = time.time()
    last_print = [0.0]

    def hook(block_num: int, block_size: int, _total: int) -> None:
        downloaded = block_num * block_size
        now = time.time()
        if now - last_print[0] >= 0.25 or downloaded >= total_size:
            bar = _progress_bar(downloaded, total_size)
            print(f"\r{bar}", end="", flush=True)
            last_print[0] = now
        if downloaded >= total_size > 0:
            elapsed = now - start
            print(
                f"\n            {total_size / (1024 ** 2):.1f} MB in {elapsed:.1f}s "
                f"({total_size / (1024 ** 2) / elapsed:.1f} MB/s)"
            )

    return hook


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_remote_size(url: str) -> int:
    """Return Content-Length from a HEAD request, or 0 if unavailable."""
    req = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return int(resp.headers.get("Content-Length", 0))
    except Exception:
        return 0


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull the live R2 build and inspect it.")
    parser.add_argument(
        "--version",
        default=None,
        metavar="VER",
        help="Download a specific version, e.g. 1.0.3-alpha " "(default: HALT-latest-Windows.zip)",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the extracted files after inspection (skip cleanup prompt).",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip MANIFEST SHA-256 integrity verification.",
    )
    args = parser.parse_args()

    if args.version:
        url = f"{R2_BASE}/HALT-v{args.version}-Windows.zip"
        zip_name = f"HALT-v{args.version}-Windows.zip"
    else:
        url = LATEST_URL
        zip_name = "HALT-latest-Windows.zip"

    print("\n  ╔═══════════════════════════════════════╗")
    print("  ║   HALT — Live R2 Build Inspection     ║")
    print("  ╚═══════════════════════════════════════╝\n")
    print(f"  [SOURCE]  {url}")
    print(f"  [TARGET]  {FRESH_TEST_DIR}\n")

    FRESH_TEST_DIR.mkdir(exist_ok=True)
    zip_path = FRESH_TEST_DIR / zip_name

    # ── Download ──────────────────────────────────────────────────────────────
    print("  [FETCH]   Checking remote size...")
    total_size = _get_remote_size(url)
    if total_size:
        print(f"            Remote size: {total_size / (1024 ** 2):.1f} MB")
    else:
        print("            Remote size: unknown (server did not report Content-Length)")

    if zip_path.exists():
        local_size = zip_path.stat().st_size
        if total_size and local_size == total_size:
            print(f"  [SKIP]    Zip already downloaded ({local_size / (1024 ** 2):.1f} MB)")
        else:
            print(
                f"  [FETCH]   Re-downloading (local={local_size / (1024 ** 2):.1f} MB "
                f"remote={total_size / (1024 ** 2):.1f} MB)..."
            )
            zip_path.unlink()
    else:
        print("  [FETCH]   Downloading...")

    if not zip_path.exists():
        t0 = time.time()
        opener = urllib.request.build_opener()
        opener.addheaders = [("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")]
        urllib.request.install_opener(opener)
        try:
            urllib.request.urlretrieve(url, str(zip_path), _make_hook(total_size))
        except Exception as exc:
            print(f"\n  [ERROR]   Download failed: {exc}")
            if "403" in str(exc):
                print("            Cloudflare returned 403. Check:")
                print("            1. R2 bucket Public Access is Enabled (Cloudflare dashboard)")
                print(f"            2. Object exists: {url.split('/')[-1]}")
            sys.exit(1)
        dl_time = time.time() - t0
        dl_mb = zip_path.stat().st_size / (1024**2)
        print(f"  [OK]      Downloaded in {dl_time:.1f}s  ({dl_mb:.1f} MB)\n")

    # ── Extract ───────────────────────────────────────────────────────────────
    extract_dir = FRESH_TEST_DIR / "win-unpacked"
    if extract_dir.exists():
        print("  [CLEAN]   Removing previous extraction...")
        shutil.rmtree(extract_dir)

    extract_dir.mkdir(parents=True, exist_ok=True)
    print(f"  [UNZIP]   Extracting to {extract_dir}...")
    t0 = time.time()
    with zipfile.ZipFile(str(zip_path), "r") as zf:
        members = zf.infolist()
        total_members = len(members)
        for i, member in enumerate(members, 1):
            zf.extract(member, str(extract_dir))
            if i % 500 == 0 or i == total_members:
                pct = i / total_members * 100
                print(f"\r  [UNZIP]   {i:>6,} / {total_members:,} files  ({pct:.0f}%)", end="", flush=True)
    unzip_time = time.time() - t0
    unzip_files = sum(1 for _, _, fs in os.walk(extract_dir) for f in fs)
    print(f"\r  [OK]      {unzip_files:,} files extracted in {unzip_time:.1f}s\n")

    # ── Validate key files ────────────────────────────────────────────────────
    print("  [CHECK]   Validating key files...")
    contents = list(extract_dir.iterdir())
    root = contents[0] if len(contents) == 1 and contents[0].is_dir() else extract_dir

    all_ok = True
    for label, filename in CHECKS:
        found = list(root.rglob(filename))
        if found:
            rel = str(found[0].relative_to(extract_dir))
            size_kb = found[0].stat().st_size / 1024
            print(f"            ✓  {label:<18} {rel}  ({size_kb:,.0f} KB)")
        else:
            print(f"            ✗  {label:<18} NOT FOUND")
            all_ok = False

    # ── Models ────────────────────────────────────────────────────────────────
    model_files = list(root.rglob("*.gguf")) + list(root.rglob("*.onnx"))
    if model_files:
        model_mb = sum(f.stat().st_size for f in model_files) / (1024**2)
        print(f"            ✓  {'Models':<18} {len(model_files)} files  ({model_mb:.0f} MB)")
    else:
        print(f"            ⚠  {'Models':<18} none bundled (will auto-download on first launch)")

    # ── Authenticode / SmartScreen check ──────────────────────────────────────
    print()
    print("  [SIGN]    Checking Authenticode signature (SmartScreen gate)...")
    exe_files = list(root.rglob("HALT - Medical Triage.exe"))
    if exe_files and sys.platform == "win32":
        import subprocess

        ps_cmd = (
            f"$s = Get-AuthenticodeSignature '{exe_files[0]}';"
            "$s.Status.ToString() + '|' + $s.SignerCertificate.Subject"
        )
        result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
        parts = result.stdout.strip().split("|", 1)
        sig_status = parts[0].strip()
        sig_subject = parts[1].strip() if len(parts) > 1 else ""

        if sig_status == "Valid":
            print(f"            ✓  Signed           {sig_subject}")
            print("               SmartScreen: no warning on fresh install")
        elif sig_status == "NotSigned":
            print("            ✗  NOT SIGNED")
            print("               SmartScreen: 'Windows protected your PC' on every install")
            print("               Fix: Sign with Azure Trusted Signing (~$9.99/mo)")
            print("               electron-builder CSC_LINK / @electron/windows-sign")
            all_ok = False
        else:
            print(f"            ⚠  Status: {sig_status}")
            if sig_subject:
                print(f"               Subject: {sig_subject}")
    elif exe_files:
        print("            ⚠  Skipped (not running on Windows — use signtool on target OS)")
    else:
        print("            ✗  Exe not found — cannot check signature")
        all_ok = False

    # ── MANIFEST integrity check ───────────────────────────────────────────────
    if not args.no_verify:
        print()
        print("  [VERIFY]  Checking MANIFEST SHA-256 integrity...")
        manifest_files = list(root.rglob("MANIFEST.sha256"))
        if manifest_files:
            manifest_path = manifest_files[0]
            manifest_root = manifest_path.parent
            lines = manifest_path.read_text(encoding="utf-8").splitlines()
            verified = 0
            failed = 0
            for line in lines:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split(None, 1)
                if len(parts) != 2:
                    continue
                expected_hash, rel_path = parts[0], parts[1].strip()
                target = manifest_root / rel_path
                if not target.exists():
                    print(f"            ✗  MISSING: {rel_path}")
                    failed += 1
                    continue
                actual_hash = _sha256(target)
                if actual_hash == expected_hash:
                    verified += 1
                else:
                    print(f"            ✗  CORRUPT: {rel_path}")
                    failed += 1
            if failed == 0:
                print(f"            ✓  {verified} core file(s) passed integrity check")
            else:
                print(f"            ✗  {failed} file(s) failed — build may be corrupt")
                all_ok = False
        else:
            print("            ⚠  No MANIFEST.sha256 found — skipping integrity check")

    # ── Summary ───────────────────────────────────────────────────────────────
    zip_mb = zip_path.stat().st_size / (1024**2)
    result_label = "ALL PASS ✓" if all_ok else "ISSUES   ✗"

    print("  ╔═══════════════════════════════════════╗")
    print("  ║   Live Inspection Results             ║")
    print("  ╠═══════════════════════════════════════╣")
    print(f"  ║   Source:  {url.split('/')[-1]:<27} ║")
    print(f"  ║   Zip:     {zip_mb:>6.1f} MB                      ║")
    print(f"  ║   Files:   {unzip_files:>6,}                        ║")
    print(f"  ║   Result:  {result_label:<27} ║")
    print("  ╚═══════════════════════════════════════╝\n")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    if args.keep:
        print(f"  [KEEP]    Files retained at: {extract_dir}\n")
        return

    answer = input("  [?]       Delete extracted files? (y/n): ").strip().lower()
    if answer in ("y", "yes", ""):
        shutil.rmtree(extract_dir, ignore_errors=True)
        print(f"  [CLEAN]   Removed {extract_dir}")
        print("  [DONE]    Cleaned up.\n")
    else:
        print(f"  [KEEP]    Files retained at: {extract_dir}\n")


if __name__ == "__main__":
    main()
