@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
set "TASSEL_START_EXIT=%ERRORLEVEL%"
if not "%TASSEL_START_EXIT%"=="0" if "%~1"=="" pause
exit /b %TASSEL_START_EXIT%
