@echo off
cd /d "%~dp0"
title Nuntius
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install the LTS version from https://nodejs.org and run start.bat again.
  echo.
  pause
  exit /b 1
)
node scripts\start.mjs
echo.
pause
