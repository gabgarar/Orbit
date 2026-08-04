@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0orbit-status.ps1"
if errorlevel 1 pause
