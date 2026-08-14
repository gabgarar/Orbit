@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-real-data.ps1" %*
if errorlevel 1 pause
