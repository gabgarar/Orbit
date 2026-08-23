@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0zeroize-orbit.ps1" %*
if errorlevel 1 pause
