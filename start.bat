@echo off
:: ─────────────────────────────────────────────────────────────
:: HALT Launcher — Choose your mode
::
:: Two entry points:
::   start_dev.bat   — Python + Vite (legacy desktop dev)
::   start_rust.bat  — Tauri + Rust (native, no Python)
:: ─────────────────────────────────────────────────────────────
cd /d "%~dp0"

echo.
echo   ┌──────────────────────────────────────────┐
echo   │  HALT — Hermetic Anonymous Local Triage   │
echo   └──────────────────────────────────────────┘
echo.
echo   [1] Dev Mode   (Python + Vite — legacy)
echo   [2] Rust Mode  (Tauri native — 83 commands)
echo.
set /p choice="   Choose [1/2]: "

if "%choice%"=="2" (
    call "%~dp0start_rust.bat"
) else (
    call "%~dp0start_dev.bat"
)
