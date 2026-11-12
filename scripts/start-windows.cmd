@echo off
REM ============================================
REM my-openclaw - Windows Startup Script (CMD)
REM Double-click to start the backend server
REM ============================================

echo ============================================
echo  my-openclaw v%VERSION%
echo  Windows Startup Script
echo ============================================
echo.

REM Check Node.js
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

REM Install dependencies if node_modules is missing
if not exist "backend\node_modules" (
    echo [INFO] Installing backend dependencies...
    cd /d "%~dp0backend"
    npm install --registry https://registry.npmjs.org/
    cd /d "%~dp0"
    echo.
)

REM Start backend (also serves frontend static files)
echo [INFO] Starting server on http://localhost:3001
echo        Press Ctrl+C to stop
echo.
cd /d "%~dp0backend"
npm start
