@echo off
rem Runs penny.ps1 without the "running scripts is disabled" problem:   penny up   /   .\penny down
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0penny.ps1" %*
exit /b %ERRORLEVEL%
