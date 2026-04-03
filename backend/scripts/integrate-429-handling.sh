#!/bin/bash
# my-openclaw 429 错误处理自动集成脚本
# 运行方式: cd /mnt/d/workspace/my-openclaw/backend && ./scripts/integrate-429-handling.sh

set -e

echo "=========================================="
echo "🔧 429 错误处理集成脚本"
echo "=========================================="
echo ""

# 获取脚本所在目录的父目录（backend）
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND_DIR"

echo "📁 工作目录: $BACKEND_DIR"
echo ""

# 1. 检查必要的服务文件
echo "1️⃣ 检查服务文件..."

SERVICES_DIR="src/services"
REQUIRED_FILES=(
  "RateLimitHandler.ts"
  "ModelRequestHandler.ts"
  "RateLimitConfig.ts"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$SERVICES_DIR/$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ 缺少 $file"
    exit 1
  fi
done

echo ""

# 2. 检查测试文件
echo "2️⃣ 检查测试文件..."

TEST_FILE="src/__tests__/RateLimitHandler.test.ts"
if [ -f "$TEST_FILE" ]; then
  echo "  ✅ $TEST_FILE"
else
  echo "  ⚠️ 测试文件不存在，跳过"
fi

echo ""

# 3. 检查配置文件
echo "3️⃣ 检查配置文件..."

CONFIG_FILE="config/rateLimitConfig.json"
if [ -f "$CONFIG_FILE" ]; then
  echo "  ✅ $CONFIG_FILE"
else
  echo "  ⚠️ 配置文件不存在，使用默认配置"
fi

echo ""

# 4. 应用 chats.ts 补丁
echo "4️⃣ 应用 chats.ts 补丁..."

CHATS_FILE="src/routes/chats.ts"
if [ -f "$CHATS_FILE" ]; then
  # 检查是否已应用
  if grep -q "// --- 429 错误专门处理 ---" "$CHATS_FILE"; then
    echo "  ✅ 补丁已应用"
  else
    echo "  📝 需要手动应用补丁"
    echo "  请运行: npx ts-node scripts/apply-429-patch.ts"
  fi
else
  echo "  ❌ 找不到 $CHATS_FILE"
  exit 1
fi

echo ""

# 5. 检查导入语句
echo "5️⃣ 检查导入语句..."

if grep -q "parseApiError" "$CHATS_FILE" && grep -q "RateLimitHandler" "$CHATS_FILE"; then
  echo "  ✅ 导入语句已添加"
else
  echo "  ⚠️ 导入语句可能需要手动添加"
  echo "  请在文件开头添加:"
  echo "  import { parseApiError, isModelRateLimited, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';"
fi

echo ""

# 6. 编译检查
echo "6️⃣ TypeScript 编译检查..."

if command -v npx &> /dev/null; then
  npx tsc --noEmit 2>&1 | head -20 || true
  echo "  ✅ 编译检查完成"
else
  echo "  ⚠️ 未找到 npx，跳过编译检查"
fi

echo ""

# 7. 运行测试
echo "7️⃣ 运行单元测试..."

if command -v npx &> /dev/null && [ -f "$TEST_FILE" ]; then
  npx vitest run "$TEST_FILE" --reporter=basic 2>&1 || echo "  ⚠️ 测试运行失败，请检查"
else
  echo "  ⚠️ 跳过测试"
fi

echo ""

# 完成
echo "=========================================="
echo "✅ 集成检查完成！"
echo "=========================================="
echo ""
echo "📋 后续步骤:"
echo ""
echo "  1. 如果补丁未应用，请手动编辑 chats.ts"
echo "     参考: backend/patches/apply-429-handling.ts"
echo ""
echo "  2. 重启后端服务"
echo "     npm run dev"
echo ""
echo "  3. 测试 429 错误处理"
echo "     curl -X POST http://localhost:3001/api/chats/test/send"
echo ""
