@echo off
setlocal

if /i "%1"=="update" (
    echo openclaw is managed by StoryClaw ^(bundled version^).
    echo.
    echo To update openclaw, update StoryClaw:
    echo   Open StoryClaw ^> Settings ^> Check for Updates
    exit /b 0
)

rem Switch console to UTF-8 so Unicode box-drawing and CJK text render correctly
rem on non-English Windows (e.g. Chinese CP936). Save the previous codepage to restore later.
for /f "tokens=2 delims=:." %%a in ('chcp') do set /a "_CP=%%a" 2>nul
chcp 65001 >nul 2>&1

rem This wrapper is installed at: resources\cli\openclaw.cmd
rem Electron binary is 2 levels up:  ..\..\  = appOutDir\
rem openclaw.mjs is 1 level up:      ..\     = process.resourcesPath\
set ELECTRON_RUN_AS_NODE=1
set OPENCLAW_EMBEDDED_IN=StoryClaw
"%~dp0..\..\StoryClaw.exe" "%~dp0..\openclaw\openclaw.mjs" %*
set _EXIT=%ERRORLEVEL%

if defined _CP chcp %_CP% >nul 2>&1

endlocal & exit /b %_EXIT%
