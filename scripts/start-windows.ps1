# ============================================
# my-openclaw - Windows 一键启动脚本 (PowerShell)
# 右键 "使用 PowerShell 运行" 或双击运行
# ============================================

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  my-openclaw Startup Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found. Please install Node.js 18+ first." -ForegroundColor Red
    Write-Host "        https://nodejs.org" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# 安装依赖（如果 node_modules 不存在）
$backendModules = Join-Path $PSScriptRoot "backend\node_modules"
if (-not (Test-Path $backendModules)) {
    Write-Host "[INFO] Installing backend dependencies..." -ForegroundColor Yellow
    Set-Location (Join-Path $PSScriptRoot "backend")
    npm install --registry https://registry.npmjs.org/
    Set-Location $PSScriptRoot
    Write-Host ""
}

# 启动后端
Write-Host "[INFO] Starting server on http://localhost:3001" -ForegroundColor Green
Write-Host "        Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""
Set-Location (Join-Path $PSScriptRoot "backend")
npm start
