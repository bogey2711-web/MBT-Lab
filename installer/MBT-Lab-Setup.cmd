@echo off
rem MBT Lab installer launcher. Double-click to install or update; run "MBT-Lab-Setup.cmd uninstall" to remove.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0MBT-Lab-Setup.ps1" %1
echo.
pause
