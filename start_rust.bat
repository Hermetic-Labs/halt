@echo off
:: ─────────────────────────────────────────────────────────────
:: HALT Rust Launcher — double-click to run the Rust-native app
::
:: This launches the Tauri 2.0 shell with the Rust backend.
:: No Python required. All 83 commands run natively in Rust.
::
:: What happens:
::   1. Sets model/data paths via environment variables
::   2. Runs `cargo tauri dev` in the viewer directory
::   3. Tauri opens the app window with the Vite dev server
::   4. Frontend auto-detects Tauri and uses invoke() → Rust
::
:: Prerequisites:
::   • Rust toolchain (rustup)
::   • Node.js + npm (for Vite frontend)
::   • npm install (run once in viewer/)
:: ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

:: ── Console styling ──────────────────────────────────────────
title HALT — Hermetic Anonymous Local Triage
mode con: cols=72 lines=35
color 0A
chcp 65001 >nul 2>&1

:: ── Set env vars ─────────────────────────────────────────────
set "HALT_MODELS_DIR=%~dp0models"
set "HALT_DATA_DIR=%~dp0patients"
set "RUST_LOG=debug,halt_triage=debug,nllb=debug,ort=info"
set "CMAKE_GENERATOR=Visual Studio 17 2022"

:: ── Kill orphaned processes holding ports ──────────────────────
taskkill /F /IM halt-triage.exe 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7778.*LISTEN" 2^>nul') do taskkill /F /PID %%p 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7779.*LISTEN" 2^>nul') do taskkill /F /PID %%p 2>nul

:: ── Splash ───────────────────────────────────────────────────

echo.
echo.
echo        ██╗  ██╗ █████╗ ██╗  ████████╗
echo        ██║  ██║██╔══██╗██║  ╚══██╔══╝
echo        ███████║███████║██║     ██║
echo        ██╔══██║██╔══██║██║     ██║
echo        ██║  ██║██║  ██║███████╗██║
echo        ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝
echo.
echo        Hermetic Anonymous Local Triage
echo        ──────────────────────────────
echo        Air-gapped medical triage system
echo        83 native commands · Zero Python
echo.
echo        (c) 2026 Hermetic Labs LLC
echo        MIT License · Open Source
echo.
echo    ════════════════════════════════════════

:: ── Verify Rust toolchain ────────────────────────────────────
where cargo >nul 2>&1
if %ERRORLEVEL% neq 0 (
    color 0C
    echo.
    echo    [ERROR] Rust toolchain not found.
    echo    Install from: https://rustup.rs
    pause
    exit /b 1
)

:: ── Verify Node ──────────────────────────────────────────────
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

:: ── Launch ───────────────────────────────────────────────────
echo.
echo    Starting server...
echo.
cd viewer
call npx tauri dev

echo.
echo    HALT closed.
