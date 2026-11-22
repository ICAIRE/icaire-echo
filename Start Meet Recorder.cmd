@echo off
rem Double-click to start Meet Recorder on Windows. The first time, it installs what it needs.
cd /d "%~dp0"
title Meet Recorder

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed. Installing it with winget...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not install Node.js. The download page is opening: install it, then open this again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

rem Install the app's parts the first time, and again whenever an update changed them.
set "MRB_ARGS="
:start
fc /b package-lock.json node_modules\.mrb-installed >nul 2>nul
if errorlevel 1 (
  echo Installing the app, one time, about a minute...
  call npm ci --no-fund --no-audit --loglevel=error
  if errorlevel 1 (
    echo The install stopped. Check the internet connection and open this again.
    pause
    exit /b 1
  )
  copy /y package-lock.json node_modules\.mrb-installed >nul
)

node setup.js
echo.
node server.js %MRB_ARGS%
rem The app ends with code 75 after it has updated itself: start it again (no new browser tab, the page reloads).
if %errorlevel% equ 75 goto restart
pause
exit /b

:restart
echo Updated. Starting again...
set "MRB_ARGS=--no-open"
goto start
