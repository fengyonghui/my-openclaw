/**
 * chats.ts 补丁 - 修复工具调用失败时前端不显示内容的问题
 * 
 * 问题：当 delegate_to_agent 等工具调用失败时，SSE 流已发送部分内容到前端，
 * 但最终抛出错误，导致数据库保存的是错误信息而不是已发送的内容。
 * 
 * 解决方案：保存工具调用时已发送的部分内容，在最终失败时使用。
 */

// ============================================
// 修改 1: 添加 partialContent 变量
// ============================================

// 找到这行（约第 1431 行）：
// let success = false;
// let lastError = '';

// 替换为：
let success = false;
let lastError = '';
let partialContent = ''; // 保存工具调用时已发送的部分内容

// ============================================
// 修改 2: 保存工具调用时的部分内容
// ============================================

// 找到这段代码（约第 1510 行）：
// 发送助手消息（包含工具调用）到前端
if (message.content) {
  reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
}

// 替换为：
// 发送助手消息（包含工具调用）到前端
if (message.content) {
  partialContent = message.content; // 保存部分内容
  reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
}

// ============================================
// 修改 3: 在最终失败时使用部分内容
// ============================================

// 找到这段代码（约第 1650 行）：
if (fullAssistantContent) {
  reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
  await DbService.addMessageToChat(chatId, { role: 'assistant', content: fullAssistantContent });
}

// 替换为：
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

// ============================================
// 完整的修改位置
// ============================================

/*
1. 第 1431 行附近：
   let success = false;
   let lastError = '';
   + let partialContent = '';

2. 第 1512 行附近：
   if (message.content) {
   +  partialContent = message.content;
     reply.raw.write(...)
   }

3. 第 1650 行附近：
   + const finalContent = fullAssistantContent || partialContent;
   - if (fullAssistantContent) {
   + if (finalContent) {
   +   if (!fullAssistantContent && partialContent) {
   +     reply.raw.write(...partialContent + '警告信息'...)
   +   } else {
       reply.raw.write(...finalContent...)
   +   }
   -   await DbService.addMessageToChat(...fullAssistantContent...)
   +   await DbService.addMessageToChat(...finalContent...)
     }
*/