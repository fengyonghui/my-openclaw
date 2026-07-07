#!/bin/bash
# ============================================
# my-openclaw - Linux/WSL 一键启动脚本
# 运行: chmod +x start-linux.sh && ./start-linux.sh
# ============================================

echo "============================================"
echo "  my-openclaw Startup Script (Linux/WSL)"
echo "============================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found. Please install Node.js 18+ first."
    echo "        https://nodejs.org"
    read -p "Press Enter to exit"
    exit 1
fi

echo "[OK] Node.js version: $(node --version)"
echo ""

# 安装依赖（如果 node_modules 不存在）
if [ ! -d "backend/node_modules" ]; then
    echo "[INFO] Installing backend dependencies..."
    cd backend
    npm install --registry https://registry.npmjs.org/
    cd ..
    echo ""
fi

# 启动后端
echo "[INFO] Starting server on http://localhost:3001"
echo "        Press Ctrl+C to stop"
echo ""
cd backend
npm start
