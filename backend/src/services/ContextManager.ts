/**
 * ContextManager - 上下文管理服务
 * 
 * 负责管理对话上下文，避免超出模型的上下文窗口限制
 * 
 * 两种机制：
 * 1. Session Pruning（会话修剪）：在每次 API 调用前清理旧的工具结果
 * 2. Compaction（压缩）：当消息太长时，将旧消息压缩成摘要
 */

// 截断消息常量，与 OpenClaw 保持一致
const TRUNCATION_SUFFIX = "\n\n⚠️ [Content truncated — original was too large for the model's context window. The content above is a partial view. If you need more, request specific sections or use offset/limit parameters to read smaller chunks.]";

const CONTEXT_OVERFLOW_WARNING = "⚠️ Context overflow — this conversation is too large for the model. Use /new to start a fresh session, or use a larger-context model.";

export interface ContextConfig {
  // 模型上下文窗口大小（token）
  contextWindow?: number;
  // 保留最近的 N 条助手消息，保护其工具结果不被修剪
  keepLastAssistants?: number;
  // 软修剪：工具结果超过此字符数时进行裁剪
  softTrimMaxChars?: number;
  // 软修剪：保留头部字符数
  softTrimHeadChars?: number;
  // 软修剪：保留尾部字符数
  softTrimTailChars?: number;
  // 是否启用压缩
  enableCompaction?: boolean;
  // 压缩目标 token 数
  compactionTargetTokens?: number;
}

const DEFAULT_CONFIG: ContextConfig = {
  contextWindow: 128000,        // MiniMax 等模型的默认上下文窗口
  keepLastAssistants: 3,         // 保留最近 3 条助手消息的工具结果
  softTrimMaxChars: 4000,        // 超过 4000 字符的工具结果进行软修剪
  softTrimHeadChars: 1500,       // 保留前 1500 字符
  softTrimTailChars: 1500,       // 保留后 1500 字符
  enableCompaction: true,        // 默认启用压缩
  compactionTargetTokens: 4000,   // 目标压缩到 4000 token
};

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id?: string;
  content: string;
  [key: string]: any;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  attachments?: any[];
  mentions?: string[];
  timestamp?: string;
  [key: string]: any;
}

/**
 * 估算消息的字符数（粗略估算 token = chars / 4）
 */
function estimateTokens(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content?.length || 0;
  }
  return Math.ceil(totalChars / 4);
}

/**
 * 软修剪工具结果：保留头尾，插入省略提示
 */
function softTrimContent(content: string, config: ContextConfig): string {
  const maxChars = config.softTrimMaxChars || DEFAULT_CONFIG.softTrimMaxChars!;
  const headChars = config.softTrimHeadChars || DEFAULT_CONFIG.softTrimHeadChars!;
  const tailChars = config.softTrimTailChars || DEFAULT_CONFIG.softTrimTailChars!;
  
  if (content.length <= maxChars) {
    return content;
  }
  
  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const originalSize = (content.length / 1024).toFixed(1);
  
  // 使用与 OpenClaw 一致的截断消息格式
  return `${head}\n\n⚠️ [Content truncated during persistence — original was ${originalSize}KB. The content above is a partial view. Use offset/limit parameters or request specific sections for large content.]\n\n${tail}`;
}

/**
 * 检查消息是否是工具结果
 */
function isToolResultMessage(msg: Message): boolean {
  return msg.role === 'tool' && Boolean(msg.content);
}

/**
 * Session Pruning - 修剪旧的工具结果
 * 
 * 保留最近 N 条助手消息的工具结果，之前的工具结果进行软修剪
 */
export function pruneContext(messages: Message[], config: ContextConfig = {}): Message[] {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const keepLast = mergedConfig.keepLastAssistants || DEFAULT_CONFIG.keepLastAssistants!;
  
  // 找到最近 N 条助手消息的位置
  let assistantCount = 0;
  let firstProtectedIndex = messages.length;
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.content) {
      assistantCount++;
      if (assistantCount >= keepLast) {
        firstProtectedIndex = i;
        break;
      }
    }
  }
  
  // 修剪保护位置之前的工具结果
  const prunedMessages: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (i >= firstProtectedIndex) {
      // 在保护范围内，不修剪
      prunedMessages.push(msg);
    } else if (isToolResultMessage(msg)) {
      // 不在保护范围内，进行软修剪
      const trimmedContent = softTrimContent(msg.content, mergedConfig);
      prunedMessages.push({
        ...msg,
        content: trimmedContent
      });
    } else {
      // 非工具结果消息（如用户消息、助手消息），不修剪
      prunedMessages.push(msg);
    }
  }
  
  return prunedMessages;
}

/**
 * Compaction - 压缩旧消息
 * 
 * 将旧消息总结成摘要，保留最近的消息
 */
export async function compactContext(
  messages: Message[],
  config: ContextConfig = {},
  getModelForSummary?: (defaultModel: any) => any
): Promise<{ compacted: Message[]; summary: string }> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (!mergedConfig.enableCompaction) {
    return { compacted: messages, summary: '' };
  }
  
  const targetTokens = mergedConfig.compactionTargetTokens || DEFAULT_CONFIG.compactionTargetTokens!;
  const currentTokens = estimateTokens(messages);
  
  // 如果不超过目标 token 数，不需要压缩
  if (currentTokens <= targetTokens) {
    return { compacted: messages, summary: '' };
  }
  
  // 找到要压缩的消息范围（保留最近的 20 条）
  const keepRecentCount = 20;
  const recentMessages = messages.slice(-keepRecentCount);
  const olderMessages = messages.slice(0, -keepRecentCount);
  
  if (olderMessages.length === 0) {
    return { compacted: messages, summary: '' };
  }
  
  // 生成摘要
  const summaryContent = generateSummary(olderMessages);
  
  // 创建摘要消息
  const summaryMessage: Message = {
    id: `compaction-${Date.now()}`,
    role: 'system',
    content: `## 📋 对话历史摘要\n\n以下是对早期对话的摘要总结：\n\n${summaryContent}\n\n---\n*此摘要由系统自动生成，原始对话内容已被压缩*`,
    timestamp: new Date().toISOString()
  };
  
  return {
    compacted: [summaryMessage, ...recentMessages],
    summary: summaryContent
  };
}

/**
 * 生成对话摘要
 */
function generateSummary(messages: Message[]): string {
  const lines: string[] = [];
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  
  for (const msg of messages) {
    const preview = msg.content?.slice(0, 200) || '';
    if (msg.role === 'user') {
      userMessages.push(preview);
    } else if (msg.role === 'assistant' && msg.content) {
      assistantMessages.push(preview);
    }
  }
  
  lines.push(`**对话数量**: ${messages.length} 条`);
  
  if (userMessages.length > 0) {
    lines.push(`\n**用户主要提问** (前5条):`);
    userMessages.slice(-5).forEach((m, i) => {
      lines.push(`  ${i + 1}. ${m}${m.length >= 200 ? '...' : ''}`);
    });
  }
  
  if (assistantMessages.length > 0) {
    lines.push(`\n**助手主要回复** (前5条):`);
    assistantMessages.slice(-5).forEach((m, i) => {
      lines.push(`  ${i + 1}. ${m}${m.length >= 200 ? '...' : ''}`);
    });
  }
  
  // 统计工具调用
  const toolCalls = messages.filter(m => m.role === 'assistant' && m.tool_calls?.length > 0);
  if (toolCalls.length > 0) {
    lines.push(`\n**工具调用次数**: ${toolCalls.length} 次`);
    const toolsUsed = new Set<string>();
    toolCalls.forEach(m => {
      m.tool_calls?.forEach((tc: any) => {
        toolsUsed.add(tc.function?.name);
      });
    });
    if (toolsUsed.size > 0) {
      lines.push(`**使用的工具**: ${Array.from(toolsUsed).join(', ')}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * 获取当前上下文使用情况
 */
export function getContextStats(messages: Message[], config: ContextConfig = {}): {
  messageCount: number;
  estimatedTokens: number;
  contextWindow: number;
  usagePercent: number;
  needsPruning: boolean;
  needsCompaction: boolean;
} {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const window = mergedConfig.contextWindow || DEFAULT_CONFIG.contextWindow!;
  const tokens = estimateTokens(messages);
  const usagePercent = Math.round((tokens / window) * 100);
  
  // 超过 80% 考虑压缩，超过 95% 必须压缩
  const needsCompaction = usagePercent > 80;
  // 工具结果超过 40000 字符考虑修剪
  const toolResultChars = messages
    .filter(m => m.role === 'tool')
    .reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const needsPruning = toolResultChars > 40000;
  
  return {
    messageCount: messages.length,
    estimatedTokens: tokens,
    contextWindow: window,
    usagePercent,
    needsPruning,
    needsCompaction
  };
}
