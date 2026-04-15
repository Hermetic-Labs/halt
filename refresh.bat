@echo off
:: ─────────────────────────────────────────────────────────
::  HALT — Fresh Install Simulator
::  Resets ALL user data to simulate a brand-new deployment.
::  Does NOT touch models/ (run R2 test separately).
:: ─────────────────────────────────────────────────────────

echo.
echo   ┌─────────────────────────────────────────────┐
echo   │  HALT — Fresh Install Reset                 │
echo   │  This will DELETE all patient data,          │
echo   │  chat history, wards, inventory, avatars,    │
echo   │  tasks, and cached settings.                 │
echo   │                                              │
echo   │  Models will NOT be touched.                 │
echo   └─────────────────────────────────────────────┘
echo.
echo   Press Ctrl+C to cancel, or...
pause

:: ── Kill running instances ────────────────────────────────
echo.
echo   [1/4] Stopping any running HALT processes...
taskkill /F /IM halt-triage.exe 2>nul
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

:: ── Clear patient data directory ──────────────────────────
echo   [2/4] Clearing patient data...
set "DATA_DIR=%~dp0patients"

if exist "%DATA_DIR%" (
    :: Remove patient records
    del /Q "%DATA_DIR%\PAT-*.json" 2>nul
    
    :: Remove system state files
    del /Q "%DATA_DIR%\_activity.json" 2>nul
    del /Q "%DATA_DIR%\_chat.json" 2>nul
    del /Q "%DATA_DIR%\_inventory.json" 2>nul
    del /Q "%DATA_DIR%\_inventory_locations.json" 2>nul
    del /Q "%DATA_DIR%\_roster.json" 2>nul
    del /Q "%DATA_DIR%\_tasks.json" 2>nul
    del /Q "%DATA_DIR%\_wards.json" 2>nul
    del /Q "%DATA_DIR%\.key" 2>nul
    
    :: Remove attachments
    if exist "%DATA_DIR%\attachments" (
        rmdir /S /Q "%DATA_DIR%\attachments" 2>nul
        mkdir "%DATA_DIR%\attachments"
    )
    
    :: Remove avatars
    if exist "%DATA_DIR%\avatars" (
        rmdir /S /Q "%DATA_DIR%\avatars" 2>nul
        mkdir "%DATA_DIR%\avatars"
    )
    
    :: Remove AI conversation threads
    if exist "%DATA_DIR%\threads" (
        rmdir /S /Q "%DATA_DIR%\threads" 2>nul
        mkdir "%DATA_DIR%\threads"
    )
    
    echo     Patient data cleared.
) else (
    echo     No patient data directory found — already clean.
)

:: ── Clear Tauri webview cache (localStorage, cookies) ─────
echo   [3/4] Clearing browser cache and localStorage...

:: Tauri 2 app data (identifier-based)
set "WV1=%LOCALAPPDATA%\HermeticLabs.HALT-HermeticAnonymousLocalTriage"
set "WV2=%LOCALAPPDATA%\com.hermeticlabs.halt"
set "WV3=%APPDATA%\halt-medical-triage"
set "WV4=%LOCALAPPDATA%\halt-medical-triage-updater"

for %%D in ("%WV1%" "%WV2%" "%WV3%" "%WV4%") do (
    if exist %%D (
        rmdir /S /Q %%D 2>nul
        echo     Cleared %%D
    )
)

:: ── Summary ───────────────────────────────────────────────
echo   [4/4] Reset complete.
echo.
echo   ┌─────────────────────────────────────────────┐
echo   │  ✓  All patient records deleted              │
echo   │  ✓  Chat history cleared                     │
echo   │  ✓  Wards, inventory, tasks reset            │
echo   │  ✓  Avatars and attachments removed          │
echo   │  ✓  Browser localStorage wiped               │
echo   │  ✓  Encryption key regenerated on next start  │
echo   │  ─  Models preserved (run R2 test separately) │
echo   └─────────────────────────────────────────────┘
echo.
echo   Run start_rust.bat to launch as a new user.
echo.
pause
