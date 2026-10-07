@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Massanger

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не установлен. Скачай LTS-версию с https://nodejs.org и запусти этот файл снова.
  pause
  exit /b 1
)

echo Проверяю зависимости...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo Не получилось установить зависимости. Пришли текст ошибки выше.
  pause
  exit /b 1
)

echo.
echo  Massanger запускается, браузер откроется сам.
echo  НЕ ЗАКРЫВАЙ это окно, пока пользуешься приложением.
echo  Остановить: Ctrl+C или просто закрыть окно.
echo.
call npm run dev
pause
