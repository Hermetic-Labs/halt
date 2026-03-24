@echo off
:: HALT Windows Production Builder
:: One-click launcher for Build-Production.ps1

echo.
echo ============================================
echo       HALT Windows Production Build
echo              Hermetic Labs
echo ============================================
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Not running as Administrator
    echo Some operations may require elevated privileges
    echo.
)

:: Check PowerShell
where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell not found!
    echo Please install PowerShell and try again.
    pause
    exit /b 1
)

:: Run the build
echo Starting production build...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0Build-Production.ps1" -Action all

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo Build complete!
echo.
pause
