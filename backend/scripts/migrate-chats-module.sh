#!/bin/bash
# chats.ts 模块化迁移脚本
# 
# 将原来 1700+ 行的 chats.ts 拆分成多个模块

set -e

echo "=========================================="
echo "📦 chats.ts 模块化迁移"
echo "=========================================="
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROUTES_DIR="$(dirname "$SCRIPT_DIR")/src/routes"

echo "📁 路由目录: $ROUTES_DIR"
echo ""

# 1. 检查模块目录
CHATS_DIR="$ROUTES_DIR/chats"

if [ -d "$CHATS_DIR" ]; then
  echo "✅ 模块目录已存在: $CHATS_DIR"
else
  echo "📁 创建模块目录..."
  mkdir -p "$CHATS_DIR"
fi

echo ""

# 2. 检查模块文件
echo "2️⃣ 检查模块文件..."

MODULES=(
  "ChatAbortController.ts"
  "MemoryFileHandler.ts"
  "ToolExecutor.ts"
  "ChatMessageBuilder.ts"
  "ModelRequestor.ts"
  "index.ts"
)

for module in "${MODULES[@]}"; do
  if [ -f "$CHATS_DIR/$module" ]; then
    echo "  ✅ $module"
  else
    echo "  ❌ 缺少 $module"
  fi
done

echo ""

# 3. 备份原文件
echo "3️⃣ 备份原文件..."

ORIGINAL_FILE="$ROUTES_DIR/chats.ts"
BACKUP_FILE="$ROUTES_DIR/chats.ts.backup"

if [ -f "$ORIGINAL_FILE" ]; then
  cp "$ORIGINAL_FILE" "$BACKUP_FILE"
  echo "  ✅ 已备份到: $BACKUP_FILE"
else
  echo "  ⚠️ 原文件不存在: $ORIGINAL_FILE"
fi

echo ""

# 4. 检查新文件
echo "4️⃣ 检查新文件..."

NEW_FILE="$ROUTES_DIR/chats.new.ts"

if [ -f "$NEW_FILE" ]; then
  echo "  ✅ 新文件存在: $NEW_FILE"
  echo ""
  echo "📋 迁移步骤:"
  echo "  1. 验证新模块是否正常工作"
  echo "  2. 运行 TypeScript 编译检查: npx tsc --noEmit"
  echo "  3. 确认无误后，替换原文件:"
  echo "     mv $NEW_FILE $ORIGINAL_FILE"
  echo "  4. 重启后端服务"
else
  echo "  ❌ 新文件不存在: $NEW_FILE"
fi

echo ""

# 5. 显示文件大小对比
echo "5️⃣ 文件大小对比..."

if [ -f "$BACKUP_FILE" ]; then
  OLD_LINES=$(wc -l < "$BACKUP_FILE")
  echo "  📄 原文件: $OLD_LINES 行"
fi

if [ -f "$NEW_FILE" ]; then
  NEW_LINES=$(wc -l < "$NEW_FILE")
  echo "  📄 新文件: $NEW_LINES 行"
fi

if [ -d "$CHATS_DIR" ]; then
  MODULE_LINES=$(find "$CHATS_DIR" -name "*.ts" -exec wc -l {} + | tail -1 | awk '{print $1}')
  echo "  📁 模块文件总行数: $MODULE_LINES 行"
fi

echo ""

# 完成
echo "=========================================="
echo "✅ 迁移检查完成！"
echo "=========================================="
