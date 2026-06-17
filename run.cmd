@echo off
setlocal
cd /d "%~dp0"

:: ====== Find Node.js ======
set "NODE_EXE="

:: 1. Try PATH first
where node >nul 2>&1
if %errorlevel% equ 0 (
  for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i"
  goto :found
)

:: 2. Common install locations
for %%d in (
  "%ProgramFiles%\nodejs"
  "%ProgramFiles(x86)%\nodejs"
  "%LocalAppData%\Programs\Microsoft VS Code\resources\app\extensions\ms-vscode.js-debug\src\bootloader.bundle.js"
) do (
  if exist "%%d\node.exe" set "NODE_EXE=%%d\node.exe" && goto :found
)

:: 3. Not found
echo ============================================
echo   Node.js 未找到！
echo   请从 https://nodejs.org 下载安装 Node.js ^(≥18^)
echo   安装时勾选 "Add to PATH"
echo ============================================
pause
exit /b 1

:found
echo Node.js: "%NODE_EXE%"
for /f "tokens=*" %%v in ('"%NODE_EXE%" -v 2^>^&1') do echo Version: %%v

:: ====== Install dependencies ======
if not exist node_modules\ (
  echo.
  echo Installing dependencies...
  call "%NODE_EXE%" npm install
  if errorlevel 1 (
    echo npm install 失败，请检查网络连接后重试
    pause
    exit /b 1
  )
)

:: ====== Start ======
echo.
echo ============================================
echo   Keep-FIT-Generator v1.0.0
echo   按住鼠标左键在地图上拖动绘制跑步路线
echo ============================================
echo.
echo Starting server on http://localhost:3000 ...
start http://localhost:3000
"%NODE_EXE%" server.js

endlocal
