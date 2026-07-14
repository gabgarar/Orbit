@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-backend.ps1" %*
if errorlevel 1 pause
