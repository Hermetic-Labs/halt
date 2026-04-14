"""
Shared storage layer — JSON persistence with optional AES-256 encryption.

Every route module reads and writes data through read_json() / write_json()
so encryption, path conventions, and directory setup happen in one place.
Patient files (PAT-*.json) are encrypted with Fernet if the cryptography
package is installed; other data files (wards, inventory, roster) are stored
as plain JSON for easier debugging.

Keys are auto-generated and stored in DATA_DIR/.key on first use.
"""
import json
from pathlib import Path
from config import DATA_DIR as _CFG_DATA_DIR

# ── Data directory ─────────────────────────────────────────────────────────────
DATA_DIR = _CFG_DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)
ATTACH_DIR = DATA_DIR / "attachments"
ATTACH_DIR.mkdir(exist_ok=True)
KEY_FILE = DATA_DIR / ".key"

# ── Encryption (AES-256 via Fernet) ────────────────────────────────────────────
try:
    from cryptography.fernet import Fernet

    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False
    Fernet = None  # type: ignore


def _get_fernet():
    """Load or generate the encryption key. Returns None if cryptography not installed."""
    if not _CRYPTO_AVAILABLE:
        return None
    if KEY_FILE.exists():
        key = KEY_FILE.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        KEY_FILE.write_bytes(key)
    return Fernet(key)


_fernet = _get_fernet()

# ── JSON helpers ───────────────────────────────────────────────────────────────


def read_json(path: Path) -> dict:
    raw = path.read_bytes()
    if _fernet:
        try:
            decrypted = _fernet.decrypt(raw)
            return json.loads(decrypted)
        except Exception:
            pass  # Fall through to plaintext
    return json.loads(raw)


def write_json(path: Path, data: dict) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    if _fernet and path.name.startswith("PAT-"):
        path.write_bytes(_fernet.encrypt(payload))
    else:
        path.write_bytes(payload)


# ── Path helpers ───────────────────────────────────────────────────────────────


def patient_path(patient_id: str) -> Path:
    return DATA_DIR / f"{patient_id}.json"


def ward_config_path() -> Path:
    return DATA_DIR / "_ward_config.json"


def wards_path() -> Path:
    return DATA_DIR / "_wards.json"


def inventory_path() -> Path:
    return DATA_DIR / "_inventory.json"


def inventory_locations_path() -> Path:
    return DATA_DIR / "_inventory_locations.json"


def roster_path() -> Path:
    return DATA_DIR / "_roster.json"


def tasks_path() -> Path:
    return DATA_DIR / "_tasks.json"


def chat_path() -> Path:
    return DATA_DIR / "_chat.json"


def activity_path() -> Path:
    return DATA_DIR / "_activity.json"


# ── Directories ────────────────────────────────────────────────────────────────

AVATAR_DIR = DATA_DIR / "avatars"
AVATAR_DIR.mkdir(exist_ok=True)

THREADS_DIR = DATA_DIR / "threads"
THREADS_DIR.mkdir(exist_ok=True)

# ── Thread helpers ─────────────────────────────────────────────────────────────


def thread_path(id_a: str, id_b: str) -> Path:
    """DM thread file for a pair of members. IDs sorted alphabetically for consistency."""
    pair = sorted([id_a, id_b])
    return THREADS_DIR / f"{pair[0]}--{pair[1]}.json"


# ── Activity log ───────────────────────────────────────────────────────────────


def log_activity(who: str, action: str, target: str = "", **extra):
    """Append an entry to the activity log. Fire-and-forget.
    Extra kwargs (e.g. action_type, qty) are stored alongside for structured i18n."""
    from datetime import datetime

    p = activity_path()
    entries = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    entry = {
        "who": who,
        "action": action,
        "target": target,
        "timestamp": datetime.now().isoformat(),
    }
    # Merge any structured fields (action_type, qty, etc.)
    entry.update(extra)
    entries.append(entry)
    # Keep last 1000 entries
    if len(entries) > 1000:
        entries = entries[-1000:]
    write_json(p, entries)
