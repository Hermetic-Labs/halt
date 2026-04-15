#!/usr/bin/env python3
"""
sync_store_listing.py -- Translate MS Store listing into all supported languages.

Uses the local NLLB translation API to generate a CSV + per-language asset folders
in the format expected by Microsoft Partner Center's "Import listing" feature.

Output: c:/Halt/site/Listing.csv + per-language subfolders (en-us/, ar-sa/, etc.)

Usage:
  python dev/sync_store_listing.py                # translate all fields, all languages
  python dev/sync_store_listing.py --dry-run      # preview without writing
  python dev/sync_store_listing.py --port 7778    # custom API port
"""

import csv
import json
import shutil
import sys
import argparse
import urllib.request
import urllib.error
from pathlib import Path

API_BASE = "http://localhost:{port}"
BATCH_SIZE = 5  # Smaller batches for longer texts

SITE_DIR = Path(__file__).resolve().parent.parent / "site"

# ── NLLB code → MS Partner Center locale code + existing folder name ──────────
# Maps our NLLB language codes to:
#   ms_code:     BCP-47 locale for Partner Center CSV columns
#   folder_name: Human-readable folder already in c:\Halt\site\ (for logo pickup)

LANG_CONFIG = {
    "ar": {"ms": "ar-sa",       "folder": "Arabic"},
    "am": {"ms": "am-et",       "folder": "Amharic"},
    "bn": {"ms": "bn-bd",       "folder": "Bengali"},
    "de": {"ms": "de-de",       "folder": "German"},
    "es": {"ms": "es-es",       "folder": "Spanish"},
    "fa": {"ms": "fa-ir",       "folder": "Persian (Farsi-Dari)"},
    "fr": {"ms": "fr-fr",       "folder": "French"},
    "ha": {"ms": "ha-latn-ng",  "folder": "Hausa"},
    "he": {"ms": "he-il",       "folder": "Hebrew"},
    "hi": {"ms": "hi-in",       "folder": "Hindi"},
    "id": {"ms": "id-id",       "folder": "Indonesian"},
    "ig": {"ms": "ig-ng",       "folder": "Igbo"},
    "it": {"ms": "it-it",       "folder": "Italian"},
    "ja": {"ms": "ja-jp",       "folder": "Japanese"},
    "jw": {"ms": "jv-latn-id",  "folder": "Javanese"},
    "km": {"ms": "km-kh",       "folder": "Khmer"},
    "ko": {"ms": "ko-kr",       "folder": "Korean"},
    "ku": {"ms": "ku-arab-iq",  "folder": "Kurdish"},
    "mr": {"ms": "mr-in",       "folder": "Marathi"},
    "my": {"ms": "my-mm",       "folder": "Burmese"},
    "nl": {"ms": "nl-nl",       "folder": "Dutch"},
    "pl": {"ms": "pl-pl",       "folder": "Polish"},
    "ps": {"ms": "ps-af",       "folder": "Pashto"},
    "pt": {"ms": "pt-br",       "folder": "Portuguese"},
    "ru": {"ms": "ru-ru",       "folder": "Russian"},
    "so": {"ms": "so-so",       "folder": "Somali"},
    "sw": {"ms": "sw-ke",       "folder": "Swahili"},
    "ta": {"ms": "ta-in",       "folder": "Tamil"},
    "te": {"ms": "te-in",       "folder": "Telugu"},
    "th": {"ms": "th-th",       "folder": "Thai"},
    "tl": {"ms": "fil-ph",      "folder": "Tagalog"},
    "tr": {"ms": "tr-tr",       "folder": "Turkish"},
    "uk": {"ms": "uk-ua",       "folder": "Ukrainian"},
    "ur": {"ms": "ur-pk",       "folder": "Urdu"},
    "vi": {"ms": "vi-vn",       "folder": "Vietnamese"},
    "xh": {"ms": "xh-za",       "folder": "Xhosa"},
    "yo": {"ms": "yo-ng",       "folder": None},  # no folder yet
    "zh": {"ms": "zh-cn",       "folder": "Chinese"},
    "zu": {"ms": "zu-za",       "folder": "Zulu"},
    "mg": {"ms": "mg-mg",       "folder": "Malagasy"},
    "la": {"ms": "la-latn",     "folder": "Latin"},
}

# ── Store Listing Content (English) ──────────────────────────────────────────
# Edit these to match your actual store listing.

STORE_LISTING = {
    "Title": "HALT - Hermetic Anonymous Local Triage",

    "Short title": "HALT Triage",

    "Short description": "Air-gapped multilingual triage system for mass casualty incidents. Works offline with real-time translation across 41 languages.",

    "Description": """HALT (Hermetic Anonymous Local Triage) is a field-hardened medical triage and communication system designed for mass casualty incidents, disaster response, and conflict zones.

KEY FEATURES:

• Air-Gapped Operation — Runs entirely offline with no internet dependency. All AI models (translation, speech-to-text, text-to-speech) run locally on your device.

• 41-Language Real-Time Translation — Break language barriers instantly. Supports real-time voice-to-voice translation, text translation, and multilingual announcements powered by NLLB-200.

• MARCH Protocol Triage — Full 6-step patient intake with MARCH-based assessment (Massive hemorrhage, Airway, Respiration, Circulation, Hypothermia). Supports rapid Mass Casualty Mode for 3-tap intake.

• Mesh Communication Network — Create a local mesh network connecting multiple devices. Features message boards, direct messaging, voice/video calls with live translation subtitles, and emergency/announcement broadcasts.

• Ward Management — Visual ward map with real-time patient tracking, bed assignments, and status monitoring across multiple wards.

• Patient Records — Comprehensive patient management with vitals monitoring, treatment logs, medication tracking, and exportable records (HTML/PDF).

• Voice-Powered Interface — Kokoro TTS for natural speech output across all supported languages. Faster Whisper for accurate speech recognition.

• Privacy by Design — Zero data leaves your device. No cloud. No telemetry. No accounts required. Built for environments where digital neutrality is critical.

BUILT FOR:
- Military medical teams and combat medics
- Disaster response and humanitarian aid organizations
- Emergency medical services in multilingual communities
- Field hospitals and temporary medical facilities
- Search and rescue operations

HALT is built by Hermetic Labs LLC — engineered for the hardest environments on Earth.""",

    "What's new in this version": """• 41-language real-time translation with voice-to-voice support
• Mesh network communication with encrypted messaging
• Emergency and announcement broadcast system
• Ward map with visual patient tracking
• Voice/video calls with live translation subtitles
• Improved air-gap hardening for offline deployment
• Model download system for easy first-time setup""",

    "Search terms": "triage;medical;translation;emergency;military;disaster;offline;mesh;MARCH;casualty",

    "Copyright and trademark info": "© 2026 Hermetic Labs LLC. All rights reserved.",

    "Additional license terms": "MIT License",

    "Developed by": "Hermetic Labs LLC",
}

# Fields that should NOT be translated (keep English)
SKIP_TRANSLATE = {
    "Search terms",
    "Copyright and trademark info",
    "Additional license terms",
    "Developed by",
    "Title",       # Keep brand name consistent
    "Short title", # Keep brand name consistent
}


def translate_text(text: str, target: str, port: int) -> str | None:
    """Call the local NLLB translate endpoint."""
    url = f"{API_BASE.format(port=port)}/api/translate"
    payload = json.dumps({"text": text, "source": "en", "target": target}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("translated", None)
    except urllib.error.URLError as e:
        print(f"    [!] API error: {e}")
        return None


def translate_batch(texts: list[str], target: str, port: int) -> list[str] | None:
    """Call the local NLLB batch translate endpoint."""
    url = f"{API_BASE.format(port=port)}/api/translate/batch"
    payload = json.dumps({"texts": texts, "source": "en", "target": target}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("translations", None)
    except urllib.error.URLError as e:
        print(f"    [!] API error: {e}")
        return None


def copy_logos(nllb_code: str, ms_code: str):
    """Copy existing logo assets from human-readable folder to MS locale folder."""
    config = LANG_CONFIG.get(nllb_code)
    if not config or not config["folder"]:
        return 0

    src_dir = SITE_DIR / config["folder"]
    dst_dir = SITE_DIR / ms_code

    if not src_dir.exists():
        return 0

    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = 0

    for img in src_dir.glob("*.png"):
        dst = dst_dir / img.name
        if not dst.exists():
            shutil.copy2(img, dst)
            copied += 1

    for img in src_dir.glob("*.jpg"):
        dst = dst_dir / img.name
        if not dst.exists():
            shutil.copy2(img, dst)
            copied += 1

    return copied


def main():
    parser = argparse.ArgumentParser(description="Translate MS Store listing via NLLB")
    parser.add_argument("--port", type=int, default=7778, help="API port (default: 7778)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing CSV")
    parser.add_argument("--lang", nargs="*", help="Specific languages to translate (e.g., ar es fr)")
    args = parser.parse_args()

    # Check NLLB availability
    try:
        with urllib.request.urlopen(f"{API_BASE.format(port=args.port)}/api/translate/status", timeout=10) as r:
            status = json.loads(r.read().decode("utf-8"))
            if not status.get("available") and not status.get("model_downloaded"):
                print("[!] NLLB model not available. Start the HALT server first.")
                sys.exit(1)
            print(f"NLLB: ready ({status.get('languages', '?')} languages)")
    except Exception as e:
        print(f"[!] Cannot reach NLLB API at port {args.port}: {e}")
        sys.exit(1)

    # Determine target languages
    if args.lang:
        targets = {lang: LANG_CONFIG[lang] for lang in args.lang if lang in LANG_CONFIG}
    else:
        targets = dict(LANG_CONFIG)

    translatable_fields = [k for k in STORE_LISTING if k not in SKIP_TRANSLATE]
    print(f"Translating {len(translatable_fields)} fields into {len(targets)} languages...")
    print(f"Output: {SITE_DIR}\n")

    # ── Copy English assets ──────────────────────────────────────────────────
    en_dir = SITE_DIR / "en-us"
    en_dir.mkdir(parents=True, exist_ok=True)
    en_src = SITE_DIR / "English"
    if en_src.exists():
        for img in en_src.glob("*.png"):
            dst = en_dir / img.name
            if not dst.exists():
                shutil.copy2(img, dst)

    # Build result: { ms_locale: { field: translated_text } }
    all_translations: dict[str, dict[str, str]] = {}
    all_translations["en-us"] = dict(STORE_LISTING)

    for nllb_code, config in sorted(targets.items(), key=lambda x: x[1]["ms"]):
        ms_code = config["ms"]
        print(f"  -> {ms_code} ({nllb_code})...")

        # Copy logos from existing folder to MS-code folder
        n_copied = copy_logos(nllb_code, ms_code)
        if n_copied:
            print(f"     [{n_copied} logo(s) copied]")

        if args.dry_run:
            all_translations[ms_code] = dict(STORE_LISTING)
            continue

        translated_fields: dict[str, str] = {}

        # Copy non-translatable fields as-is
        for k in SKIP_TRANSLATE:
            if k in STORE_LISTING:
                translated_fields[k] = STORE_LISTING[k]

        # Translate each field
        for field_name in translatable_fields:
            text = STORE_LISTING[field_name]

            # For long texts, translate paragraph by paragraph
            if len(text) > 500:
                paragraphs = text.split("\n")
                translated_paras = []
                # Only translate non-empty paragraphs
                for i in range(0, len(paragraphs), BATCH_SIZE):
                    batch = paragraphs[i:i + BATCH_SIZE]
                    # Skip blank lines
                    to_translate = [(j, p) for j, p in enumerate(batch) if p.strip()]
                    if to_translate:
                        texts_only = [p for _, p in to_translate]
                        results = translate_batch(texts_only, nllb_code, args.port)
                        result_idx = 0
                        for j, p in enumerate(batch):
                            if p.strip() and results:
                                translated_paras.append(results[result_idx])
                                result_idx += 1
                            else:
                                translated_paras.append(p)
                    else:
                        translated_paras.extend(batch)

                translated_fields[field_name] = "\n".join(translated_paras)
            else:
                result = translate_text(text, nllb_code, args.port)
                translated_fields[field_name] = result or text

        all_translations[ms_code] = translated_fields
        print(f"     [OK] {ms_code}")

    # ── Write CSV ────────────────────────────────────────────────────────────
    if args.dry_run:
        print("\n[DRY RUN] Would write CSV with these columns:")
        print(f"  Fields: {list(STORE_LISTING.keys())}")
        print(f"  Languages: {sorted(all_translations.keys())}")
        return

    csv_path = SITE_DIR / "Listing.csv"

    # MS format: Field | en-us | ar-sa | es-es | ...
    locales = sorted(all_translations.keys())
    fields = list(STORE_LISTING.keys())

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)

        # Header row
        writer.writerow(["Field"] + locales)

        # Data rows
        for field in fields:
            row = [field]
            for locale in locales:
                row.append(all_translations.get(locale, {}).get(field, ""))
            writer.writerow(row)

    print(f"\n✅ Listing.csv written to: {csv_path}")
    print(f"   {len(fields)} fields × {len(locales)} languages")
    print(f"   Logo assets copied to per-locale folders")
    print(f"\nTo import:")
    print(f"   Partner Center → Store listings → Import listing")
    print(f"   Select the entire {SITE_DIR} folder")


if __name__ == "__main__":
    main()
