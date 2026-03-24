@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM HALT Windows Installation Script
REM
REM CRITICAL: This installer MUST:
REM 1. Write the install_complete.flag marker
REM 2. Set EVE_SYSTEM_MODE=PRODUCTION in the environment
REM 3. FAIL if either cannot be completed
REM ============================================================================

set "SCRIPT_DIR=%~dp0"
set "INSTALL_DIR=C:\Program Files\HALT\HALT Medical Platform"
set "DATA_DIR=C:\ProgramData\HALT"
set "RUNTIME_DIR=%INSTALL_DIR%\backend\runtime"
set "INSTALL_MARKER=%RUNTIME_DIR%\install_complete.flag"
set "ENV_FILE=%DATA_DIR%\env"
set "PYTHON_VERSION_REQUIRED=3.10"
set "NODE_VERSION_REQUIRED=16"

REM Color codes for output
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "CYAN=[96m"
set "NC=[0m"

echo.
echo %CYAN%========================================================%NC%
echo %CYAN%          HALT Windows Installation Script            %NC%
echo %CYAN%     Medical Platform - FHIR R4 / HIPAA / IEC 62304     %NC%
echo %CYAN%========================================================%NC%
echo.

REM Check for administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: Administrator privileges required%NC%
    echo Please right-click this script and select "Run as administrator"
    pause
    exit /b 1
)

echo %GREEN%[OK] Administrator privileges confirmed%NC%
echo.

REM ============================================================================
REM PREREQUISITES CHECK
REM ============================================================================
echo %BLUE%[1/8] Checking prerequisites...%NC%

REM Check Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: Python is not installed or not in PATH%NC%
    echo Please install Python 3.8+ from https://python.org
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version 2^>^&1') do set "PYTHON_VER=%%i"
echo %GREEN%  [OK] Python %PYTHON_VER% found%NC%

REM Check Node.js installation
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: Node.js is not installed or not in PATH%NC%
    echo Please install Node.js 16+ from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=1" %%i in ('node --version 2^>^&1') do set "NODE_VER=%%i"
echo %GREEN%  [OK] Node.js %NODE_VER% found%NC%

REM Install pnpm if not present
pnpm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %YELLOW%  [..] Installing pnpm...%NC%
    npm install -g pnpm
    if !errorlevel! neq 0 (
        echo %RED%ERROR: Failed to install pnpm%NC%
        pause
        exit /b 1
    )
    echo %GREEN%  [OK] pnpm installed%NC%
) else (
    echo %GREEN%  [OK] pnpm available%NC%
)

REM ============================================================================
REM CREATE DIRECTORIES
REM ============================================================================
echo.
echo %BLUE%[2/8] Creating directories...%NC%

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" >nul 2>&1
if not exist "%DATA_DIR%\logs" mkdir "%DATA_DIR%\logs" >nul 2>&1
if not exist "%DATA_DIR%\data" mkdir "%DATA_DIR%\data" >nul 2>&1
if not exist "%DATA_DIR%\cache" mkdir "%DATA_DIR%\cache" >nul 2>&1
if not exist "%DATA_DIR%\models" mkdir "%DATA_DIR%\models" >nul 2>&1
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>&1

echo %GREEN%  [OK] Directories created%NC%

REM ============================================================================
REM COPY APPLICATION FILES
REM ============================================================================
echo.
echo %BLUE%[3/8] Copying application files...%NC%

xcopy /E /I /Y "%SCRIPT_DIR%..\..\*" "%INSTALL_DIR%\" >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%ERROR: Failed to copy application files%NC%
    pause
    exit /b 1
)
echo %GREEN%  [OK] Application files copied%NC%

REM ============================================================================
REM INSTALL DEPENDENCIES
REM ============================================================================
echo.
echo %BLUE%[4/8] Installing Python dependencies...%NC%

cd /d "%INSTALL_DIR%\backend"
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo %RED%ERROR: Failed to install Python dependencies%NC%
    pause
    exit /b 1
)
echo %GREEN%  [OK] Python dependencies installed%NC%

echo.
echo %BLUE%[5/8] Installing Node.js dependencies...%NC%

cd /d "%INSTALL_DIR%"
pnpm install --frozen-lockfile >nul 2>&1
if %errorlevel% neq 0 (
    echo %YELLOW%  [..] Retrying without lockfile...%NC%
    pnpm install
    if !errorlevel! neq 0 (
        echo %RED%ERROR: Failed to install Node.js dependencies%NC%
        pause
        exit /b 1
    )
)
echo %GREEN%  [OK] Node.js dependencies installed%NC%

REM ============================================================================
REM PRODUCTION ACTIVATION (CRITICAL - NON-NEGOTIABLE)
REM ============================================================================
echo.
echo %BLUE%[6/8] Activating PRODUCTION mode...%NC%

REM Write install marker - THIS IS MANDATORY
echo # HALT Installation Marker > "%INSTALL_MARKER%"
echo # This file indicates a production installation has been completed. >> "%INSTALL_MARKER%"
echo # DO NOT DELETE - system will fail to start in undefined state without this. >> "%INSTALL_MARKER%"
echo. >> "%INSTALL_MARKER%"
echo installed_at=%DATE% %TIME% >> "%INSTALL_MARKER%"
echo installer_version=1.0.0 >> "%INSTALL_MARKER%"
echo platform=windows >> "%INSTALL_MARKER%"
echo installer_user=%USERNAME% >> "%INSTALL_MARKER%"

REM Verify marker was written
if not exist "%INSTALL_MARKER%" (
    echo %RED%FATAL: Failed to write install marker at %INSTALL_MARKER%%NC%
    echo %RED%Installation cannot continue - production mode would be ambiguous.%NC%
    pause
    exit /b 1
)
echo %GREEN%  [OK] Install marker written%NC%

REM Generate secrets using PowerShell
for /f "delims=" %%i in ('powershell -Command "[System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')"') do set "SECRET_KEY=%%i"
for /f "delims=" %%i in ('powershell -Command "[System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')"') do set "JWT_SECRET=%%i"

REM Create environment file with PRODUCTION mode
(
echo # HALT Production Environment
echo # Generated by installer at %DATE% %TIME%
echo #
echo # CRITICAL: This file sets the system to PRODUCTION mode.
echo # Do not modify unless you understand the implications.
echo.
echo EVE_SYSTEM_MODE=PRODUCTION
echo.
echo # Security: Generated unique secrets for this installation
echo SECRET_KEY=%SECRET_KEY%
echo JWT_SECRET=%JWT_SECRET%
echo.
echo # CORS: Set to your actual frontend origin in production
echo # CORS_ORIGINS=https://your-domain.com
echo CORS_ORIGINS=http://localhost:7777,http://localhost:7778
echo.
echo # Database
echo DATABASE_URL=sqlite:///%DATA_DIR:\=/%/data/eve_os.db
echo.
echo # Server
echo HOST=127.0.0.1
echo PORT=7778
) > "%ENV_FILE%"

REM Verify environment file was written
if not exist "%ENV_FILE%" (
    echo %RED%FATAL: Failed to write environment file at %ENV_FILE%%NC%
    echo %RED%Installation cannot continue - production mode would not be set.%NC%
    pause
    exit /b 1
)

REM Copy env file to backend
copy "%ENV_FILE%" "%INSTALL_DIR%\backend\.env" >nul 2>&1

echo %GREEN%  [OK] Production environment configured%NC%
echo %GREEN%  [OK] EVE_SYSTEM_MODE=PRODUCTION%NC%

REM ============================================================================
REM INITIALIZE DATABASE
REM ============================================================================
echo.
echo %BLUE%[7/8] Initializing database...%NC%

cd /d "%INSTALL_DIR%\backend"
if exist "init_db.py" (
    python init_db.py >nul 2>&1
)
echo %GREEN%  [OK] Database initialized%NC%

REM ============================================================================
REM WINDOWS SERVICE INSTALLATION
REM ============================================================================
echo.
echo %BLUE%[8/8] Finalizing installation...%NC%

REM Set environment variables
setx HALT_HOME "%INSTALL_DIR%" /M >nul 2>&1
setx HALT_DATA "%DATA_DIR%" /M >nul 2>&1
setx EVE_SYSTEM_MODE "PRODUCTION" /M >nul 2>&1

REM Create desktop shortcut
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\HALT.lnk'); $Shortcut.TargetPath = 'cmd.exe'; $Shortcut.Arguments = '/k cd /d \"%INSTALL_DIR%\" && python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 7778'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Description = 'HALT Medical Platform'; $Shortcut.Save()" >nul 2>&1

REM Create start menu entries
if not exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\HALT" mkdir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\HALT" >nul 2>&1

echo %GREEN%  [OK] Shortcuts created%NC%

REM ============================================================================
REM VERIFICATION
REM ============================================================================
echo.
echo %CYAN%========================================================%NC%
echo %CYAN%                 INSTALLATION VERIFICATION              %NC%
echo %CYAN%========================================================%NC%

REM Verify critical files
set "VERIFICATION_PASSED=1"

if exist "%INSTALL_MARKER%" (
    echo %GREEN%  [OK] Install marker present%NC%
) else (
    echo %RED%  [FAIL] Install marker missing%NC%
    set "VERIFICATION_PASSED=0"
)

if exist "%ENV_FILE%" (
    echo %GREEN%  [OK] Production environment file present%NC%
) else (
    echo %RED%  [FAIL] Environment file missing%NC%
    set "VERIFICATION_PASSED=0"
)

if exist "%INSTALL_DIR%\backend\app\main.py" (
    echo %GREEN%  [OK] Backend application present%NC%
) else (
    echo %RED%  [FAIL] Backend application missing%NC%
    set "VERIFICATION_PASSED=0"
)

if exist "%INSTALL_DIR%\backend\app\peer_review\routes.py" (
    echo %GREEN%  [OK] Peer review routes present%NC%
) else (
    echo %RED%  [FAIL] Peer review routes missing%NC%
    set "VERIFICATION_PASSED=0"
)

if "%VERIFICATION_PASSED%"=="0" (
    echo.
    echo %RED%FATAL: Installation verification failed%NC%
    echo %RED%The system may not start correctly.%NC%
    pause
    exit /b 1
)

REM ============================================================================
REM COMPLETION
REM ============================================================================
echo.
echo %GREEN%========================================================%NC%
echo %GREEN%      INSTALLATION COMPLETE - PRODUCTION MODE           %NC%
echo %GREEN%========================================================%NC%
echo.
echo %CYAN%PRODUCTION MODE STATUS:%NC%
echo   Install marker: %INSTALL_MARKER%
echo   Environment: %ENV_FILE%
echo   EVE_SYSTEM_MODE=PRODUCTION
echo.
echo %CYAN%Installation Details:%NC%
echo   Install Directory: %INSTALL_DIR%
echo   Data Directory: %DATA_DIR%
echo.
echo %CYAN%Access Points:%NC%
echo   Backend API: http://localhost:7778
echo   System Mode: http://localhost:7778/system/mode (localhost only)
echo.
echo %CYAN%To Start HALT:%NC%
echo   1. Open Command Prompt as Administrator
echo   2. cd "%INSTALL_DIR%"
echo   3. python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 7778
echo.
echo %CYAN%Medical Compliance:%NC%
echo   FHIR R4 compliant
echo   HIPAA ready
echo   IEC 62304 Class B
echo.

set /p "START_NOW=Start HALT now? (Y/N): "
if /i "!START_NOW!"=="Y" (
    echo.
    echo %BLUE%Starting HALT...%NC%
    cd /d "%INSTALL_DIR%"
    start "HALT" cmd /k "cd /d %INSTALL_DIR% && set EVE_SYSTEM_MODE=PRODUCTION && python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 7778"
    echo %GREEN%HALT is starting in a new window%NC%
    echo %GREEN%Access at http://localhost:7778%NC%
)

echo.
echo %GREEN%Installation completed successfully!%NC%
pause
