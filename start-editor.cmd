@echo off
setlocal
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo WSL is required. See README.md for setup.
  pause
  exit /b 1
)
wsl.exe --cd "%~dp0." --exec sh ./start-editor.sh
if errorlevel 1 (
  echo Could not start AIFUDE. Check Node.js, dependencies and the default WSL distribution.
  pause
  exit /b 1
)
