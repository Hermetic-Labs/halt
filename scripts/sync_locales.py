#!/usr/bin/env python3
"""
sync_locales.py — Sync all locale files against en.json master.

For each locale file in viewer/public/locales/:
  1. Finds keys present in en.json but missing from the locale
  2. Also finds keys where the value == English (untranslated fallback)
  3. Batch-translates the values via the local NLLB API
  4. Merges translations into the locale file (never overwrites real translations)

Usage:
  python scripts/sync_locales.py                  # sync all locales
  python scripts/sync_locales.py --lang es he     # sync specific locales
  python scripts/sync_locales.py --dry-run        # show missing keys without writing
  python scripts/sync_locales.py --port 7778      # custom API port

Requires the HALT server running with the NLLB translation model loaded.
"""

import json
import sys
import argparse
import urllib.request
import urllib.error
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parent.parent / "viewer" / "public" / "locales"
API_BASE = "http://localhost:{port}"
BATCH_SIZE = 25  # How many texts per API call (keep small for NLLB memory)

# Keys that are intentionally the same in all languages (codes, abbreviations, etc.)
SKIP_RETRANSLATE = {
    "vitals.hr", "vitals.sbp", "vitals.rr", "vitals.spo2", "vitals.gcs",
    "unit.kg", "unit.c", "unit.f", "network.ssid", "network.emt",
}


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def translate_batch(texts: list[str], target: str, port: int) -> list[str] | None:
    """Call the local NLLB batch translate endpoint. Returns None on failure."""
    url = f"{API_BASE.format(port=port)}/api/translate/batch"
    payload = json.dumps({"texts": texts, "source": "en", "target": target}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("translations", None)
    except urllib.error.URLError as e:
        print(f"    ⚠ API error: {e}")
        return None


def sync_locale(lang: str, master: dict, port: int, dry_run: bool = False) -> int:
    """Sync a single locale file. Returns count of keys added/updated."""
    locale_path = LOCALES_DIR / f"{lang}.json"
    if not locale_path.exists():
        print(f"  ⚠ {lang}.json not found, skipping")
        return 0

    locale = load_json(locale_path)

    # Find missing keys
    missing_keys = [k for k in master if k not in locale]

    # Find untranslated keys (value matches English = fallback from a failed run)
    untranslated_keys = [
        k for k in master
        if k in locale
        and locale[k] == master[k]  # still English
        and k not in SKIP_RETRANSLATE
        and len(master[k]) > 1  # skip single-char values
    ]

    all_keys = missing_keys + untranslated_keys

    if not all_keys:
        print(f"  ✓ {lang}.json — fully synced ({len(locale)} keys)")
        return 0

    label_parts = []
    if missing_keys:
        label_parts.append(f"{len(missing_keys)} missing")
    if untranslated_keys:
        label_parts.append(f"{len(untranslated_keys)} untranslated")
    print(f"  → {lang}.json — {' + '.join(label_parts)}")

    if dry_run:
        for k in all_keys[:10]:
            tag = "[NEW]" if k in missing_keys else "[RETRANSLATE]"
            val = master[k]
            print(f"      {tag} {k}: \"{val[:60]}...\"" if len(val) > 60 else f"      {tag} {k}: \"{val}\"")
        if len(all_keys) > 10:
            print(f"      ... and {len(all_keys) - 10} more")
        return len(all_keys)

    # Batch translate
    english_values = [master[k] for k in all_keys]
    translated = []
    api_ok = True

    for i in range(0, len(english_values), BATCH_SIZE):
        batch = english_values[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(english_values) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"    translating batch {batch_num}/{total_batches} ({len(batch)} strings)...")
        result = translate_batch(batch, lang, port)
        if result is None:
            print(f"    ✗ API failed for {lang}.json — skipping remaining batches")
            api_ok = False
            break
        translated.extend(result)

    if not api_ok:
        return 0  # Don't write English fallbacks — skip this locale entirely

    # Merge
    updated = 0
    for key, value in zip(all_keys, translated):
        locale[key] = value
        updated += 1

    save_json(locale_path, locale)
    print(f"    ✓ {'added' if missing_keys else 'updated'} {updated} keys in {lang}.json (total: {len(locale)})")
    return updated


def main():
    parser = argparse.ArgumentParser(description="Sync locale files against en.json master")
    parser.add_argument("--lang", nargs="*", help="Specific language codes to sync (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Show missing keys without writing")
    parser.add_argument("--port", type=int, default=7778, help="API server port (default: 7778)")
    args = parser.parse_args()

    # Load master
    master_path = LOCALES_DIR / "en.json"
    if not master_path.exists():
        print(f"ERROR: en.json not found at {master_path}")
        sys.exit(1)

    master = load_json(master_path)
    print(f"Master: en.json ({len(master)} keys)")

    # Check API availability (unless dry-run)
    if not args.dry_run:
        try:
            url = f"{API_BASE.format(port=args.port)}/api/translate/status"
            with urllib.request.urlopen(url, timeout=5) as resp:
                status = json.loads(resp.read().decode("utf-8"))
                if not status.get("model_downloaded"):
                    print("⚠ NLLB model not downloaded. Run scripts/download_nllb.py first.")
                    sys.exit(1)
                print(f"NLLB: {'ready' if status.get('available') else 'loading...'} ({status.get('languages', 0)} languages)")
        except urllib.error.URLError:
            print(f"ERROR: Cannot reach API at port {args.port}. Is the server running?")
            sys.exit(1)

    # Determine which locales to sync
    if args.lang:
        langs = args.lang
    else:
        langs = sorted([
            p.stem for p in LOCALES_DIR.glob("*.json")
            if p.stem != "en"
        ])

    print(f"Syncing {len(langs)} locale(s)...\n")

    total_added = 0
    for lang in langs:
        total_added += sync_locale(lang, master, args.port, args.dry_run)

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Done. {total_added} total keys {'would be ' if args.dry_run else ''}synced across {len(langs)} locales.")


if __name__ == "__main__":
    main()
