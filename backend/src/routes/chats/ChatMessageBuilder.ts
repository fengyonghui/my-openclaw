/**
 * ChatMessageBuilder - 聊天消息构建器
 *
 * 构建系统消息和用户消息，处理多模态内容
 * 
 * 优化版本：
 * - token 预算滑动窗口：不再硬截断导致中间消息丢失
 * - 统一 Message 类型贯穿全流程
 * - 缓存系统消息（按 projectId + 配置 hash 失效）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadMemoryFile } from './MemoryFileHandler.js';
import { getSystemInfo, getSystemCommands } from '../../services/SystemCommands.js';

// ============================================================
// 类型定义
// ============================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
  id?: string;
  timestamp?: string;
  attachments?: any[];
}

export interface ChatContext {
  project: any;
  coordinatorAgent: any;
  allProjectAgents: any[];
  allEnabledSkills: any[];
}

// ============================================================
// 系统消息缓存（按 projectId + 配置 hash 失效）
// ============================================================
interface SystemCacheEntry {
  message: Message;
  configHash: string;  // Agent+Skills 配置的 hash
  invalidatedAt: number;
}

const _systemCache = new Map<string, SystemCacheEntry>();
const SYSTEM_CACHE_TTL_MS = 60_000; // 60s 兜底 TTL

/** 计算上下文配置的 hash（Agent/Skills 变更时缓存失效） */
function computeConfigHash(
  coordinatorAgent: any,
  allProjectAgents: any[],
  allEnabledSkills: any[]
): string {
  const agentIds = allProjectAgents.map((a: any) => a.id).sort().join(',');
  const skillIds = allEnabledSkills.map((s: any) => s.id).sort().join(',');
  const agentDesc = coordinatorAgent ? `${coordinatorAgent.id}|${coordinatorAgent.instructions?.slice(0, 100) || ''}` : '';
  return `${agentIds}|${skillIds}|${agentDesc}`;
}

/** 清除系统消息缓存 */
export function invalidateSystemCache(projectId?: string): void {
  if (!projectId) {
    _systemCache.clear();
    return;
  }
  _systemCache.delete(projectId);
}

// ============================================================
// Token 估算
// ============================================================

/** 粗略估算字符串 token 数（chars / 4） */
function estimateStrTokens(s: string): number {
  return Math.ceil((s?.length || 0) / 4);
}

/** 估算消息的 token 数（支持字符串和数组 content） */
function estimateMessageTokens(msg: Message): number {
  if (msg.role === 'system') {
    return estimateStrTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
  }
  if (msg.role === 'tool') {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return estimateStrTokens(content);
  }
  if (msg.role === 'assistant' && msg.tool_calls) {
    return estimateStrTokens(JSON.stringify(msg.tool_calls));
  }
  return estimateStrTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
}

// ============================================================
// 核心：构建系统消息（带缓存）
// ============================================================

/**
 * 构建系统消息（包含跨平台命令参考）
 * 缓存策略：projectId 相同 + configHash 未变 → 直接返回缓存
 */
export function buildSystemMessage(
  context: ChatContext,
  projectId?: string
): Message {
  const { project, coordinatorAgent, allProjectAgents, allEnabledSkills } = context;
  const workspace = project.workspace;

  // 尝试命中缓存
  if (projectId) {
    const cached = _systemCache.get(projectId);
    const configHash = computeConfigHash(coordinatorAgent, allProjectAgents, allEnabledSkills);
    const now = Date.now();

    if (
      cached &&
      cached.configHash === configHash &&
      (now - cached.invalidatedAt) < SYSTEM_CACHE_TTL_MS
    ) {
      // 命中：只更新 workspace（可能变化），content 模板不变
      const cachedContent = (cached.message.content as string)
        .replace(/Project workspace: \*\*[^*]+\*\*/, `Project workspace: **${workspace}**`)
        .replace(/Project: [^"\n]+/, `Project: ${project.name}`);
      return { ...cached.message, content: cachedContent };
    }
  }

  // 获取当前平台信息和命令集
  const sysInfo = getSystemInfo();
  const cmds = getSystemCommands();

  const platformSection = `
## PLATFORM
- platform: **${sysInfo.platformName}** (${sysInfo.platform})
- shell: **${sysInfo.shell}** (${sysInfo.shellPath})
- workspace: \`${workspace}\`
- path separator: \`${sysInfo.pathSeparator}\`

## SHELL COMMANDS (${sysInfo.platformName})
Use these commands for shell_exec tool. DO NOT guess commands.

**File operations:**
- list directory: ${cmds.listDir}
- read file: ${cmds.readFile}
- read first N lines: ${cmds.readFileLines}
- create directory: ${cmds.createDir}
- delete file: ${cmds.deleteFile}
- copy file: ${cmds.copyFile}
- move file: ${cmds.moveFile}

**Text search:**
- search in file: ${cmds.searchInFile}
- find files by name: ${cmds.findFiles}

**IMPORTANT - Creating/Writing Files:**
- For multi-line content (HTML, JSON, code, etc.): **USE write_file tool** (NOT shell_exec with cat/echo)
- shell_exec is for running commands, NOT for writing file content
- write_file tool: provides path + complete file content as parameters
${sysInfo.isWindows ? `- createFile command (empty file only): ${cmds.createFile}` : ''}

**Process:**
- list processes: ${cmds.listProcesses}
- kill process: ${cmds.killProcess}

**Network:**
- list ports: ${cmds.listPorts}

**Git:**
- git status: ${cmds.gitStatus}
- git diff: ${cmds.gitDiff}
- git log: ${cmds.gitLog}
`;

  // Agent 身份提示
  let agentRolePrompt = '';
  if (coordinatorAgent) {
    agentRolePrompt = `\n## YOUR IDENTITY\nYou are **${coordinatorAgent.name}**${coordinatorAgent.role ? ` (${coordinatorAgent.role})` : ''}. ` +
      `${coordinatorAgent.description || 'A professional AI assistant.'}\n`;

    if (coordinatorAgent.instructions) {
      agentRolePrompt += `\n## YOUR INSTRUCTIONS\n${coordinatorAgent.instructions}\n`;
    }
  }

  // 团队成员提示
  const availableDelegates = allProjectAgents
    .filter((a: any) => String(a.id) !== String(coordinatorAgent?.id))
    .map((a: any) => a.name);

  let teamPrompt = '';
  if (availableDelegates.length > 0) {
    const delegateDetails = allProjectAgents
      .filter((a: any) => String(a.id) !== String(coordinatorAgent?.id))
      .map((a: any) => `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${a.description || ''}`)
      .join('\n');

    teamPrompt = `\n\n## YOUR TEAM\nYou can delegate tasks to these team members:\n${delegateDetails}`;
  }

  // 加载项目 MEMORY.md（已带缓存）
  const memoryPrompt = '\n\n## PROJECT MEMORY\n' + loadMemoryFile(workspace);

  // 构建系统消息内容
  const systemContent =
    `You are an AI assistant working inside project workspace: **${workspace}**\n` +
    `Project: ${project.name}\n` +
    `${agentRolePrompt}` +
    `${teamPrompt}` +
    `${memoryPrompt}` +
    `${platformSection}` +
    `## TOOL CALLING RULES
- **CRITICAL**: When the user asks you to modify, edit, change, update, implement, create, write, or do ANY task: **CALL THE APPROPRIATE TOOL IMMEDIATELY, do not respond with only text descriptions**
- Specifically for "帮我修改" / "修改" / "edit" / "implement": use read_file first to understand the file, then use edit_file or write_file
- Specifically for "帮我写" / "create" / "implement": use write_file immediately with the complete file content
- If a tool call fails, READ the error message carefully and FIX the arguments
- For write_file: ALWAYS include BOTH path AND content parameters
- For edit_file: include path, oldText (exact text to find), and newText
- When the user asks to "execute", "implement", "do it", "以上全部" (all of the above), or any delegation request: **CALL THE APPROPRIATE TOOL IMMEDIATELY**
${availableDelegates.length > 0 ? `- To delegate a task to a team member: **USE delegate_to_agent tool immediately** with agent_name and task parameters` : ''}` +
    `- NEVER write user messages or error descriptions as file content\n` +
    `- When asked to implement a feature, write ACTUAL CODE, not descriptions\n` +
    `- write_file content must be COMPLETE file content, not a placeholder\n` +
    `- Do NOT write phrases like "完整文件内容" as content\n` +
    `\n\n## IMPORTANT RULES\n` +
    `- When a task requires specific expertise, delegate it to the appropriate team member\n` +
    `- Always use read_file before editing files\n` +
    `- You can understand and analyze images when provided\n` +
    `- Provide clear, concise, and helpful responses`;

  const message: Message = { role: 'system', content: systemContent };

  // 缓存
  if (projectId) {
    const configHash = computeConfigHash(coordinatorAgent, allProjectAgents, allEnabledSkills);
    _systemCache.set(projectId, {
      message,
      configHash,
      invalidatedAt: Date.now(),
    });
  }

  return message;
}

// ============================================================
// 工具函数
// ============================================================

/** 规范化 tool_call ID（确保 call_ 前缀格式） */
export function normalizeToolCallId(id: string | undefined): string {
  if (!id || !id.startsWith('call_')) {
    return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return id;
}

/** 规范化消息中的所有 tool_call IDs */
function normalizeMessageToolIds(m: any): Message {
  if (m.role === 'tool') {
    return { ...m, tool_call_id: normalizeToolCallId(m.tool_call_id) };
  }
  if (m.role === 'assistant' && m.tool_calls) {
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc: any) => ({
        ...tc,
        id: normalizeToolCallId(tc.id),
      })),
    };
  }
  return m as Message;
}

/** 转换单条消息格式（支持多模态） */
export function transformMessage(m: any): Message {
  let rawContent = m.content;

  // JSON 字符串还原
  if (typeof rawContent === 'string') {
    const trimmed = rawContent.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        rawContent = JSON.parse(trimmed);
      } catch {
        // 非 JSON，保持原样
      }
    }
  }

  let base: Message = { role: m.role, content: rawContent };

  if (m.role === 'tool') {
    return { ...base, tool_call_id: normalizeToolCallId(m.tool_call_id) };
  }

  if (m.role === 'assistant' && m.tool_calls) {
    return {
      ...base,
      tool_calls: m.tool_calls.map((tc: any) => ({ ...tc, id: normalizeToolCallId(tc.id) })),
    };
  }

  // 多模态附件处理
  if (m.attachments && m.attachments.length > 0) {
    const content: any[] = [];
    if (m.content && m.content.trim()) {
      content.push({ type: 'text', text: m.content });
    }
    m.attachments.forEach((att: any) => {
      if (att.type?.startsWith('image/') || att.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
        if (att.dataUrl) {
          content.push({ type: 'image_url', image_url: { url: att.dataUrl } });
        }
      } else {
        content.push({ type: 'text', text: m.content ? `[附件: ${att.name}]` : `[附件: ${att.name}]` });
      }
    });
    return { ...base, content: content.length > 0 ? content : m.content || '' };
  }

  return base;
}

/** 截断超长工具消息内容 */
function truncateToolContent(msg: Message, maxChars = 4000): Message {
  if (msg.role !== 'tool') return msg;
  let content = msg.content;
  if (typeof content !== 'string') {
    try {
      content = JSON.stringify(content);
    } catch {
      content = String(content);
    }
  }
  if (content.length <= maxChars) return msg;

  const safe = content.slice(0, maxChars).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return { ...msg, content: safe + '\n\n[内容过长，已截断]' };
}

// ============================================================
// 核心：构建对话历史消息（滑动窗口，无中间丢失）
// ============================================================

/**
 * 构建对话历史消息
 * 
 * 新策略：token 预算滑动窗口
 * - 先将原始消息全部转换、规范化
 * - 用 token 预算（而非硬消息数）做滑动窗口
 * - 保留首尾意图 + 中间按 token 均匀采样
 * 
 * @param historyMessages    原始历史消息（来自磁盘）
 * @param maxTokens          最大 token 预算（默认 60K ≈ 历史消息部分的一半 128K）
 * @param preserveHeadCount   保留前 N 条（意图锚定）
 */
export function buildHistoryMessages(
  historyMessages: any[],
  maxTokens: number = 60_000,
  preserveHeadCount: number = 4
): Message[] {
  console.log(`[buildHistoryMessages] input.length=${historyMessages?.length ?? 'null/undefined'}, maxTokens=${maxTokens}, preserveHeadCount=${preserveHeadCount}`);

  if (!historyMessages || historyMessages.length === 0) {
    console.log(`[buildHistoryMessages] EARLY RETURN: empty input`);
    return [];
  }

  // Step 1: 全部转换、规范化（只做一次）
  const transformed: Message[] = historyMessages.map(m =>
    truncateToolContent(normalizeMessageToolIds(transformMessage(m)))
  );
  console.log(`[buildHistoryMessages] transformed.length=${transformed.length}, first few roles: ${transformed.slice(0,5).map(m=>m?.role).join(',')}`);

  // Step 2: 收集有效 tool_call_ids（用于孤儿过滤）
  const validToolCallIds = new Set<string>();
  for (const m of transformed) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id) validToolCallIds.add(tc.id);
      }
    }
  }
  console.log(`[buildHistoryMessages] validToolCallIds.size=${validToolCallIds.size}, samples: ${Array.from(validToolCallIds).slice(0,3).join(',')}`);

  // Step 3: 过滤孤儿 tool 消息
  const filtered: Message[] = [];
  for (const m of transformed) {
    if (m.role === 'tool') {
      if (validToolCallIds.has(m.tool_call_id || '')) {
        filtered.push(m);
      }
    } else {
      filtered.push(m);
    }
  }
  console.log(`[buildHistoryMessages] filtered.length=${filtered.length}`);

  // Step 4: Token 预算滑动窗口
  const result = slidingWindowByTokens(filtered, maxTokens, preserveHeadCount);
  console.log(`[buildHistoryMessages] slidingWindowByTokens returned ${result.length} messages`);
  return result;
}

/**
 * Token 预算滑动窗口：保留头部意图 + 剩余按 token 均匀采样
 * 
 * 解决原策略的问题：
 *   原: 前2条 + 最近20条 = 中间N条全部丢失
 *   新: 前N条（意图锚定）+ 中间均匀采样 + 最近N条（上下文）
 */
function slidingWindowByTokens(
  messages: Message[],
  maxTokens: number,
  preserveHeadCount: number
): Message[] {
  const total = messages.length;
  if (total === 0) return [];

  const headMessages = messages.slice(0, preserveHeadCount);
  const headTokens = headMessages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const budgetForRest = maxTokens - headTokens;

  // 消息足够少，直接返回全部
  if (total <= preserveHeadCount + 2) {
    return messages;
  }

  // 计算剩余消息的总 token 数
  const tailMessages = messages.slice(preserveHeadCount);
  const tailTokens = tailMessages.reduce((s, m) => s + estimateMessageTokens(m), 0);

  // 未超出预算，返回全部
  if (tailTokens <= budgetForRest) {
    return messages;
  }

  // ── 调试日志 ──
  console.log(`[slidingWindow] total=${total} msgTokens=${tailTokens} budget=${maxTokens} budgetForRest=${budgetForRest} headTokens=${headTokens} preserveHead=${preserveHeadCount}`);

  // 超出预算：从尾向前均匀采样（贪心）
  // 策略：保留最近的消息（上下文敏感），前面的均匀采样
  // 我们用"比例保留"：最近 50% 全部保留，前面 50% 均匀采样
  const mid = Math.floor(total / 2);
  const recentHalf = messages.slice(mid);        // 后半部分（最近）全部保留
  const olderHalf = messages.slice(preserveHeadCount, mid); // 中间部分（需要采样）

  console.log(`[slidingWindow] mid=${mid} recentHalf=${recentHalf.length} olderHalf=${olderHalf.length}`);

  if (olderHalf.length === 0) {
    // 没有中间部分，只保留头部 + 最近部分
    return [...headMessages, ...recentHalf];
  }

  // 计算后半部分 token 数
  const recentTokens = recentHalf.reduce((s, m) => s + estimateMessageTokens(m), 0);
  // ── BUG 修复：原代码用 budgetForRest - recentTokens，逻辑错误。
  //   当 recentTokens > budgetForRest 时 budgetForOlder 变负数，直接返回空！
  //   正确逻辑：预算用于全部 tail（recentHalf + olderHalf），
  //   olderHalf 的实际可用预算 = maxTokens - headTokens - recentTokens
  const actualBudgetForOlder = maxTokens - headTokens - recentTokens;
  console.log(`[slidingWindow] recentTokens=${recentTokens} budgetForRest=${budgetForRest} OLD_budgetForOlder=${budgetForRest - recentTokens} NEW_actualBudgetForOlder=${actualBudgetForOlder}`);

  if (actualBudgetForOlder <= 0) {
    // 预算不够，只保留头部 + 最近部分
    console.log(`[slidingWindow] budget exhausted, returning head(${headMessages.length}) + recent(${recentHalf.length})`);
    return [...headMessages, ...recentHalf];
  }

  // 对 olderHalf 做均匀采样（按比例）
  const olderTokens = olderHalf.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const sampleRatio = actualBudgetForOlder / Math.max(olderTokens, 1);
  console.log(`[slidingWindow] olderTokens=${olderTokens} sampleRatio=${sampleRatio.toFixed(4)}`);

  const sampledOlder: Message[] = [];
  let accumulatedTokens = 0;
  for (const msg of olderHalf) {
    accumulatedTokens += estimateMessageTokens(msg);
    // 保留第 1 条，然后按比例采样
    if (sampledOlder.length === 0 || accumulatedTokens >= (sampledOlder.length * actualBudgetForOlder / Math.max(olderHalf.length, 1))) {
      sampledOlder.push(msg);
    }
  }

  // 确保至少保留每 2 条中的 1 条
  const finalOlder: Message[] = [];
  for (let i = 0; i < olderHalf.length; i++) {
    if (i % 2 === 0 || i === olderHalf.length - 1) {
      finalOlder.push(olderHalf[i]);
    }
  }

  const result = [...headMessages, ...finalOlder, ...recentHalf];

  // 再次计算 token，如果仍超预算，递归压缩
  const resultTokens = result.reduce((s, m) => s + estimateMessageTokens(m), 0);
  console.log(`[slidingWindow] resultTokens=${resultTokens} resultLen=${result.length} exceedsBudget=${resultTokens > maxTokens}`);
  if (resultTokens > maxTokens && result.length > preserveHeadCount + 4) {
    // 简单策略：只保留头部 + 最近的一半
    const newTail = result.slice(preserveHeadCount);
    const halfTail = newTail.slice(Math.floor(newTail.length / 2));
    console.log(`[slidingWindow] RECURSIVE call with ${halfTail.length} messages`);
    return [...headMessages, ...halfTail];
  }

  return result;
}

/** 清理消息中的 @AgentName 提及 */
export function cleanMentions(content: string): { cleanContent: string; mentions: string[] } {
  const mentions = content?.match(/@[^\s@]+/g)?.map((m: string) => m.substring(1)) || [];
  const cleanContent = content?.replace(/@[^\s@]+/g, '$1').trim() || '';
  return { cleanContent, mentions };
}

export default {
  buildSystemMessage,
  transformMessage,
  normalizeToolCallId,
  buildHistoryMessages,
  cleanMentions,
  invalidateSystemCache,
};
