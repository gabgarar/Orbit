@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0orbit-logs.ps1"
if errorlevel 1 pause
