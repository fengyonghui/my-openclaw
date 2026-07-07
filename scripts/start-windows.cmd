@echo off
REM ============================================
REM my-openclaw - Windows 一键启动脚本 (CMD)
REM 双击运行即可启动后端服务
REM ============================================

echo ============================================
echo  my-openclaw v%VERSION%
echo  Windows Startup Script
echo ============================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ first.
    echo         https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js version:
node --version
echo.

REM 安装依赖（如果 node_modules 不存在）
if not exist "backend\node_modules" (
    echo [INFO] Installing backend dependencies...
    cd /d "%~dp0backend"
    npm install --registry https://registry.npmjs.org/
    cd /d "%~dp0"
    echo.
)

REM 启动后端（同时 serve 前端静态文件）
echo [INFO] Starting server on http://localhost:3001
echo        Press Ctrl+C to stop
echo.
cd /d "%~dp0backend"
npm start
