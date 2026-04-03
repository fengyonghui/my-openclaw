# chats.ts 模块化重构

## 概述

将原来 1700+ 行的 `chats.ts` 拆分成多个模块，提高代码可维护性和可读性。

## 模块结构

```
backend/src/routes/
├── chats.ts              # 主路由入口（简化版，~400行）
├── chats.ts.backup       # 原文件备份
└── chats/                # 模块目录
    ├── index.ts                   # 模块导出索引
    ├── ChatAbortController.ts     # SSE 停止控制
    ├── MemoryFileHandler.ts       # MEMORY.md 功能
    ├── ToolExecutor.ts            # 工具调用执行
    ├── ChatMessageBuilder.ts      # 消息构建器
    └── ModelRequestor.ts          # 模型请求器
```

## 模块说明

### 1. ChatAbortController.ts
**功能**: SSE 停止控制
- `setAbortController()` - 设置 abort 控制器
- `clearAbortController()` - 清理控制器
- `stopChat()` - 停止对话生成
- `getActiveChats()` - 获取活跃对话列表
- `isChatActive()` - 检查对话是否活跃

### 2. MemoryFileHandler.ts
**功能**: MEMORY.md 文件处理
- `saveToMemoryFile()` - 保存用户记忆到文件
- `loadMemoryFile()` - 加载项目 MEMORY.md
- `isMemoryTrigger()` - 检查是否触发记忆保存
- `extractMemoryContent()` - 提取记忆内容

### 3. ToolExecutor.ts
**功能**: 工具调用执行
- `executeToolCall()` - 执行工具调用的统一入口
- `executeShellCommand()` - 执行 Shell 命令
- `executePythonCommand()` - 执行 Python 命令
- `executeFileIO()` - 执行文件 IO 操作
- `executeAgentDelegation()` - 执行 Agent 委托

### 4. ChatMessageBuilder.ts
**功能**: 聊天消息构建
- `buildSystemMessage()` - 构建系统消息
- `transformMessage()` - 转换消息格式（支持多模态）
- `buildHistoryMessages()` - 构建历史消息
- `cleanMentions()` - 清理 @提及

### 5. ModelRequestor.ts
**功能**: 模型请求处理
- `makeModelRequest()` - 发送模型请求（带重试和故障转移）
- `extractToolCalls()` - 提取工具调用
- 支持多种模型响应格式（包括 MiniMax XML 格式）

## 优势

1. **可维护性**: 每个模块职责单一，易于理解和修改
2. **可测试性**: 可以独立测试每个模块
3. **可复用性**: 模块可以在其他项目中复用
4. **可扩展性**: 新功能可以添加到对应模块，不影响其他部分

## 迁移步骤

### 1. 运行迁移脚本
```bash
cd /mnt/d/workspace/my-openclaw/backend
./scripts/migrate-chats-module.sh
```

### 2. 验证编译
```bash
npx tsc --noEmit
```

### 3. 替换原文件
```bash
mv src/routes/chats.new.ts src/routes/chats.ts
```

### 4. 重启服务
```bash
npm run dev
```

## 兼容性

- 所有原有功能保持不变
- API 路由不变
- 导入路径需要更新为模块化路径

## 文件大小对比

| 文件 | 原始 | 重构后 |
|------|------|--------|
| chats.ts | 1724 行 | ~400 行 |
| ChatAbortController.ts | - | ~50 行 |
| MemoryFileHandler.ts | - | ~150 行 |
| ToolExecutor.ts | - | ~400 行 |
| ChatMessageBuilder.ts | - | ~150 行 |
| ModelRequestor.ts | - | ~300 行 |
| index.ts | - | ~30 行 |
| **总计** | 1724 行 | ~1480 行 |

虽然总行数相似，但每个模块都是独立、可维护的单元。

## 注意事项

1. **导入路径**: 使用 `./chats/index.js` 而不是 `./chats.js`
2. **类型导出**: 所有类型都从 `index.ts` 统一导出
3. **依赖注入**: 部分模块需要传入 project、agents 等上下文
