@echo off
:: ─────────────────────────────────────────────────────────────
:: HALT Dev Launcher (Python + Vite) — double-click to start
::
:: This is the LEGACY dev workflow that runs the Python FastAPI
:: backend. Use this when developing on Windows/macOS desktop
:: where the Python sidecar is still the active backend.
::
:: Runs start.py which orchestrates:
::   • Model auto-download (first run only)
::   • Backend API server on port 7778
::   • Opens browser to http://localhost:7778
::   • Ctrl+C to stop everything
::
:: For the Rust-native path, use start_rust.bat instead.
:: ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

:: ── Set env vars ─────────────────────────────────────────────
set "HALT_MODELS_DIR=%~dp0models"
set "HALT_DATA_DIR=%~dp0patients"

echo.
echo   ┌──────────────────────────────────┐
echo   │  HALT — Dev Mode (Python + Vite) │
echo   └──────────────────────────────────┘
echo.
echo   Cleaning stale ports...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":7778 :7779"') do (
    taskkill /PID %%p /T /F >nul 2>&1
)

echo   Starting HALT...
echo.

:: ── Launch via start.py (handles everything) ─────────────────
python start.py

echo.
echo   Closing HALT...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":7778 :7779"') do (
    taskkill /PID %%p /T /F >nul 2>&1
)
