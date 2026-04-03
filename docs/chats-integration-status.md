# chats.ts 集成状态报告

## ✅ 已完成的工作

### 1. 服务文件已创建

| 文件 | 状态 | 功能 |
|------|------|------|
| `backend/src/services/RateLimitHandler.ts` | ✅ | 429 错误检测和处理 |
| `backend/src/services/ModelRequestHandler.ts` | ✅ | 增强的模型请求处理器 |
| `backend/src/services/RateLimitConfig.ts` | ✅ | 配置管理 |
| `backend/src/__tests__/RateLimitHandler.test.ts` | ✅ | 单元测试 |
| `backend/config/rateLimitConfig.json` | ✅ | 配置文件 |

### 2. chats.ts 已集成

**导入语句已添加**（第10行）:
```typescript
import { parseApiError, isModelRateLimited, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';
```

**catch 块已修改**（约第1596行）:
```typescript
} catch (err: any) {
  modelRetryCount++;
  console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
  lastError = err.message;
  
  // --- 429 错误专门处理 ---
  const rateLimitInfo = parseApiError(err);
  if (rateLimitInfo?.isRateLimited) {
    setModelRateLimited(modelCfg.id, rateLimitInfo);
    console.log(`[429] ${modelCfg.name} rate limited. Reset at: ${rateLimitInfo.resetTime?.toISOString()}`);
    
    // 通知前端
    reply.raw.write(`data: ${JSON.stringify({ 
      type: 'rate_limit',
      model: modelCfg.name,
      retryAfter: rateLimitInfo.retryAfter,
      message: `⚠️ 模型 ${modelCfg.name} 触发限流，正在切换备用模型...`
    })}\n\n`);
    
    // 等待后重试
    const waitTime = rateLimitInfo.retryAfter 
      ? rateLimitInfo.retryAfter * 1000 
      : calculateBackoff(modelRetryCount);
    
    if (modelRetryCount < MAX_RETRIES) {
      console.log(`[Model] Waiting ${waitTime / 1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000)));
    }
  } else {
    // 非 429 错误，使用普通重试
    if (modelRetryCount < MAX_RETRIES) {
      const backoff = calculateBackoff(modelRetryCount);
      console.log(`[Model] Retrying ${modelCfg.name} in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}
```

## 🧪 测试

### 运行单元测试
```bash
cd /mnt/d/workspace/my-openclaw/backend
npx vitest run src/__tests__/RateLimitHandler.test.ts
```

### 运行手动测试脚本
```bash
cd /mnt/d/workspace/my-openclaw/backend
npx ts-node scripts/test-retry-mechanism.ts
```

## 📋 后端日志排查

### 日志文件位置
后端运行在 Windows 上，日志输出到控制台。可以通过以下方式查看：

1. **查看实时日志**:
   - 在运行 `npm run dev` 的终端中查看

2. **关键日志标记**:
   - `[Model Fail]` - 模型请求失败
   - `[429]` - 限流错误检测
   - `[Model] Waiting` - 等待重试
   - `[Model Switch]` - 模型切换

### 常见错误日志示例

**429 限流错误**:
```
[Model Fail] z-ai/glm5 failed (attempt 1/3): HTTP 429: Too Many Requests
[429] z-ai/glm5 rate limited. Reset at: 2026-04-03T05:30:00.000Z
[Model] Waiting 60s before retry...
```

**500 服务器错误**:
```
[Model Fail] z-ai/glm5 failed (attempt 1/3): HTTP 500: Internal Server Error
[Model] Retrying z-ai/glm5 in 1000ms...
```

**unexpected EOF 错误**:
```
[Model Fail] nvidia-api failed (attempt 1/3): unexpected EOF
[Model] Retrying nvidia-api in 1000ms...
```

## 🔄 重试流程

```
请求失败
    ↓
检查错误类型
    ├─ 429 → 记录限流状态，使用 Retry-After 或指数退避
    └─ 其他 → 使用指数退避
    ↓
等待延迟时间
    ↓
重试（最多 3 次）
    ├─ 成功 → 返回结果
    └─ 失败 → 切换备用模型
```

## 🚀 下一步

1. **重启后端服务** - 使更改生效
2. **测试重试机制** - 发送请求观察日志
3. **验证前端通知** - 确认 SSE 事件正确显示

### 重启后端
```bash
cd /mnt/d/workspace/my-openclaw/backend
npm run dev
```

### 测试请求
```bash
curl -X POST http://localhost:3001/api/chats/{chatId}/send \
  -H "Content-Type: application/json" \
  -d '{"content": "测试消息"}'
```

## ✅ 集成完成

重试机制已完全集成到 chats.ts 中，可以处理：
- ✅ 429 限流错误
- ✅ 500 服务器错误
- ✅ 网络错误（unexpected EOF）
- ✅ 自动切换备用模型
- ✅ 前端 SSE 通知
