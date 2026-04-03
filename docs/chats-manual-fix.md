# chats.ts 手动修改说明

## 问题
当 delegate_to_agent 工具调用失败时，前端已经收到了部分内容，但数据库保存的是错误信息，导致前端无法正确显示。

## 需要修改的位置

### ✅ 修改 1: 已完成
**位置**: 约第 1425 行
**状态**: 已添加

```typescript
let partialContent = ''; // 保存工具调用时已发送的部分内容
```

### ❌ 修改 2: 待手动添加
**位置**: 约第 1511 行
**查找**: `if (message.content) { reply.raw.write`

**原代码**:
```typescript
if (message.content) {
  reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
}
```

**修改为**:
```typescript
if (message.content) {
  partialContent = message.content; // 保存部分内容
  reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
}
```

### ❌ 修改 3: 待手动添加
**位置**: 约第 1650 行
**查找**: `if (fullAssistantContent) {`

**原代码**:
```typescript
if (fullAssistantContent) {
  reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
  await DbService.addMessageToChat(chatId, { role: 'assistant', content: fullAssistantContent });
}
```

**修改为**:
```typescript
// 使用完整的响应内容，如果没有则使用已发送的部分内容
const finalContent = fullAssistantContent || partialContent;
if (finalContent) {
  if (!fullAssistantContent && partialContent) {
    // 如果只有部分内容，添加说明
    reply.raw.write(`data: ${JSON.stringify({ 
      chunk: partialContent + '\n\n⚠️ 注意：部分操作未能完成，以上是已生成的内容。' 
    })}\n\n`);
  } else {
    reply.raw.write(`data: ${JSON.stringify({ chunk: finalContent })}\n\n`);
  }
  await DbService.addMessageToChat(chatId, { role: 'assistant', content: finalContent });
}
```

## 修改步骤

1. 打开文件: `D:\workspace\my-openclaw\backend\src\routes\chats.ts`
2. 搜索 `if (message.content) {` 找到第一个匹配（约第 1511 行）
3. 在 `reply.raw.write` 前添加 `partialContent = message.content;`
4. 搜索 `if (fullAssistantContent) {` 找到匹配（约第 1650 行）
5. 替换整个 if 块为上面的新代码
6. 保存文件
7. 重启后端服务

## 验证修改

修改完成后，重启后端：
```bash
cd D:\workspace\my-openclaw\backend
npm run dev
```

然后测试：
1. 发送一个会触发 delegate_to_agent 的请求
2. 即使委派失败，前端应该显示已生成的部分内容
3. 数据库应该保存已发送的内容，而不是错误信息
