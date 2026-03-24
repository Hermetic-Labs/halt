#!/bin/bash
# ─────────────────────────────────────────────────────────
#  HALT — Double-click to launch
# ─────────────────────────────────────────────────────────
#  This is a macOS .command file. You can double-click it
#  in Finder to start the HALT system. No Terminal needed.
# ─────────────────────────────────────────────────────────

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Remove macOS quarantine so downloaded binaries can execute
echo "  [SETUP]  Clearing macOS quarantine flags..."
xattr -r -d com.apple.quarantine "$DIR" 2>/dev/null

# Use bundled Python runtime if available, else fall back to system
if [ -x "$DIR/runtime/python/bin/python3" ]; then
    PYTHON="$DIR/runtime/python/bin/python3"
    echo "  [OK]     Using bundled Python runtime"
else
    PYTHON=$(command -v python3 || command -v python)
    echo "  [WARN]   Bundled runtime not found — using system Python: $PYTHON"
fi

if [ -z "$PYTHON" ]; then
    echo ""
    echo "  [ERROR]  Python not found. Install from https://python.org"
    echo "  Press any key to exit..."
    read -n 1
    exit 1
fi

echo ""
echo "  ╔═══════════════════════════════════════╗"
echo "  ║         HALT — Starting Up            ║"
echo "  ╚═══════════════════════════════════════╝"
echo ""

"$PYTHON" "$DIR/start.py"

# Keep window open if something goes wrong
echo ""
echo "  HALT has stopped. Press any key to close this window..."
read -n 1
