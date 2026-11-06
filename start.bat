@echo off
cd /d "%~dp0"
where powershell.exe >nul 2>nul
if errorlevel 1 goto plain
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-colored.ps1"
goto finish

:plain
echo Starting SYNTHNET (run this as Administrator)...
node server.js

:finish
pause
