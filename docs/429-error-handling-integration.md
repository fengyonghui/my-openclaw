# 429 错误处理集成说明

## 已完成的工作

### 1. 创建的服务文件

#### RateLimitHandler.ts
位置: `/mnt/d/workspace/my-openclaw/backend/src/services/RateLimitHandler.ts`

功能:
- `parseApiError(error)` - 解析 API 错误，检测 429
- `isModelRateLimited(modelId)` - 检查模型是否处于限流状态
- `setModelRateLimited(modelId, info)` - 记录模型限流状态
- `calculateBackoff(attempt)` - 计算指数退避时间

#### ModelRequestHandler.ts
位置: `/mnt/d/workspace/my-openclaw/backend/src/services/ModelRequestHandler.ts`

功能:
- `makeModelRequest()` - 增强的模型请求处理器
- `makeStreamingModelRequest()` - SSE 流式请求支持

### 2. 修改的文件

#### chats.ts
位置: `/mnt/d/workspace/my-openclaw/backend/src/routes/chats.ts`

已添加导入:
```typescript
import { parseApiError, isModelRateLimited, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';
```

## 需要手动集成的部分

由于文件编辑问题，需要手动在 chats.ts 中修改 catch 块：

### 原代码 (约第 1595 行):
```typescript
} catch (err: any) {
  modelRetryCount++;
  console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
  lastError = err.message;
  if (modelRetryCount < MAX_RETRIES) {
    console.log(`[Model] Retrying ${modelCfg.name} in ${RETRY_DELAY_MS}ms...`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
```

### 替换为:
```typescript
} catch (err: any) {
  modelRetryCount++;
  console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
  lastError = err.message;
  
  // --- 429 错误专门处理 ---
  const rateLimitInfo = parseApiError(err);
  if (rateLimitInfo?.isRateLimited) {
    // 记录模型的限流状态
    setModelRateLimited(modelCfg.id, rateLimitInfo);
    console.log(`[429] ${modelCfg.name} rate limited. Reset at: ${rateLimitInfo.resetTime?.toISOString()}`);
    
    // 通知前端
    reply.raw.write(`data: ${JSON.stringify({ 
      type: 'rate_limit',
      model: modelCfg.name,
      retryAfter: rateLimitInfo.retryAfter,
      message: `⚠️ 模型 ${modelCfg.name} 触发限流，正在切换备用模型...`
    })}\n\n`);
    
    // 如果有限流等待时间，使用该时间；否则使用指数退避
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

## 处理流程

1. **请求发送** → 检查响应状态
2. **429 错误** → 解析 Retry-After 头，记录限流状态
3. **通知前端** → 发送 SSE 事件，显示切换提示
4. **等待重试** → 使用 Retry-After 或指数退避
5. **切换模型** → 超过重试次数后自动切换备用模型

## 前端处理建议

在前端添加对 `rate_limit` 事件的处理：

```typescript
// 在 SSE 消息处理中添加
if (event.type === 'rate_limit') {
  showToast({
    message: event.message,
    type: 'warning',
    duration: 5000
  });
}
```

## 配置选项

可以在项目配置中添加以下选项：

```json
{
  "rateLimit": {
    "maxRetries": 3,
    "baseDelayMs": 1000,
    "maxDelayMs": 30000,
    "cacheTTL": 300000
  }
}
```
