@echo off
rem Meet Recorder installer for Windows. Double-click it. It downloads the app into your user folder
rem ("Meet Recorder"), puts a "Meet Recorder" shortcut on the Desktop, and starts it.
title Meet Recorder installer
set "DEST=%LOCALAPPDATA%\Meet Recorder"
if defined MRB_INSTALL_DIR set "DEST=%MRB_INSTALL_DIR%"

echo Installing Meet Recorder into: %DEST%
if exist "%DEST%\server.js" (
  echo It is already installed. Starting it, it updates itself.
) else (
  echo Downloading the app...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; $t=Join-Path $env:TEMP ('mrb-'+[guid]::NewGuid()); New-Item -ItemType Directory $t | Out-Null;" ^
    "Invoke-WebRequest -UseBasicParsing 'https://codeload.github.com/ICAIRE/meet-recorder-bot/zip/refs/heads/main' -OutFile (Join-Path $t 'app.zip');" ^
    "Expand-Archive (Join-Path $t 'app.zip') $t; New-Item -ItemType Directory -Force $env:DEST | Out-Null;" ^
    "Copy-Item (Join-Path $t 'meet-recorder-bot-main\*') $env:DEST -Recurse -Force; Remove-Item $t -Recurse -Force"
  if errorlevel 1 (
    echo The download stopped. Check the internet connection and run this again.
    pause
    exit /b 1
  )
)

rem a shortcut on the Desktop that starts the app
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Meet Recorder.lnk');" ^
  "$s.TargetPath=$env:DEST+'\Start Meet Recorder.cmd'; $s.WorkingDirectory=$env:DEST; $s.Save()"
echo Added "Meet Recorder" to your Desktop: double-click it to start the app next time.
echo.
cd /d "%DEST%"
call "Start Meet Recorder.cmd"
