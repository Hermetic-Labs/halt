import os
from pathlib import Path

# ── Resolve project root relative to this file ────────────────────────────────
# config.py lives in  <project>/api/config.py  →  parent.parent = project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Centralized environment configuration for the Medic Info API.
# Models directory is provided by the HALT_MODELS_DIR environment variable
# set by Electron (main.js), start.bat, and 'Start HALT.command', falling back to
# <project>/models for bare dev runs.
MODELS_DIR = Path(os.environ.get("HALT_MODELS_DIR", str(_PROJECT_ROOT / "models")))

# Data directory for patient records, inventory, roster, etc.
DATA_DIR = Path(os.environ.get("HALT_DATA_DIR", str(_PROJECT_ROOT / "patients")))

