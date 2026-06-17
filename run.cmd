@echo off
setlocal
cd /d "%~dp0"

set "NODE_DIR=%~dp0..\Fit+Tool+v1.2(1)\Fit Tool v1.2\node-v24.12.0-win-x64"
if not exist "%NODE_DIR%\node.exe" (
  echo Node.js not found at "%NODE_DIR%"
  echo Please ensure Fit Tool v1.2 is installed.
  pause
  exit /b 1
)

echo Using bundled Node from "%NODE_DIR%"...
set "PATH=%NODE_DIR%;%PATH%"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo   Keep-FIT-Generator v1.0.0
echo   按住鼠标左键在地图上拖动绘制跑步路线
echo ============================================
echo.
echo Starting server on http://localhost:3000 ...
start http://localhost:3000
npm start

endlocal
