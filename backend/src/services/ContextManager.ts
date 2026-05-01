/**
 * ContextManager - 上下文管理服务
 * 
 * 负责管理对话上下文，避免超出模型的上下文窗口限制
 * 
 * 两种机制：
 * 1. Session Pruning（会话修剪）：在每次 API 调用前清理旧的工具结果
 * 2. Compaction（压缩）：当消息太长时，将旧消息压缩成摘要
 * 
 * 优化版本：
 * - generateSummary 区分文本和工具结果，工具结果简洁化
 * - 支持 LLM 摘要（compactContext 传入模型配置时启用）
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 常量
// ============================================================

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_KEEP_LAST_ASSISTANTS = 5;

// ============================================================
// 类型
// ============================================================

export interface ContextConfig {
  contextWindow?: number;
  keepLastAssistants?: number;
  softTrimMaxChars?: number;
  softTrimHeadChars?: number;
  softTrimTailChars?: number;
  enableCompaction?: boolean;
  compactionTargetTokens?: number;
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id?: string;
  content: string;
  [key: string]: any;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
  attachments?: any[];
  mentions?: string[];
  timestamp?: string;
  [key: string]: any;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  name?: string;
}

export interface CompactionResult {
  compacted: Message[];
  summary: string;
}

// ============================================================
// Token 估算
// ============================================================

function estimateTokens(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += c.length;
    } else if (msg.role === 'assistant' && msg.tool_calls) {
      totalChars += JSON.stringify(msg.tool_calls).length;
    } else {
      const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += c.length;
    }
  }
  return Math.ceil(totalChars / 4);
}

// ============================================================
// 工具函数
// ============================================================

function softTrimContent(content: string, maxChars: number, headChars: number, tailChars: number): string {
  if (content.length <= maxChars) return content;
  const head = content.slice(0, headChars);
  const tail = content.slice(-tailChars);
  const originalSize = (content.length / 1024).toFixed(1);
  return `${head}\n\n⚠️ [内容截断，原文 ${originalSize}KB。请在需要时使用 offset/limit 参数读取具体内容]\n\n${tail}`;
}

function isToolResultMessage(msg: Message): boolean {
  return msg.role === 'tool' && Boolean(msg.content);
}

// ============================================================
// Session Pruning - 修剪旧的工具结果
// ============================================================

/**
 * 保留最近 N 条助手消息的工具结果，之前的工具结果进行软修剪
 */
export function pruneContext(messages: Message[], config: ContextConfig = {}): Message[] {
  const keepLast = config.keepLastAssistants ?? DEFAULT_KEEP_LAST_ASSISTANTS;
  const softTrimMax = config.softTrimMaxChars ?? 4000;
  const softTrimHead = config.softTrimHeadChars ?? 1500;
  const softTrimTail = config.softTrimTailChars ?? 1500;

  // 找到最近 N 条有内容的助手消息的位置
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
      prunedMessages.push(msg);
    } else if (isToolResultMessage(msg)) {
      let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      content = softTrimContent(content, softTrimMax, softTrimHead, softTrimTail);
      prunedMessages.push({ ...msg, content });
    } else {
      prunedMessages.push(msg);
    }
  }

  return prunedMessages;
}

// ============================================================
// Compaction - 压缩旧消息
// ============================================================

/**
 * Compaction - 压缩旧消息
 * 
 * 支持两种摘要模式：
 * 1. 规则摘要（默认）：快速，适合所有模型
 * 2. LLM 摘要（传入 modelCfg 时）：质量更高
 */
export async function compactContext(
  messages: Message[],
  config: ContextConfig = {},
  modelCfg?: ModelConfig
): Promise<CompactionResult> {
  const enableCompaction = config.enableCompaction ?? true;
  const compactionTarget = config.compactionTargetTokens ?? 4000;

  if (!enableCompaction) {
    return { compacted: messages, summary: '' };
  }

  const currentTokens = estimateTokens(messages);
  if (currentTokens <= compactionTarget) {
    return { compacted: messages, summary: '' };
  }

  // 保留最近 20 条消息
  const keepRecentCount = 20;
  const recentMessages = messages.slice(-keepRecentCount);
  const olderMessages = messages.slice(0, -keepRecentCount);

  if (olderMessages.length === 0) {
    return { compacted: messages, summary: '' };
  }

  // 生成摘要
  let summaryContent: string;
  if (modelCfg) {
    // LLM 摘要模式（#7）
    summaryContent = await generateLLMSummary(olderMessages, modelCfg);
  } else {
    // 规则摘要模式（#10 优化版）
    summaryContent = generateSmartSummary(olderMessages);
  }

  const summaryMessage: Message = {
    id: `compaction-${Date.now()}`,
    role: 'system',
    content: `## 📋 对话历史摘要\n\n以下是对早期对话的摘要总结：\n\n${summaryContent}\n\n---\n*此摘要由系统自动生成，原始对话内容已被压缩*`,
    timestamp: new Date().toISOString(),
  };

  return {
    compacted: [summaryMessage, ...recentMessages],
    summary: summaryContent,
  };
}

// ============================================================
// 规则摘要（优化版 #10）
// ============================================================

/**
 * 生成智能对话摘要
 * 
 * 改进：
 * - 区分纯文本回复和工具调用结果
 * - 工具结果用简洁格式：工具名(参数) → 结果摘要
 * - 过滤掉超长工具 JSON 中的噪音
 */
function generateSmartSummary(messages: Message[]): string {
  const lines: string[] = [];
  const userMessages: string[] = [];
  const assistantTexts: string[] = [];
  const toolCalls: { name: string; args: string; resultLen: number }[] = [];

  for (const msg of messages) {
    if (msg.role === 'user' && msg.content) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      userMessages.push(text.slice(0, 300));
    } else if (msg.role === 'assistant' && msg.content) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      if (!msg.tool_calls) {
        // 纯文本回复
        assistantTexts.push(text.slice(0, 300));
      }
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      // 工具结果：提取工具名和结果摘要
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const toolName = extractToolNameFromCallId(msg.tool_call_id, messages);
      const resultSnippet = content.slice(0, 200);
      toolCalls.push({ name: toolName, args: '', resultLen: content.length });
    }
  }

  lines.push(`**对话数量**: ${messages.length} 条（${userMessages.length} 条用户消息）`);

  if (userMessages.length > 0) {
    lines.push(`\n**用户提问** (前${Math.min(5, userMessages.length)}条):`);
    userMessages.slice(-5).forEach((m, i) => {
      lines.push(`  ${i + 1}. ${m}${m.length >= 300 ? '...' : ''}`);
    });
  }

  if (assistantTexts.length > 0) {
    lines.push(`\n**助手回复摘要** (前${Math.min(5, assistantTexts.length)}条):`);
    assistantTexts.slice(-5).forEach((m, i) => {
      lines.push(`  ${i + 1}. ${m}${m.length >= 300 ? '...' : ''}`);
    });
  }

  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map(t => t.name))];
    const toolByName: Record<string, number> = {};
    for (const tc of toolCalls) {
      toolByName[tc.name] = (toolByName[tc.name] || 0) + 1;
    }

    lines.push(`\n**工具调用** (共 ${toolCalls.length} 次):`);
    lines.push(`  使用的工具: ${toolNames.slice(0, 10).join(', ')}${toolNames.length > 10 ? '...' : ''}`);
    lines.push(`  调用次数: ${Object.entries(toolByName).map(([k, v]) => `${k}×${v}`).join(', ')}`);
  }

  return lines.join('\n');
}

/** 从 tool_call_id 反查工具名 */
function extractToolNameFromCallId(callId: string, messages: Message[]): string {
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.id === callId) {
          return tc.function?.name || 'unknown_tool';
        }
      }
    }
  }
  return 'unknown_tool';
}

// ============================================================
// LLM 摘要（#7）
// ============================================================

/**
 * 使用轻量 LLM 生成对话摘要
 * 只在超长上下文时触发，成本可控
 */
async function generateLLMSummary(messages: Message[], modelCfg: ModelConfig): Promise<string> {
  // 构建摘要请求的上下文（截断到合理大小）
  const summaryContext = messages.slice(-50).map(m => {
    if (m.role === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const snippet = content.length > 300 ? content.slice(0, 300) + '...' : content;
      return `[tool] ${snippet}`;
    }
    if (m.role === 'assistant' && m.tool_calls) {
      const tcNames = m.tool_calls.map((tc: any) => tc.function?.name).join(', ');
      return `[assistant] tool_calls: ${tcNames}`;
    }
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const snippet = text.length > 200 ? text.slice(0, 200) + '...' : text;
    return `[${m.role}] ${snippet}`;
  }).join('\n---\n');

  const summaryPrompt = `请为以下对话生成一段简洁的中文摘要，格式如下：
1. 对话主题
2. 主要完成的工作（用列表）
3. 使用的工具和操作
4. 最终结果

对话内容：
${summaryContext}

请用中文回答，摘要不超过300字。`;

  try {
    const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelCfg.apiKey}`,
      },
      body: JSON.stringify({
        model: modelCfg.modelId,
        messages: [
          {
            role: 'user',
            content: summaryPrompt,
          }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      console.warn(`[LLMSummary] HTTP ${res.status}, falling back to rule-based summary`);
      return generateSmartSummary(messages);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content.trim() || generateSmartSummary(messages);
  } catch (err: any) {
    console.warn(`[LLMSummary] Error: ${err.message}, falling back to rule-based summary`);
    return generateSmartSummary(messages);
  }
}

// ============================================================
// 上下文统计
// ============================================================

export function getContextStats(messages: Message[], config: ContextConfig = {}): {
  messageCount: number;
  estimatedTokens: number;
  contextWindow: number;
  usagePercent: number;
  needsPruning: boolean;
  needsCompaction: boolean;
} {
  const window = config.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const tokens = estimateTokens(messages);
  const usagePercent = Math.round((tokens / window) * 100);

  const toolResultChars = messages
    .filter(m => m.role === 'tool')
    .reduce((sum, m) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return sum + c.length;
    }, 0);

  return {
    messageCount: messages.length,
    estimatedTokens: tokens,
    contextWindow: window,
    usagePercent,
    needsPruning: toolResultChars > 40_000,
    needsCompaction: usagePercent > 80,
  };
}
