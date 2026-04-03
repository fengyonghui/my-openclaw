#!/bin/bash
# 429 错误处理单元测试运行脚本

echo "🧪 Running RateLimitHandler Tests..."
echo ""

# 检查是否安装了 vitest
if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Please install Node.js"
    exit 1
fi

# 运行测试
cd "$(dirname "$0")/../backend"

# 安装依赖（如果需要）
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 安装 vitest（如果需要）
if ! npx vitest --version &> /dev/null; then
    echo "📦 Installing vitest..."
    npm install -D vitest
fi

echo ""
echo "🚀 Starting tests..."
echo ""

# 运行测试
npx vitest run src/__tests__/RateLimitHandler.test.ts --reporter=verbose

echo ""
echo "✅ Tests completed!"
