"""
Merge Store Listing — takes the MS Partner Center export as template,
injects our translated content into additional language columns.

Usage: python merge_store_listing.py

Reads:
  - site/store-import/listingData-*.csv  (MS export = template)
  - site/Listing.csv                      (our translations)

Writes:
  - site/store-import/Listing-import.csv  (ready for MS import)
"""

import csv
import glob
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(REPO_ROOT, "site")
IMPORT_DIR = os.path.join(SITE_DIR, "store-import")

# ── Find the MS export template ──────────────────────────────────────────────

templates = glob.glob(os.path.join(IMPORT_DIR, "listingData-*.csv"))
if not templates:
    print("ERROR: No listingData-*.csv found in store-import/")
    sys.exit(1)
template_path = templates[0]
print(f"Template: {os.path.basename(template_path)}")

# ── Read our translations ────────────────────────────────────────────────────

our_csv_path = os.path.join(SITE_DIR, "Listing.csv")
if not os.path.exists(our_csv_path):
    print("ERROR: Listing.csv not found")
    sys.exit(1)

# Our CSV: Field,am-et,ar-sa,...  (rows = Title, Short title, Short description, Description, ...)
our_data = {}  # {locale: {field_name: value}}
with open(our_csv_path, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    our_locales = [col for col in reader.fieldnames if col != "Field"]
    for row in reader:
        field = row["Field"]
        for loc in our_locales:
            if loc not in our_data:
                our_data[loc] = {}
            our_data[loc][field] = row.get(loc, "")

print(f"Our translations: {len(our_locales)} locales")
print(f"Fields per locale: {list(our_data.get('en-us', {}).keys())}")

# ── Map our field names → MS field names ─────────────────────────────────────

# Our field names from sync_store_listing.py → MS export Field names
FIELD_MAP = {
    "Title": "Title",
    "Short title": "ShortTitle",
    "Short description": "ShortDescription",
    "Description": "Description",
    "Release notes": "ReleaseNotes",
    "Features": None,  # We'll handle features separately
}

# ── Read the MS template ─────────────────────────────────────────────────────

template_rows = []
with open(template_path, "r", encoding="utf-8-sig") as f:
    # Can't use DictReader easily because Description has multi-line values
    content = f.read()

# Parse with csv module handling multi-line quoted fields
import io
reader = csv.reader(io.StringIO(content))
template_rows = list(reader)

if not template_rows:
    print("ERROR: Template is empty")
    sys.exit(1)

header = template_rows[0]
print(f"Template columns: {header}")
print(f"Template rows: {len(template_rows)}")

# Find existing column indices
# Header: Field, ID, Type (Type), default, en-us
# We need to add new locale columns after the last one

# ── Build the output ─────────────────────────────────────────────────────────

# Add our locale columns to the header (skip en-us since it's already there)
new_locales = [loc for loc in our_locales if loc not in header]
new_header = header + new_locales
print(f"Adding {len(new_locales)} new locale columns")

# For each row in the template, look up the Field name and fill in translations
output_rows = [new_header]

# Text fields we can translate
TRANSLATABLE_FIELDS = {
    "Description", "ReleaseNotes", "Title", "ShortTitle",
    "VoiceTitle", "ShortDescription", "DevStudio",
    "CopyrightTrademarkInformation",
    "Feature1", "Feature2", "Feature3", "Feature4", "Feature5",
    "SearchTerm1", "SearchTerm2", "SearchTerm3", "SearchTerm4",
    "SearchTerm5", "SearchTerm6",
    "TrailerTitle1",
}

# Reverse map: MS field name → our field name
MS_TO_OURS = {
    "Title": "Title",
    "ShortTitle": "Short title",
    "ShortDescription": "Short description",
    "Description": "Description",
    "ReleaseNotes": "What's new in this version",
    "CopyrightTrademarkInformation": "Copyright and trademark info",
    "DevStudio": "Developed by",
}

for row_idx, row in enumerate(template_rows[1:], 1):
    if not row or not row[0]:
        # Empty row — pad and keep
        output_rows.append(row + [""] * len(new_locales))
        continue

    field_name = row[0]  # e.g., "Description", "Title", etc.

    # Pad row to match original header length if needed
    while len(row) < len(header):
        row.append("")

    # Add new locale columns
    new_cols = []
    for loc in new_locales:
        if field_name in TRANSLATABLE_FIELDS:
            # Look up our translation
            our_field = MS_TO_OURS.get(field_name, None)
            if our_field and loc in our_data:
                value = our_data[loc].get(our_field, "")
                new_cols.append(value)
            elif field_name == "VoiceTitle":
                # Same as title
                new_cols.append(our_data.get(loc, {}).get("Title", ""))
            elif field_name == "DevStudio":
                new_cols.append("Hermetic Labs")
            elif field_name == "CopyrightTrademarkInformation":
                new_cols.append(row[header.index("en-us")] if "en-us" in header else "")
            elif field_name.startswith("Feature"):
                # Copy en-us features (they're in English)
                en_idx = header.index("en-us") if "en-us" in header else -1
                new_cols.append(row[en_idx] if en_idx >= 0 else "")
            elif field_name.startswith("SearchTerm"):
                en_idx = header.index("en-us") if "en-us" in header else -1
                new_cols.append(row[en_idx] if en_idx >= 0 else "")
            elif field_name == "TrailerTitle1":
                en_idx = header.index("en-us") if "en-us" in header else -1
                new_cols.append(row[en_idx] if en_idx >= 0 else "")
            else:
                new_cols.append("")
        else:
            # Non-translatable (screenshots, logos, etc.) — leave empty for new locales
            new_cols.append("")

    output_rows.append(row + new_cols)

# ── Write output ─────────────────────────────────────────────────────────────

output_path = os.path.join(IMPORT_DIR, "Listing-import.csv")
with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    for row in output_rows:
        writer.writerow(row)

print(f"\nDone! Written to: {output_path}")
print(f"Columns: {len(output_rows[0])} ({len(header)} original + {len(new_locales)} new locales)")
print(f"Rows: {len(output_rows)}")
