# ============================================
# my-openclaw - Windows Startup Script (PowerShell)
# Right-click "Run with PowerShell" or double-click
# ============================================

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  my-openclaw Startup Script" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
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

# Install dependencies if node_modules is missing
$backendModules = Join-Path $PSScriptRoot "backend\node_modules"
if (-not (Test-Path $backendModules)) {
    Write-Host "[INFO] Installing backend dependencies..." -ForegroundColor Yellow
    Set-Location (Join-Path $PSScriptRoot "backend")
    npm install --registry https://registry.npmjs.org/
    Set-Location $PSScriptRoot
    Write-Host ""
}

# Start backend
Write-Host "[INFO] Starting server on http://localhost:3001" -ForegroundColor Green
Write-Host "        Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""
Set-Location (Join-Path $PSScriptRoot "backend")
npm start
