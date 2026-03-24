#!/bin/bash
# HALT — Medical Triage (Dev Launcher for macOS)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$SCRIPT_DIR/api"
PORT=7778
URL="http://127.0.0.1:$PORT"

# ── Preflight ─────────────────────────────────────────────────────────────────
if [ ! -f "$API_DIR/main.py" ]; then
    echo "[ERROR] Backend not found at: $API_DIR/main.py"
    exit 1
fi

# Find Python — portable runtime first, then system
if [ -f "$SCRIPT_DIR/runtime/python/bin/python3" ]; then
    PYTHON="$SCRIPT_DIR/runtime/python/bin/python3"
elif command -v python3 &> /dev/null; then
    PYTHON="python3"
else
    echo "[ERROR] Python 3 not found. Install Python 3 or place a portable runtime at runtime/python/"
    exit 1
fi

echo ""
echo "  ============================================"
echo "    HALT - Medical Triage  [DEV MODE]"
echo "  ============================================"
echo ""

# ── Kill stale processes on our port ──────────────────────────────────────────
echo "  [1/3] Clearing port $PORT..."
lsof -ti :$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true

# ── Start backend ─────────────────────────────────────────────────────────────
echo "  [2/3] Starting backend on port $PORT (--reload)..."
cd "$API_DIR"
$PYTHON -m uvicorn main:app --host 0.0.0.0 --port $PORT --reload &
BACKEND_PID=$!

# ── Wait for health ──────────────────────────────────────────────────────────
ATTEMPTS=0
while [ $ATTEMPTS -lt 30 ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    sleep 2
    if curl -s "$URL/health" > /dev/null 2>&1; then
        echo "  [OK]   Backend ready after $ATTEMPTS checks."
        break
    fi
    echo "         attempt $ATTEMPTS..."
done

if [ $ATTEMPTS -ge 30 ]; then
    echo "  [ERROR] Backend did not respond after 60 seconds."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

# ── Open browser ──────────────────────────────────────────────────────────────
echo "  [3/3] Opening browser..."
open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || echo "  Open $URL in your browser."

echo ""
echo "  ============================================"
echo "    HALT is running  -  $URL"
echo "    --reload active  -  edit Python, save, done"
echo "    Press Ctrl+C to stop."
echo "  ============================================"
echo ""

# ── Trap Ctrl+C for clean shutdown ────────────────────────────────────────────
trap "echo ''; echo '  [STOP] Shutting down...'; kill $BACKEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Wait for backend to exit
wait $BACKEND_PID
