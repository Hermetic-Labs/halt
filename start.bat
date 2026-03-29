@echo off
:: ─────────────────────────────────────────────────────────────
:: HALT Dev Launcher — double-click to start working
::
:: Mirrors production Electron behavior exactly:
::   • Single process on port 7778 (API + static PWA)
::   • Same env vars Electron sets (HALT_MODELS_DIR, HALT_DATA_DIR)
::   • No --reload (matches packaged build)
::   • Opens browser at http://localhost:7778
:: ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

:: ── Set env vars to match Electron's startBackend() ──────────
set "HALT_MODELS_DIR=%~dp0models"
set "HALT_DATA_DIR=%~dp0patients"

echo.
echo   Cleaning stale port 7778...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7778 " ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%p /T /F >nul 2>&1
)

echo   Starting HALT (production mode)...
echo   App ^& API: http://localhost:7778
echo   Press Ctrl+C to stop
echo.

:: ── Launch: single-port, no reload, auto-opens browser ───────
python start.py --api-port 7778 --prod

echo.
echo   Closing HALT...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7778 " ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%p /T /F >nul 2>&1
)
