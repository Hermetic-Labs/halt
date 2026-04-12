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
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":7778 :7779"') do (
    taskkill /PID %%p /T /F >nul 2>&1
)

echo   Starting HALT (production mode)...
echo   App ^& API: Native Window (Tauri)
echo   Press Ctrl+C to stop
echo.

:: ── Launch: Tauri Native Desktop Shell ───────
cd viewer
call npm run tauri dev

pause

echo.
echo   Closing HALT...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":7778 :7779"') do (
    taskkill /PID %%p /T /F >nul 2>&1
)
