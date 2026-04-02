# 流式响应集成说明

## 当前状态

流式响应的基础设施已就绪：
- `StreamingService.ts` - SSE 流解析服务
- `StreamingChatHandler.ts` - 流式聊天处理服务
- `streaming.config.ts` - 配置文件

## 如何启用流式模式

### 方法 1：环境变量（推荐）

在启动后端前设置环境变量：

```bash
# Windows CMD
set USE_STREAMING=true

# Windows PowerShell
$env:USE_STREAMING="true"

# Linux/Mac
export USE_STREAMING=true
```

### 方法 2：修改配置文件

编辑 `backend/src/config/streaming.config.ts`：

```typescript
export const STREAMING_ENABLED = true; // 改为 true
```

## 集成到 chats.ts

要在 chats.ts 中启用流式模式，需要修改模型调用部分：

```typescript
// 在文件开头添加导入
import { handleChatRequest } from '../services/StreamingChatHandler.js';
import STREAMING_CONFIG from '../config/streaming.config.js';

// 在模型调用循环中，替换现有的请求逻辑：
if (STREAMING_CONFIG.enabled) {
  // 使用流式处理
  const result = await handleChatRequest(
    apiUrl,
    modelCfg,
    finalMessages,
    tools,
    { project, allProjectAgents, allEnabledSkills, reply, abortController },
    executeToolCall,
    extractToolCalls
  );
  // 处理结果...
} else {
  // 使用现有的非流式逻辑
  // ... existing code ...
}
```

## 注意事项

1. 流式模式需要模型 API 支持 `stream: true`
2. 工具调用在流式模式下会被正确处理
3. 前端需要正确处理 SSE 事件流

## 测试流式模式

重启后端后，检查日志：

```
[Chat] Streaming mode: ENABLED
[Streaming] Starting streaming chat with model: xxx
```

## 版本历史

- v0.2.9 - 流式响应基础设施
- v0.3.0 - StreamingChatHandler 服务
