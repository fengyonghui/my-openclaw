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
- workspace path format: **${workspace.includes('/mnt/') ? 'Unix-style (/mnt/d/...) — use Linux commands' : workspace.match(/^[a-z]:\\/i) ? 'Windows-style (D:\\...) — use Windows commands' : 'relative or other format'}**
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

**CRITICAL — Windows text search gotchas:**
- \`findstr\` 的 \`|\` 是字面字符，**"或"匹配必须加 \`/R\` 标志**（regex 模式），例如：
  \`findstr /R /N "主表\\|辅助表\\|isPrimary" file.tsx\`
  缺 \`/R\` 时 \\|\| 被当字面字符串，文件里没这个 → 退出码 1 → "无匹配"（不是真错）
- **优先使用 PowerShell \`Select-String\`**：原生支持 Unicode（中英文都行）、\`-Pattern\` 直接支持 \`|\` 语法
  \`powershell -NoProfile -Command "Get-Content -Path 'file.tsx' | Select-String -Pattern 'isPrimary|主表'"\`
- 退出码 1 + 空输出通常是"无匹配"，不是命令错误

**CRITICAL — Windows shell syntax gotchas (shell_exec 工具):**
- **Windows 上 shell_exec 默认是 cmd.exe，bash 风格语法在 cmd.exe 下会失败**。最稳的做法是用 PowerShell 包裹：
  \`powershell -NoProfile -Command "cd backend; mvn -q -DskipTests compile 2>&1 | Select-String -Pattern 'ERROR|BUILD' | Select-Object -First 30"\`
- 常见 bash 习惯错误 → cmd.exe 失败案例：
  - \`cd dir && command\` — cmd.exe 中 \`&&\` 可用但语义稍异，**最稳是把 cd 去掉（executor 已自动设 cwd）**
  - \`cd dir & command\` — cmd.exe 的 \`&\` 是"异步"，**绝对不要用** → 整个命令失败
  - \`command 2>&1 | tail\` — cmd.exe 不识别 \`2>&1\`（bash 语法），PowerShell 支持
  - \`$VAR\` — cmd.exe 不展开变量，PowerShell 支持
  - \`$(command)\` — bash 命令替换，cmd.exe 用 \`%VAR%\` 或 PowerShell 用 \`$(command)\`
- **简化规则**：Windows 上执行复杂 shell 命令，**优先用 powershell -NoProfile -Command 包裹**（已自动处理 \\\$ 转义、2>&1、路径等）
- **绝对不要在 Windows shell_exec 里写 \`cd xxx && ...\`**（即使 PowerShell 也是）—— executor 已自动设置 cwd 到项目根目录，加 cd 反而容易失败

**IMPORTANT - Tool usage tips:**
- **read_file 不能读目录**（会报"目标不是文件"）。想看目录内容请用 \`list_files\` 工具
- 多次 read_file 同一文件的不同段落时，传 \`offset\` + \`limit\` 比多次 read 完整文件更高效

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
- **CRITICAL for large files**: If the file content exceeds 5000 characters, write it in SEGMENTS using edit_file only (write_file only supports content ≤ ~10000 chars):
  1. First call: edit_file to create the file with partial content + "// ... (待补充 ... chars)"
  2. Second call: edit_file to replace "// ... (待补充" with the next segment
  3. Repeat until the file is complete, then one final edit_file to remove the "// ... (待补充" markers
- **Tool calls MUST appear in your response**: If you decide to call a tool, write the full tool_call XML **IN THE SAME RESPONSE** where you describe the action. Do not say "现在调用" or "下面调用" and then wait — embed the tool_call directly in the text. The tool call and your description must be in the same message.
- **IMPORTANT**: Do NOT describe what you will do before doing it. If you write "现在让我创建X" or "让我先创建X" and then STOP to summarize — this is wrong. **Call the tool FIRST, THEN summarize after the tool result arrives.**
- **IMPORTANT**: After receiving tool results, **DO NOT write another summary** — continue calling the next tool immediately until the task is 100% complete. Only after ALL changes are done, provide a brief final confirmation.
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
        function: tc.function
          ? { ...tc.function, arguments: safeArgumentsJson(tc.function.arguments) }
          : tc.function,
      })),
    };
  }
  return m as Message;
}

/**
 * 安全处理 tool_call 的 arguments JSON 字符串。
 * 关键场景：LLM 之前轮次生成 tool_call 时撞 max_tokens 被截断，arguments 是不闭合的 JSON。
 * 上游 LLM API 会拒绝整条请求："invalid function arguments json string"。
 *
 * 策略：
 * 1. 如果是合法 JSON → 原样返回
 * 2. 如果是 object → 序列化
 * 3. 如果不合法（被截断/损坏）→ 移除控制字符后再试一次
 * 4. 还不行 → 替换为 `{}`（保留 tc_id 链路，避免 tool result 变孤儿）
 */
function safeArgumentsJson(args: any): string {
  if (args == null) return '{}';
  if (typeof args !== 'string') {
    try { return JSON.stringify(args); } catch { return '{}'; }
  }
  // 尝试解析
  try {
    JSON.parse(args);
    return args;  // 有效 JSON，原样
  } catch {
    // 移除控制字符再试
    const cleaned = args.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch {
      // 还不行：用空对象兜底（保留 tc_id）
      console.warn(`[Sanitize] Invalid tool_call arguments JSON, replaced with {}: ${args.slice(0, 80)}...`);
      return '{}';
    }
  }
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
  // 关键防御：如果 content 原本是 JSON 字符串（tool result 必须是合法 JSON），
  // 截断后会破坏 JSON 结构。上游 LLM API 拒绝整条请求。
  // 解决：包裹在 envelope 中，保留预览但保证输出仍是合法 JSON。
  const trimmed = safe.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return {
      ...msg,
      content: JSON.stringify({
        _truncated: true,
        _originalLength: content.length,
        _preview: safe,
      }),
    };
  }
  return { ...msg, content: safe + '\n\n[内容过长，已截断]' };
}

/**
 * 检测 assistant tool_call 的 arguments 是否为合法 JSON。
 * 用于识别"历史中残留的坏 tool_call"（如 LLM 之前轮次撞 max_tokens 截断）。
 */
function isToolCallArgsBroken(args: any): boolean {
  if (args == null) return false;  // 缺省不算坏（LLM 有时会不传）
  if (typeof args !== 'string') return false;  // object 形式不算坏
  try {
    JSON.parse(args);
    return false;
  } catch {
    return true;
  }
}

/**
 * 从消息数组中移除"破损的 tool_call"及其对应的 tool result。
 *
 * 触发场景：LLM 之前轮次生成 write_file 等大参数调用时撞 max_tokens，
 * 留下不闭合的 JSON（如 14002 chars 的 HTML 在中间截断）。
 * 之前用 safeArgumentsJson 兜底 `{}`，但 MiniMax 严格校验
 * `tool_call(args) + tool_result(content)` 一致性，空 args + JSON 解析
 * 失败的 result 会被 proxy 拒绝（"tool call result does not follow tool call"）。
 *
 * 策略：识别坏 tool_call id → 同时移除坏 tool_call 本身 + 对应 tool result
 *       + 移除全空 assistant 消息（无 content 无 tool_calls）。
 * 这样 LLM 完全看不到坏调用，请求顺利通过。
 */
function removeBrokenToolCalls(messages: Message[]): Message[] {
  // Step 1: 找出所有坏 tool_call 的 id
  const brokenTcIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
      for (const tc of (m as any).tool_calls) {
        if (tc?.id && isToolCallArgsBroken(tc.function?.arguments)) {
          brokenTcIds.add(tc.id);
        }
      }
    }
  }
  if (brokenTcIds.size === 0) return messages;

  console.warn(`[Sanitize] Removing ${brokenTcIds.size} broken tool_call(s) and their results: ${Array.from(brokenTcIds).slice(0, 3).join(', ')}${brokenTcIds.size > 3 ? '...' : ''}`);

  // Step 2: 过滤消息
  return messages.filter(m => {
    // 移除坏 tool_call 对应的 tool result
    if (m.role === 'tool' && m.tool_call_id && brokenTcIds.has(m.tool_call_id)) {
      return false;
    }
    return true;
  }).map(m => {
    // 从 assistant 消息中移除坏 tool_calls
    if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
      const cleanTc = (m as any).tool_calls.filter((tc: any) => !brokenTcIds.has(tc.id));
      if (cleanTc.length === 0) {
        // 移除全部 tool_calls
        const { tool_calls, ...rest } = m as any;
        if (!rest.content || (typeof rest.content === 'string' && rest.content.trim() === '')) {
          // 整个消息全空，移除
          return null as any;
        }
        return rest as Message;
      }
      return { ...m, tool_calls: cleanTc };
    }
    return m;
  }).filter(m => m !== null) as Message[];
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

  // Step 1: 全部转换（只做 content 还原，args 保持原样）
  // 注意：normalizeMessageToolIds 里的 safeArgumentsJson 会把坏 args 改成 "{}"，
  //       所以 removeBrokenToolCalls 必须在它之前跑，否则检测不到原坏 args。
  const transformed: Message[] = historyMessages.map(m => transformMessage(m));
  console.log(`[buildHistoryMessages] transformed.length=${transformed.length}, first few roles: ${transformed.slice(0,5).map(m=>m?.role).join(',')}`);

  // Step 1.5: 移除"破损的 tool_call"及其对应 tool result
  // （LLM 之前轮次撞 max_tokens 留下的坏 args，会让 MiniMax 拒绝整条请求）
  const cleaned = removeBrokenToolCalls(transformed);
  if (cleaned.length !== transformed.length) {
    console.log(`[buildHistoryMessages] removeBrokenToolCalls: ${transformed.length} → ${cleaned.length}`);
  }

  // Step 1.7: 剩下的 tool_call 都是好的，做 id 规范化 + safeArgumentsJson（防御性）+ 截断
  const normalized: Message[] = cleaned.map(m =>
    truncateToolContent(normalizeMessageToolIds(m))
  );

  // Step 2: 收集有效 tool_call_ids（用于孤儿过滤）
  const validToolCallIds = new Set<string>();
  for (const m of normalized) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id) validToolCallIds.add(tc.id);
      }
    }
  }
  console.log(`[buildHistoryMessages] validToolCallIds.size=${validToolCallIds.size}, samples: ${Array.from(validToolCallIds).slice(0,3).join(',')}`);

  // Step 3: 过滤孤儿 tool 消息
  const filtered: Message[] = [];
  for (const m of normalized) {
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
