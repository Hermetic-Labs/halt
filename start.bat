@echo off
:: ─────────────────────────────────────────────────────────────
:: HALT Launcher
::
:: Directly launches the Rust/Tauri 2.0 system (Zero Python).
:: ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

echo.
echo   ┌──────────────────────────────────────────┐
echo   │  HALT — Hermetic Anonymous Local Triage  │
echo   └──────────────────────────────────────────┘
echo.
echo   Booting native Rust architecture...

call "%~dp0start_rust.bat"
