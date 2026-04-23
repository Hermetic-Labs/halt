@echo off
:: -------------------------------------------------------------
:: HALT Rust Launcher - double-click to run the Rust-native app
::
:: This launches the Tauri 2.0 shell with the Rust backend.
:: No Python required. All 83 commands run natively in Rust.
::
:: What happens:
::   1. Sets model/data paths via environment variables
::   2. Runs `cargo tauri dev` in the viewer directory
::   3. Tauri opens the app window with the Vite dev server
::   4. Frontend auto-detects Tauri and uses invoke() -> Rust
::
:: Prerequisites:
::   * Rust toolchain (rustup)
::   * Node.js + npm (for Vite frontend)
::   * npm install (run once in viewer/)
:: -------------------------------------------------------------
cd /d "%~dp0"

:: -- Console styling ------------------------------------------
title HALT - Hermetic Anonymous Local Triage
mode con: cols=72 lines=35
color 0A

:: -- Set env vars ---------------------------------------------
set "HALT_MODELS_DIR=%~dp0models"
set "HALT_DATA_DIR=%~dp0patients"
set "RUST_LOG=debug,halt_triage=debug,nllb=debug,ort=info"
set "CMAKE_GENERATOR=Visual Studio 17 2022"

:: -- Kill orphaned processes holding ports --------------------
taskkill /F /IM halt-triage.exe 2>nul
taskkill /F /IM halt-whisper.exe 2>nul
taskkill /F /IM halt-nllb.exe 2>nul
powershell -NoProfile -Command "foreach ($p in 7778,7779,7780,7781) { Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"

:: -- Splash ---------------------------------------------------

echo.
echo.
echo        [ HALT - Hermetic Anonymous Local Triage ]
echo        ------------------------------------------
echo        Air-gapped medical triage system
echo        83 native commands - Zero Python
echo.
echo        (c) 2026 Hermetic Labs LLC
echo        MIT License - Open Source
echo.
echo    ========================================

:: -- Verify Rust toolchain ------------------------------------
where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo    [ERROR] Rust toolchain not found.
    echo    Install from: https://rustup.rs
    pause
    exit /b 1
)

:: -- Verify Node ----------------------------------------------
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo    [ERROR] Node.js not found.
    echo    Install from: https://nodejs.org
    pause
    exit /b 1
)

:: ── Install frontend deps if needed ──────────────────────────
if not exist "viewer\node_modules" (
    echo.
    echo    Installing frontend dependencies...
    cd viewer
    call npm install
    cd ..
)

:: ── Build ML subprocesses (release, only if missing) ─────────
set "WHISPER_BIN=viewer\src-tauri\target\release\halt-whisper.exe"
set "NLLB_BIN=viewer\src-tauri\target\release\halt-nllb.exe"

if not exist "%WHISPER_BIN%" (
    echo.
    echo    Building halt-whisper [release]...
    cd viewer\src-tauri
    cargo build --bin halt-whisper --release --features whisper_stt
    cd ..\..
) else (
    echo    halt-whisper: cached
)

if not exist "%NLLB_BIN%" (
    echo.
    echo    Building halt-nllb [release]...
    cd viewer\src-tauri
    cargo build --bin halt-nllb --release --features nllb_translate
    cd ..\..
) else (
    echo    halt-nllb: cached
)

set "VISION_BIN=viewer\src-tauri\target\release\halt-vision.exe"
if not exist "%VISION_BIN%" (
    echo.
    echo    Building halt-vision [release]...
    cd viewer\src-tauri
    cargo build --bin halt-vision --release --features native_ml
    cd ..\..
) else (
    echo    halt-vision: cached
)

:: -- Launch ML sidecars in visible windows --------------------
echo.
echo    Spawning Whisper STT (Port 7780)...
start "HALT-WHISPER [7780]" cmd /k "set HALT_MODELS_DIR=%HALT_MODELS_DIR%& %WHISPER_BIN%"

echo    Spawning NLLB Tracker CLI (Port 7781)...
start "HALT-NLLB [7781]" cmd /k "set HALT_MODELS_DIR=%HALT_MODELS_DIR%& %NLLB_BIN%"

echo    Spawning Vision Server (Port 7782)...
start "HALT-VISION [7782]" cmd /k "set HALT_MODELS_DIR=%HALT_MODELS_DIR%& %VISION_BIN%"

:: -- Launch ---------------------------------------------------
echo.
echo    Starting main app...
echo.
cd viewer
call npx tauri dev

echo.
echo    HALT closed.
