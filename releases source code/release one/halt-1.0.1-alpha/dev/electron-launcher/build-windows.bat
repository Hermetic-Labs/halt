@echo off
echo ===========================================
echo    HALT Launcher - Build Script
echo ===========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Navigate to launcher directory
cd /d "%~dp0"

:: Install dependencies
echo [1/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

:: Check for icon files
if not exist "assets\icon.ico" (
    echo.
    echo [WARNING] Missing assets\icon.ico
    echo Please add icon files before building for production.
    echo.
)

:: Build for Windows
echo.
echo [2/3] Building Windows installer...
call npm run build:win
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo.
echo [3/3] Build complete!
echo.
echo Output: dist\HALT-Setup-1.0.0.exe
echo.
pause
