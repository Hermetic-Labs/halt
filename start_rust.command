#!/bin/bash
# ─────────────────────────────────────────────────────────────
# HALT Rust Launcher (macOS) — run the Rust-native app
#
# This launches the Tauri 2.0 shell with the Rust backend.
# For iOS TestFlight builds, use: cargo tauri ios build
#
# What happens:
#   1. Sets model/data paths via environment variables
#   2. Runs `cargo tauri dev` in the viewer directory
#   3. Tauri opens the app window with the Vite dev server
#   4. Frontend auto-detects Tauri and uses invoke() → Rust
# ─────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"

# ── Set env vars ─────────────────────────────────────────────
export HALT_MODELS_DIR="$(pwd)/models"
export HALT_DATA_DIR="$(pwd)/patients"

echo ""
echo "  ┌──────────────────────────────────┐"
echo "  │  HALT — Rust Native Mode         │"
echo "  │  83 commands · Zero Python       │"
echo "  └──────────────────────────────────┘"
echo ""

# ── Verify toolchain ─────────────────────────────────────────
if ! command -v cargo &>/dev/null; then
    echo "  [ERROR] Rust toolchain not found."
    echo "  Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "  [ERROR] Node.js not found."
    echo "  Install: brew install node"
    exit 1
fi

# ── Install frontend deps if needed ──────────────────────────
if [ ! -d "viewer/node_modules" ]; then
    echo "  Installing frontend dependencies..."
    cd viewer && npm install && cd ..
    echo ""
fi

# ── Launch ────────────────────────────────────────────────────
echo "  Starting Tauri dev server..."
echo "  (First build may take 2-3 minutes)"
echo ""
cd viewer
npx tauri dev
