/**
 * ChatAbortController - SSE 停止控制
 * 
 * 管理每个对话的 abort 控制器，用于停止生成
 */

// 存储每个对话的 abort 控制器
const chatAbortControllers = new Map<string, AbortController>();

/**
 * 设置 abort 控制器
 */
export function setAbortController(chatId: string, controller: AbortController): void {
  // 先取消之前的（如果存在）
  const existing = chatAbortControllers.get(chatId);
  if (existing) {
    try {
      existing.abort();
    } catch {}
  }
  chatAbortControllers.set(chatId, controller);
}

/**
 * 清理 abort 控制器
 */
export function clearAbortController(chatId: string): void {
  const existing = chatAbortControllers.get(chatId);
  if (existing) {
    try {
      existing.abort();
    } catch {}
    chatAbortControllers.delete(chatId);
  }
}

/**
 * 停止对话生成
 */
export function stopChat(chatId: string): boolean {
  const controller = chatAbortControllers.get(chatId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
}

/**
 * 获取所有活跃的对话 ID
 */
export function getActiveChats(): string[] {
  return Array.from(chatAbortControllers.keys());
}

/**
 * 检查对话是否正在生成
 */
export function isChatActive(chatId: string): boolean {
  return chatAbortControllers.has(chatId);
}
