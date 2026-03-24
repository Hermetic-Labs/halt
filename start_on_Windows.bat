@echo off
title HALT - Medical Triage (Dev)
echo.
echo                                        ###############################
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                        ##                           ##
echo                                       +*##############################
echo                                     *+++
echo                                    +++
echo                                  +++
echo                             *+++++
echo                            +++++++
echo                            +++++++
echo                             ++++++                                   +++
echo                                  +++                                ++ ++
echo                                    +++                              +++++
echo                                     ++++                          +++
echo                                       +++                       *++
echo                                         +++                   *++*
echo                                           +++                +++
echo                                             +++            +++
echo                                               ++*        +++
echo                                                ++++    +++*
echo                                                  +++ *+++
echo                                                    ++++
echo                                           ######################
echo                                          ###                  ###
echo                                         ###                    ####
echo                                        ###                      ###
echo                                       ###                        ###
echo                                      ###                          ####
echo                                     ###                             ###
echo                                    ###                               ###
echo                                   ###                                 ###
echo                                  ###                                  ###
echo                                   ###                                ###
echo                                    ###                              ###
echo                                     ###                            ####
echo                                      ###                          ###
echo                                       ###                        ###
echo                                        ###                      ###
echo                                         ###                    ###
echo                                          ###                  ###
echo                                            #####################
echo.
echo   ============================================
echo     HALT - Medical Triage  [DEV MODE]
echo   ============================================
echo.

:: ── Resolve paths relative to this script ────────────────────────────────────
set SCRIPT_DIR=%~dp0
set PYTHON=%SCRIPT_DIR%runtime\python\python.exe
set API_DIR=%SCRIPT_DIR%api
set PORT=7778
set URL=http://127.0.0.1:%PORT%

:: ── Preflight ────────────────────────────────────────────────────────────────
if not exist "%PYTHON%" (
    echo   [ERROR] Portable Python not found at:
    echo          %PYTHON%
    echo          Make sure runtime\python\ is present.
    pause
    exit /b 1
)
if not exist "%API_DIR%\main.py" (
    echo   [ERROR] Backend not found at:
    echo          %API_DIR%\main.py
    pause
    exit /b 1
)

:: ── Kill stale processes on our port ─────────────────────────────────────────
echo   [1/3] Clearing port %PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ── Start backend in its own window ──────────────────────────────────────────
echo   [2/3] Starting backend on port %PORT% (--reload)...
start "HALT Dev Server" /d "%API_DIR%" "%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port %PORT% --reload

:: ── Wait for health ──────────────────────────────────────────────────────────
set ATTEMPTS=0
:healthcheck
set /a ATTEMPTS+=1
timeout /t 2 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest -Uri '%URL%/health' -TimeoutSec 2 -UseBasicParsing; if($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 goto :ready
if %ATTEMPTS% geq 30 (
    echo   [ERROR] Backend did not respond after 60 seconds.
    pause
    exit /b 1
)
echo          attempt %ATTEMPTS%...
goto :healthcheck

:ready
echo   [OK]   Backend ready after %ATTEMPTS% checks.
echo   [3/3] Opening browser...
start "" "%URL%"

echo.
echo   ============================================
echo     HALT is running  -  %URL%
echo     --reload active  -  edit Python, save, done
echo     Close the "HALT Dev Server" window to stop.
echo   ============================================
