/**
 * Chat Routes - 聊天路由（模块化版本 + partialContent 修复）
 * 
 * 使用模块化设计，将功能拆分到多个子模块中
 * 修复：工具调用失败时保存已发送的部分内容
 */

import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { ProjectChatService } from '../services/ProjectChatService.js';
import { getProjectWorkspacePath } from '../services/PathService.js';
import * as fs from 'fs';
import { pruneContext, compactContext, getContextStats, Message } from '../services/ContextManager.js';
import { buildToolList } from '../services/ToolDefinitions.js';
import { parseApiError, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';
import { projectRuntimeManager } from '../services/ProjectRuntimeManager.js';
import { autoSaveMemory } from '../services/MemoryAutoSaveService.js';
import { parseAttachments, buildMessageWithAttachments } from '../services/FileParserService.js';

/**
 * 安全地将工具结果序列化为 JSON 字符串。
 * 确保 content 字段不会因为原始文件内容包含非法字符而破坏整个 payload。
 */
function safeToolContent(result: any): string {
  try {
    const str = JSON.stringify(result);
    // 验证 JSON 有效
    JSON.parse(str);
    return str;
  } catch {
    // 如果序列化失败或验证失败，用安全的方式处理
    try {
      // 尝试强制转义任何问题字符
      const safe = JSON.stringify(String(result));
      JSON.parse(safe); // 验证
      return safe;
    } catch {
      // 最后兜底：移除所有控制字符后强制序列化
      const obj = typeof result === 'object' && result !== null
        ? result
        : { value: String(result) };
      const cleaned = JSON.parse(JSON.stringify(obj).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''));
      return JSON.stringify(cleaned);
    }
  }
}

/**
 * 检测用户最新消息是否表达「委派/指派」意图。
 *
 * 背景：之前 LLM 在收到「请帮我委派 UX 做 X」这种消息时，
 * 会**编造一个承诺式回复**（「他将开始...我会持续跟进...」）
 * 而不真的调 delegate_to_agent 工具。这是个 hallucination bug。
 *
 * 修复：在用户表达委派意图时，第一轮 LLM 调用强制 tool_choice: required，
 * 不让 LLM 跳过工具调用。
 *
 * 模式集合：覆盖中文 + 英文、显式（让/请/委派）+ 隐式（X 们/分别）、
 * 单 agent + 多 agent（X 和/与/、Y）。
 */
function detectDelegationIntent(messages: any[]): boolean {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;
  const content = typeof lastUser.content === 'string' ? lastUser.content : '';
  if (!content) return false;

  // 委派动作词（包含「汇报/报告/跟进」等 LLM 容易 hallucinate 的动作）
  const ACTIONS = '汇报|报告|做|写|改|处理|看看|查|检查|实现|开发|设计|测试|跑|调研|跟进|解释|帮忙|完成|弄|搞|审|评估|优化|重构|部署|研究|核对|确认|梳理|排查|修复|解决|收尾|收口|投产|发布|读一下|看一下|写一下|改一下|处理一下|做一下|确认一下|查一下|核对一下|排查一下|跟进一下|协助|帮|调|调用|启动|开始';
  // 多 agent 连接符
  const CONNECTORS = '和|与|及|跟|、|，|,';
  // 集体/分布词（暗示多 agent 各自处理）。注：不含「们」以避免「我们/他们」误报
  const COLLECTIVE = '分别|一起|各自|同时|并行';
  // 代词白名单：这些出现在 agent 位置时不视为真实委派
  const PRONOUNS = new Set(['我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们', '自己', '自己们']);

  // 每个 pattern 必须 capture group 包含「被委派的 agent 名」；
  // 如果该名字是代词（我们/你/他/...），则跳过这次匹配。
  const patterns: Array<{ re: RegExp; groups: number[] }> = [
    // 委派 X / 委派给 X
    { re: new RegExp(`委派\\s*(?:给\\s*)?([\\w\\u4e00-\\u9fa5]+)`, 'i'), groups: [1] },
    // delegate to X / assign to X
    { re: /delegate\s*to\s+([\w\u4e00-\u9fa5]+)/i, groups: [1] },
    { re: /assign\s*(?:to|task\s*to)\s+([\w\u4e00-\u9fa5]+)/i, groups: [1] },
    { re: /ask\s+([\w\u4e00-\u9fa5]+)\s+to/i, groups: [1] },
    { re: /have\s+([\w\u4e00-\u9fa5]+)\s+(?:do|write|check|test|implement|develop|run|fix|review)/i, groups: [1] },
    { re: /get\s+([\w\u4e00-\u9fa5]+)\s+to/i, groups: [1] },
    // 让/请/叫/找 X 动作
    { re: new RegExp(`(?:让|请|叫|找)\\s*([\\w\\u4e00-\\u9fa5]+)\\s*(?:${ACTIONS})`, 'i'), groups: [1] },
    // 让/请 X 和/与/、 Y (capture both)
    { re: new RegExp(`(?:让|请|叫|找)\\s*([\\w\\u4e00-\\u9fa5]+)\\s*[${CONNECTORS}]\\s*([\\w\\u4e00-\\u9fa5]+)`, 'i'), groups: [1, 2] },
    // 让/请 X 集体 (分别/一起/各自/同时/并行)
    { re: new RegExp(`(?:让|请|叫|找)\\s*([\\w\\u4e00-\\u9fa5]+)\\s*(?:${COLLECTIVE})`, 'i'), groups: [1] },
    // 让 X 们 (多 agent 显式集体) - "前端们"/"后端们" — 排除"我们"/"他们"等
    { re: /(?:让|请|叫|找)\s*([\w\u4e00-\u9fa5]{2,})们(?![们我你他她它])/i, groups: [1] },
    // 让 X 去/来 + 动作
    { re: new RegExp(`让\\s*([\\w\\u4e00-\\u9fa5]+)\\s*(?:去|来)\\s*(?:${ACTIONS})`, 'i'), groups: [1] },
    // 注：原 "X 去 Y" (X + 去 + 动作) 模式删除 — 误报率高（如"让他们去做"会把"让"也吃进 capture）
  ];

  for (const { re, groups } of patterns) {
    const m = content.match(re);
    if (!m) continue;
    // 检查所有 capture group：如果任一名字是代词（原始/剔尾后/任一前缀），跳过这次匹配
    let isReal = true;
    for (const g of groups) {
      let captured = m[g];
      if (!captured) continue;
      // Greedy [\w\u4e00-\u9fa5]+ 可能把"去/来/和/们/的/帮"等连词吃进 capture。
      // 检查任一前缀是否是代词，能更稳妥处理"你帮我" → "你" 是代词的场景。
      let hasPronoun = false;
      for (let i = 1; i <= captured.length; i++) {
        const prefix = captured.slice(0, i);
        if (PRONOUNS.has(prefix)) { hasPronoun = true; break; }
      }
      // 同时也做末尾剔尾后检查
      const stripped = captured.replace(/(?:去|来|和|与|及|跟|们|的|都|也|帮)+$/, '');
      if (!hasPronoun && PRONOUNS.has(stripped)) hasPronoun = true;
      if (hasPronoun) {
        isReal = false;
        break;
      }
    }
    if (isReal) return true;
  }
  return false;
}

/**
 * 检测 LLM 响应是否是「承诺式敷衍」（没真调工具但声称会跟进）。
 *
 * 用法：agent loop 退出后若发现 LLM 没调过任何工具，但响应包含这些模式，
 * 说明 LLM 在 hallucinating，需要重试一次并强制 tool_choice: required。
 */
function detectPromiseResponse(content: string): boolean {
  if (!content || content.length < 10) return false;
  const patterns = [
    // ===== 原有「承诺跟进」模式 =====
    /我[会將将]\s*(持续|继续|会|在)/i,           // 我会持续/我将继续
    /接下来\s*[\w\u4e00-\u9fa5]*\s*(将|会|开始)/i, // 接下来他将开始
    /等他?\s*(完成|结束后|完成后再)/i,             // 等他完成
    /他[已经]\s*(开始|接到|收到)/i,                // 他已经开始
    /他\s*(将|会)\s*(开始|进行|着手)/i,           // 他将开始
    /我会\s*(持续)?跟进/i,                          // 我会跟进
    /在他完成.*汇报/i,                                // 在他完成后向您汇报
    /等他\s*完成/i,                                  // 等他完成

    // ===== 新增：幻觉「虚假进度报告」模式（防 LLM 编造整个汇报）=====
    /已[经]?\s*(分别|成功)?\s*(?:向|让|请|给)?\s*[\w\u4e00-\u9fa5]+.*(?:汇报|委派|派发|完成|处理)/i,  // 已经分别向后端和前端委派
    /并为您\s*(汇总|总结|整理|汇报|呈现)/i,       // 并为您汇总
    /汇报\s*(?:任务|如下|结果|为|：|:)/i,        // 汇报任务/汇报如下
    /[📝📊📈🎯⏰✅❌🔧]\s*(?:项目)?\s*进度/i,        // 📝 项目进度
    /[📝📊📈🎯].*(?:汇报|报告|进度)/i,
    /\*\*核心结论\*\*/i,                              // **核心结论**
    /\*\*核心产出\*\*/i,                              // **核心产出**
    /\*\*完成状态\*\*/i,                              // **完成状态**
    /\*\*(?:后端|前端|UX|UI|测试|运维|Backend|Frontend).*进度/i,  // **后端进度 / **前端进度
    /\*\*(?:后端|前端|UX|UI|测试|运维|Backend|Frontend).*汇报/i,  // **后端汇报
    /完成\s*状态\s*[:：]?\s*(?:✅|✔|完成|进行中|未完成)/i,        // 完成状态: ✅ 已完成
    /✅\s*(?:已完成|完成|通过|上线|实现|搞定)/i,                  // ✅ 已完成
    /由\s*[@＠]\s*[\w一-鿿]+\s*(?:汇报|报告|完成)/i,    // 由 @后端工程师 汇报
    /@\s*[\w一-鿿]+\s*(?:工程师|开发|designer|engineer)\s*汇报/i,  // @XX工程师 汇报

    // ===== 新增 Case C：调过工具后 final 报告"操作步骤" / "接下来我将..." 模式 =====
    // 场景: LLM 调了 edit_file 后回 '我将立即亲自操作... 我的操作步骤：1. 引入依赖 2. 渲染 ...' 却没真调
    /我\s*的?\s*(?:操作|执行)?\s*步骤\s*[:：]?/i,        // 我的操作步骤 / 我的执行步骤
    /\d+\s*[\.、。]\s*\*\*[^*]+\*\*\s*[:：]?/m,            // 1. **引入依赖** (LLM 在列计划)
    /步骤\s*[:：]?\s*\d/i,                                // 步骤：1 / 步骤 1
    /我\s*将?\s*(?:立即|马上|稍后|接下来|现在)\s*(?:亲自)?\s*(?:操作|修改|开始|添加|继续|进行|着手|尝试|执行|修复|编译|运行|处理|解决|完成|排查|调查|检查|调试|重试|测试|部署|启动|重启|删除|更新|创建|构建|打包|发布|安装|配置)(?=$|[，。！？；、\s\u4e00-\u9fa5`'\"])/,  // 我将立即亲自操作 / 我将尝试 / 我将执行修复 (修复 JS \b 中文-中文边界 bug)
    /我\s*将?\s*(?:尝试|执行|修复|编译|运行|处理|解决|排查|调查|检查|调试|重试|测试|部署|启动|重启|删除|更新|创建|构建|打包|发布|安装|配置)/,  // 我尝试 / 我将尝试 / 我将执行 (允许无中间"立即/马上")
    /我\s*(?:必须|一定|一定要|不得不|应当|需要|将要|打算|会[再]?)\s*(?:尝试|执行|修复|编译|运行|处理|解决|排查|调查|检查|调试|重试|测试|部署|启动|重启|删除|更新|创建|构建|打包|发布|安装|配置)/,  // 我必须解决 / 我一定会修复
    /我\s*将?\s*(?:重新|再次|马上|立刻|立即|稍后|之后|最后)\s*(?:一次|回|遍|趟|次|步|个)?\s*(?:尝试|执行|修复|编译|运行|处理|解决|排查|调查|检查|调试|重试|测试|部署|启动|重启|删除|更新|创建|构建|打包|发布|安装|配置)/,  // 我将最后一次尝试 / 我将重新尝试
    /(?:接下来|下面|然后|现在)\s*[，,]?\s*我\s*(?:会|将|会开始|将开始)[\u4e00-\u9fa5\w]/,  // 接下来，我会 / 接下来我将 / 现在，我将 (修复 JS \w 不含中文 bug)
  ];
  return patterns.some(p => p.test(content));
}

/**
 * 验证一个字符串是否为合法的 JSON（object 或 array）。
 */
function isValidJson(str: string): boolean {
  const trimmed = str.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 检测 content 是否为损坏的 JSON（模型输出的 thinking/reasoning 内容
 * 被错误地写入 tool result 等场景）。
 * 损坏的 JSON 通常有这些特征：
 * - 字符串未闭合（Unterminated string）
 * - 对象/数组未闭合（缺少 } 或 ]）
 * - 含有 JSON 语法错误关键词
 */
function isCorruptedJsonContent(content: any): boolean {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();

  // 检测未闭合的字符串（以引号结尾但无闭合引号）
  // 例如: {"path":"backend/enh
  if (/:\s*"[^"]*$/.test(trimmed) && !trimmed.endsWith('"')) {
    return true;
  }
  // 检测未闭合的对象/数组
  // 例如: {"path":"...","content":{
  if (/\{[^}]*$/.test(trimmed) || /\[[^\]]*$/.test(trimmed)) {
    return true;
  }
  // 检测含有 JSON 错误关键词（模型将错误信息当作文本存入了 JSON）
  // 例如: {"error":"Unterminated string in JSON at position 2386
  if (trimmed.includes('Unterminated string') ||
      trimmed.includes('Unexpected token') ||
      trimmed.includes('JSON.parse') ||
      /position \d+/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * 清理消息内容：
 * 1. 移除 incomplete JSON（未闭合的字符串/对象/数组）
 * 2. 移除含有 JSON 错误关键词的 content
 * 3. 检测并处理双重 JSON 编码字符串
 *
 * 重要前提：isCorruptedJsonContent 用正则匹配 `:"`、`Unterminated string` 等模式，
 * 普通用户消息里完全可能出现 `:"`（例如 "ERR:""、JSON 示例代码片段、shell 命令引号），
 * 不能把"长得像损坏 JSON 的文本"误判为损坏 JSON。
 * 正确做法：只对真正"应该"是 JSON 的 content 做损坏检查，即以 `{` 或 `[` 开头的内容。
 */
function sanitizeMessageContent(content: any): any {
  // 非字符串 content（数组、null 等）直接返回
  if (typeof content !== 'string') return content;

  // 如果 content 本身是合法 JSON，返回原值
  if (isValidJson(content)) return content;

  // 仅当 content 以 `{` 或 `[` 开头（"应该"是 JSON）时才检查损坏
  // 普通文本消息（含 `:"`、`Unexpected` 等关键词）原样返回
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (isCorruptedJsonContent(content)) {
      console.warn('[Sanitize] Replacing corrupted content:', content.slice(0, 80));
      return '[工具结果内容已损坏，已跳过]';
    }
  }

  // 处理双重编码的 JSON 字符串
  // 例如: '"{\"path\":\"...\"}"' （外层引号内的 JSON 字符串）
  const doubleEncodedMatch = content.match(/^"(.*)"$/s);
  if (doubleEncodedMatch) {
    const inner = doubleEncodedMatch[1];
    if (isValidJson(inner)) {
      try {
        return JSON.parse(inner); // 还原为 object
      } catch {
        // inner 不是有效 JSON，保持原样
      }
    }
  }

  return content;
}

/**
 * 清理整个消息数组：
 * - 检查每条消息的 content
 * - 对 tool result 字段做双重 JSON 编码检测
 */
function sanitizeMessages(messages: any[]): any[] {
  return messages.map(msg => {
    const sanitized = { ...msg };

    // ⚠️ tool result 的 content 不走 sanitizeMessageContent：
    // transformMessage 已将 JSON 字符串 parse 成 object；sanitizeMessageContent 会误判为"损坏"
    if (sanitized.role === 'tool') {
      if (typeof sanitized.content === 'string') {
        // 已是字符串 → 验证是合法 JSON
        try { JSON.parse(sanitized.content); } catch {
          sanitized.content = '[工具结果格式错误]';
        }
      } else {
        // object → 序列化回字符串（API 要求 content 必须是字符串）
        sanitized.content = JSON.stringify(sanitized.content);
      }
      return sanitized;
    }

    // 非 tool 消息：正常清理损坏的 content
    if ('content' in sanitized) {
      sanitized.content = sanitizeMessageContent(sanitized.content);
    }

    return sanitized;
  });
}

// 导入模块化组件
import {
  setAbortController,
  clearAbortController,
  stopChat,
  saveToMemoryFile,
  executeToolCall,
  buildSystemMessage,
  buildHistoryMessages,
  cleanMentions,
  extractToolCalls,
  type ToolCall
} from './chats/index.js';

export async function ChatRoutes(fastify: FastifyInstance) {
  // ============================================
  // GET / - 获取聊天列表
  // ============================================
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    
    if (projectId) {
      // 从指定项目获取会话
      const projects = await DbService.getProjects();
      console.log(`[Chats] GET / projectId=${projectId}, found ${projects.length} projects`);
      const project = projects.find((p: any) => p.id === projectId);
      if (project) {
        const wsPath = getProjectWorkspacePath(project.workspace);
        console.log(`[Chats] Project: ${project.name}, WSL path: ${wsPath}, exists: ${fs.existsSync(wsPath)}`);
        const chats = await ProjectChatService.getChatsFromProject(wsPath);
        console.log(`[Chats] Found ${chats.length} chats`);
        return chats;
      }
      return [];
    }
    
    // 返回所有项目的会话
    const projects = await DbService.getProjects();
    let allChats: any[] = [];
    for (const project of projects) {
      const chats = await ProjectChatService.getChatsFromProject(getProjectWorkspacePath(project.workspace));
      chats.forEach(c => c.projectName = project.name);
      allChats = allChats.concat(chats);
    }
    return allChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  });

  // ============================================
  // GET /:id - 获取单个聊天
  // ============================================
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { projectId, limit, offset } = request.query as { projectId?: string; limit?: string; offset?: string };

    const limitNum = limit ? parseInt(limit, 10) : 0; // 0 = no pagination (full)
    const offsetNum = offset ? parseInt(offset, 10) : 0;

    const searchAndReturn = async (workspace: string) => {
      const chat = await ProjectChatService.getChatFromProject(workspace, id);
      if (!chat) return null;
      if (!limitNum) return chat; // no pagination — return full

      const allMsgs = chat.messages || [];
      const total = allMsgs.length;
      const sliced = allMsgs.slice(offsetNum, offsetNum + limitNum);
      return {
        ...chat,
        messages: sliced,
        totalMessages: total,
        hasMore: offsetNum > 0,  // still have older messages before this page
        returnedOffset: offsetNum,
      };
    };

    if (projectId) {
      const projects = await DbService.getProjects();
      const project = projects.find((p: any) => p.id === projectId);
      if (project) return await searchAndReturn(getProjectWorkspacePath(project.workspace));
    }

    const projects = await DbService.getProjects();
    for (const project of projects) {
      const chat = await searchAndReturn(getProjectWorkspacePath(project.workspace));
      if (chat) return chat;
    }
    return null;
  });

  // ============================================
  // PATCH /:id - 更新聊天（支持重命名等）
  // ============================================
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const { projectId } = request.query as { projectId?: string };
    
    if (projectId) {
      const projects = await DbService.getProjects();
      const project = projects.find((p: any) => p.id === projectId);
      if (project) {
        const chat = await ProjectChatService.getChatFromProject(getProjectWorkspacePath(project.workspace), id);
        if (chat) {
          // 支持 title / name 两种字段名
          if (updates.title !== undefined) chat.title = updates.title;
          if (updates.name !== undefined) chat.name = updates.name;
          if (updates.agentId !== undefined) chat.agentId = updates.agentId;
          if (updates.modelId !== undefined) chat.modelId = updates.modelId;
          if (Array.isArray(updates.messages)) chat.messages = updates.messages;
          await ProjectChatService.saveChatToProject(getProjectWorkspacePath(project.workspace), chat);
          return chat;
        }
      }
      return { error: '会话不存在' };
    }
    
    // 搜索所有项目（兼容性）
    const projects = await DbService.getProjects();
    for (const project of projects) {
      const chat = await ProjectChatService.getChatFromProject(getProjectWorkspacePath(project.workspace), id);
      if (chat) {
        if (updates.title !== undefined) chat.title = updates.title;
        if (updates.name !== undefined) chat.name = updates.name;
        if (updates.agentId !== undefined) chat.agentId = updates.agentId;
        if (updates.modelId !== undefined) chat.modelId = updates.modelId;
        if (Array.isArray(updates.messages)) chat.messages = updates.messages;
        await ProjectChatService.saveChatToProject(getProjectWorkspacePath(project.workspace), chat);
        return chat;
      }
    }
    return { error: '会话不存在' };
  });

  // ============================================
  // POST / - 创建聊天
  // ============================================
  fastify.post('/', async (request) => {
    const { projectId, title, agentId } = request.body as any;
    
    if (!projectId) {
      return { error: '缺少 projectId' };
    }
    
    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) {
      return { error: '项目不存在' };
    }
    
    // 使用项目的默认 coordinatorAgentId
    const defaultAgentId = project.coordinatorAgentId || agentId;
    const defaultModelId = project.defaultModel;
    
    return await ProjectChatService.createChat(
      getProjectWorkspacePath(project.workspace),
      projectId,
      title,
      defaultAgentId,
      defaultModelId
    );
  });

  // ============================================
  // DELETE /:id - 删除聊天
  // ============================================
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.query as { projectId?: string };
    
    if (projectId) {
      const projects = await DbService.getProjects();
      const project = projects.find((p: any) => p.id === projectId);
      if (project) {
        const wsPath = getProjectWorkspacePath(project.workspace);
        const deleted = await ProjectChatService.deleteChat(wsPath, id);
        // Phase 4: 清理运行时会话
        projectRuntimeManager.removeChatSession(id);
        return { deleted };
      }
    }
    return { error: '缺少 projectId' };
  });

  // ============================================
  // DELETE /:id/messages - 删除指定消息及其之后的所有消息
  // ============================================
  fastify.delete('/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.query as { projectId?: string };

    if (!projectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const { fromMessageId } = request.body as { fromMessageId?: string };
    if (!fromMessageId) {
      return reply.code(400).send({ error: '缺少 fromMessageId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === projectId);
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const wsPath = getProjectWorkspacePath(project.workspace);
    console.log(`[DELETE messages] chatId=${id} projectId=${projectId} wsPath=${wsPath} fromMessageId=${fromMessageId}`);
    const chat = await ProjectChatService.getChatFromProject(wsPath, id);
    if (!chat) {
      console.error(`[DELETE messages] Chat not found: ${id}`);
      return reply.code(404).send({ error: '会话不存在' });
    }

    const idx = chat.messages.findIndex((m: any) => String(m.id) === String(fromMessageId));
    if (idx === -1) {
      console.error(`[DELETE messages] Message not found: fromMessageId=${fromMessageId}, available IDs: ${chat.messages.slice(-3).map((m: any) => m.id).join(', ')}`);
      return reply.code(404).send({ error: '消息不存在' });
    }

    const removed = chat.messages.length - idx;
    chat.messages = chat.messages.slice(0, idx);
    await ProjectChatService.saveChatToProject(wsPath, chat);
    console.log(`[DELETE messages] ✅ Deleted ${removed} messages, ${chat.messages.length} remain`);
    return { success: true };
  });

  // ============================================
  // POST /:id/send - 发送消息（核心 SSE 流）
  // ============================================
  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}...`);

    // 找到包含此会话的项目
    const projects = await DbService.getProjects();
    let targetProject = null;
    for (const p of projects) {
      const projectChats = await ProjectChatService.getChatsFromProject(getProjectWorkspacePath(p.workspace));
      if (projectChats.some(c => String(c.id) === String(chatId))) {
        targetProject = p;
        break;
      }
    }
    
    if (!targetProject) {
      console.error(`[SSE Error] 未找到会话 ${chatId} 所属项目`);
      return reply.code(404).send({ error: '未找到所属项目' });
    }
    
    // 清理消息中的 @AgentName 提及
    const { cleanContent } = cleanMentions(content);

    // 解析附件内容（Word/Excel/TXT/图片 → 文本）
    let finalContent = cleanContent;
    if (attachments && attachments.length > 0) {
      console.log(`[Attachments] 解析 ${attachments.length} 个附件...`);
      const parsed = await parseAttachments(attachments);
      finalContent = buildMessageWithAttachments(cleanContent, parsed);
      console.log(`[Attachments] 解析完成，合并后文本长度: ${finalContent.length}`);
    }

    // 保存用户消息到项目目录（使用原始附件数据）
    await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
      role: 'user',
      content: finalContent,
      attachments: attachments || []
    });

    // 设置 SSE 响应头
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ chunk: '' })}\n\n`);

    // 创建 AbortController
    const abortController = new AbortController();
    setAbortController(chatId, abortController);

    // Phase 4: 创建运行时会话（agentId/modelId 从 targetProject 读取，chat 加载后再更新）
    projectRuntimeManager.createChatSession({
      chatId,
      projectId: targetProject.id,
      agentId: targetProject.coordinatorAgentId || '',
      modelId: targetProject.defaultModel || '',
      abortController,
    });
    projectRuntimeManager.startStreaming(chatId, `sse_${chatId}_${Date.now()}`);

    const onAbort = () => {
      console.log(`[SSE Stop] Chat ${chatId} aborted by user`);
      try {
        reply.raw.write(`data: ${JSON.stringify({ chunk: '\n\n⏹️ 已停止生成' })}\n\n`);
        reply.raw.write(`data: [DONE]\n\n`);
        reply.raw.end();
      } catch {}
    };
    abortController.signal.addEventListener('abort', onAbort);

    let fullAssistantContent = '';
    let partialContent = ''; // 🔧 保存工具调用时已发送的部分内容（必须在 try 块外定义）

    try {
      // 加载会话
      const workspacePath = getProjectWorkspacePath(targetProject.workspace);
      const chats = await ProjectChatService.getChatsFromProject(workspacePath);
      const chat = chats.find(c => String(c.id) === String(chatId));
      const allModels = await DbService.getModels();

      if (!targetProject) throw new Error('未找到所属项目');
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // 处理 MEMORY.md 触发
      if (content.startsWith('请注意') || content.startsWith('请记住')) {
        const saved = await saveToMemoryFile(content, workspacePath);
        if (saved === 'success') {
          reply.raw.write(`data: ${JSON.stringify({ chunk: '✅ 已自动记录到 MEMORY.md\n\n' })}\n\n`);
        }
      }

      // 获取配置
      const enabledAgentIds = targetProject?.enabledAgentIds || [];
      const allGlobalAgents = await DbService.getAgents();
      const projectPrivateAgents = targetProject?.projectAgents || [];
      const allProjectAgents = [
        ...allGlobalAgents.filter(a => enabledAgentIds.includes(a.id)),
        ...projectPrivateAgents
      ];

      const coordinatorAgentId = targetProject?.coordinatorAgentId || chat?.agentId || '1';
      const coordinatorAgent = allProjectAgents.find((a: any) => String(a.id) === String(coordinatorAgentId));

      const enabledSkillIds = targetProject?.enabledSkillIds || [];
      const allGlobalSkills = await DbService.getGlobalSkills();
      const globalProjectSkills = allGlobalSkills.filter(s => enabledSkillIds.includes(s.id));
      const projectPrivateSkills = targetProject?.projectSkills || [];
      const allEnabledSkills = [...globalProjectSkills, ...projectPrivateSkills];

      // 构建系统消息
      const systemMessage = buildSystemMessage({
        project: targetProject,
        coordinatorAgent,
        allProjectAgents,
        allEnabledSkills
      });

      // 构建工具列表
      const tools = buildToolList(targetProject, allProjectAgents, coordinatorAgentId, allEnabledSkills);
      console.log(`[Tools] Built ${tools.length} tools: ${tools.map(t => t.function?.name || t.name).join(', ')}`);

      // 获取聊天历史
      const chatWithHistory = await ProjectChatService.getChatFromProject(workspacePath, chatId);
      const historyMessages = chatWithHistory?.messages || [];
      // ═══════════════════════════════════════════════════════════════════════
      // 上下文管理：动态预算 + 两层保护
      // 原则：system prompt 优先，历史消息次之；总 token 不能超过 contextWindow
      // ═══════════════════════════════════════════════════════════════════════

      // Step 1: 估算 system prompt token 大小（chars / 4 是粗略估计）
      const sysMsgLen = (systemMessage?.content?.length || 0);
      const sysPromptTokens = Math.round(sysMsgLen / 4);
      const CONTEXT_WINDOW = 128_000;
      // 保留 4K buffer 给 max_tokens 和其他开销
      const historyBudget = Math.max(CONTEXT_WINDOW - sysPromptTokens - 4_000, 8_000);

      // Step 2: 滑动窗口 — 动态 budget，保留前 2 条消息（意图锚点）
      let apiMessages = buildHistoryMessages(historyMessages, historyBudget, 2);

      // Step 3: 初步工具结果修剪（软裁剪，不丢消息）
      let prunedMessages = pruneContext(apiMessages as Message[], {
        contextWindow: historyBudget, // 相对于 history 的预算
        keepLastAssistants: 5
      });

      // Step 4: 防止滑动窗口切断 tool_call 链
      const prunedMessagesFixed = [...prunedMessages];
      if (prunedMessagesFixed.length > 0 && prunedMessagesFixed[0]?.role === 'assistant' && prunedMessagesFixed[0]?.tool_calls?.length > 0) {
        const lastUserIdx = prunedMessagesFixed.findIndex(m => m.role === 'user');
        if (lastUserIdx > 0) {
          prunedMessagesFixed.splice(0, lastUserIdx);
          console.log(`[Context] ⚠️ Sliding window cut through tool_call chain — truncated ${lastUserIdx} orphaned messages, keeping ${prunedMessagesFixed.length}`);
        } else {
          prunedMessagesFixed.shift();
          console.log(`[Context] ⚠️ Dropped leading orphan assistant(tool_calls), keeping ${prunedMessagesFixed.length}`);
        }
      }

      let finalMessages = [...prunedMessagesFixed];

      // Step 5: 两层验证 — 对 [system + history] 做总 token 统计
      const combinedTokens = sysPromptTokens + Math.round((prunedMessagesFixed.reduce((s: number, m: any) => s + (m.content?.length || 0), 0)) / 4);
      const contextStats = getContextStats(prunedMessagesFixed as Message[]);

      console.log(`[Context] System prompt: ${sysMsgLen} chars (~${sysPromptTokens} tokens)`);
      console.log(`[Context] History budget: ${historyBudget} tokens (dynamic, based on system size)`);
      console.log(`[Context] History: ${prunedMessagesFixed.length} msgs (~${contextStats.estimatedTokens} tokens, ${contextStats.usagePercent}% of history budget)`);
      console.log(`[Context] Combined total: ~${combinedTokens} tokens (~${Math.round((combinedTokens / CONTEXT_WINDOW) * 100)}% of ${CONTEXT_WINDOW} context window)`);

      // Step 6: 如果 [system + history] 超过 80% context window，触发 compaction
      const combinedUsagePercent = Math.round((combinedTokens / CONTEXT_WINDOW) * 100);
      if (combinedUsagePercent > 80) {
        console.log(`[Context] ⚠️ Combined context exceeds 80% of ${CONTEXT_WINDOW} — triggering compaction...`);
        const { compacted, summary } = await compactContext(prunedMessagesFixed as Message[]);
        const compactStats = getContextStats(compacted as Message[]);
        const finalCombined = [systemMessage, ...compacted];
        const finalTokens = sysPromptTokens + compactStats.estimatedTokens;
        console.log(`[Context] Compaction done: ${compactStats.messageCount} msgs (~${compactStats.estimatedTokens} tokens). Final combined: ~${finalTokens} tokens (~${Math.round((finalTokens / CONTEXT_WINDOW) * 100)}%)`);
        finalMessages = finalCombined;
      }

      // 构建模型队列：primary + 8 个 fallback（按 db.json 顺序，覆盖常用 provider）
      // - 之前 .slice(0, 2) 太少：gemini-2.5-pro（实测唯一可工作）排第 7，到不了
      // - 全部 199 个太多：每次请求 600+ 秒（199×3 retry + rate-limit wait）
      // - 8 个平衡：能覆盖到 gemini-2.5-pro，总耗时 < 90s
      // 注：/resend 用另一套去重逻辑（chat.modelId + defaultModel + all），结果也是 199 个，
      //     但 send 比 resend 频率高得多，必须限制
      const FALLBACK_LIMIT = 8;
      const activeModelId = chat?.modelId || targetProject?.defaultModel;
      const primaryModel = allModels.find(m => m.id === activeModelId) || allModels[0];
      const fallbackModels = allModels.filter(m => m.id !== primaryModel.id).slice(0, FALLBACK_LIMIT);
      const modelsToTry = [primaryModel, ...fallbackModels];

      let success = false;
      let lastError = '';
      let pickedModelCfg: any = null;
      const MAX_RETRIES = 3;

      for (const modelCfg of modelsToTry) {
        if (success) break;

        console.log(`[Model Try] Using Model: ${modelCfg.name} (${modelCfg.modelId})`);
        const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

        let modelRetryCount = 0;
        let currentModelSuccess = false;

        while (modelRetryCount < MAX_RETRIES && !currentModelSuccess) {
          try {
            let guard = 0;
			let lastToolCallSignature = '';
			let repeatCallCount = 0;
            let anyToolCalled = false;  // 追踪本轮 agent loop 是否真调过工具（防 LLM 敷衍）
            let delegateRetryCount = 0;  // 委派重试次数（防无限循环）
            let caseBInProgress = false;  // 安全网 Case B 重试中：tool_choice 不再 required（让 LLM 给 final）
            const MAX_DELEGATE_RETRY = 3;  // 允许 3 次安全网重试 (Case A/B/C), 1 次太严: LLM 改完一个文件后报"接下来改下一个" 又被吞 (2026-06-05 实测)
            while (guard++ < 8) {
              const reqBody: any = {
                model: modelCfg.modelId,
                system: systemMessage.content,
                messages: finalMessages,
                stream: false,
                max_tokens: modelCfg.maxTokens || 32768,
                temperature: modelCfg.temperature || 0.7
              };

              if (tools.length > 0) {
                reqBody.tools = tools;
                // 检测用户是否表达委派意图：是则强制 tool_choice: required，
                // 防止 LLM hallucinate 出「我会跟进」式回复而不真调 delegate_to_agent。
                const wantsDelegate = detectDelegationIntent(finalMessages);
                const hasDelegateTool = tools.some((t: any) =>
                  (t.function?.name || t.name) === 'delegate_to_agent'
                );
                // DEBUG: 看 last user message
                const lastUser = [...finalMessages].reverse().find((m: any) => m.role === 'user');
                const lastUserContent = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 200) : '(no user msg)';
                reqBody.tool_choice = (wantsDelegate && hasDelegateTool && !caseBInProgress) ? 'required' : 'auto';
                console.log(`[Request] tools count: ${tools.length}, tool_choice: ${reqBody.tool_choice} (delegate-intent=${wantsDelegate}, has-delegate-tool=${hasDelegateTool}, caseB=${caseBInProgress})`);
                console.log(`[Request] last user msg (first 200 chars): ${lastUserContent}`);
              } else {
                console.log(`[Request] No tools available!`);
              }

              console.log('');
              console.log('═'.repeat(60));
              console.log('🤖 MODEL REQUEST');
              console.log('═'.repeat(60));
              console.log(` Model: ${modelCfg.name}`);
              console.log(` API URL: ${apiUrl}`);
              console.log(` Messages: ${finalMessages.length}`);
              // 打印最后几条消息（用于排查 tool_call_id 问题）
              const lastMsgs = finalMessages.slice(-4);
              for (let i = 0; i < lastMsgs.length; i++) {
                const m = lastMsgs[i] as any;
                const tcId = m.tool_call_id || (m.tool_calls?.[0]?.id) || '-';
                const tcPreview = m.tool_calls ? `[tool_calls:${m.tool_calls.length}]` : '';
                const content = m.content;
                const contentPreview = typeof content === 'string' ? content.slice(0, 60) : (Array.isArray(content) ? '[array]' : tcPreview || String(content || '').slice(0, 40));
                console.log(`   msg[${finalMessages.length - lastMsgs.length + i}] role=${m.role}, tc_id=${tcId}, content=${contentPreview}`);
              }
              console.log('═'.repeat(60));
              console.log('');

              // 🔍 打印请求体（用于排查 invalid chat setting）
              console.log('[DEBUG] reqBody keys:', Object.keys(reqBody));
              console.log('[DEBUG] reqBody.messages count:', reqBody.messages?.length);
              if (reqBody.tools) {
                console.log('[DEBUG] reqBody.tools count:', reqBody.tools.length);
              }

              // 🧹 在送入模型之前，清理所有消息中的损坏 JSON 内容
              const sanitizedMessages = sanitizeMessages(reqBody.messages);
              reqBody.messages = sanitizedMessages;

              // 验证 reqBody JSON 有效（开发调试）
              try {
                const serialized = JSON.stringify(reqBody);
                JSON.parse(serialized); // 确保无损坏
              } catch (err: any) {
                console.error('[Sanitize] FATAL: reqBody still invalid after sanitize!', err.message);
                // 移除所有 tool role 的消息（最可能的故障源）
                reqBody.messages = reqBody.messages.filter((m: any) => m.role !== 'tool');
                console.warn('[Sanitize] Removed all tool messages, retrying with', reqBody.messages.length, 'messages');
              }

              const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${modelCfg.apiKey}`
                },
                body: JSON.stringify(reqBody),
                signal: abortController.signal
              });

              if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText}`);
              }

              const data: any = await res.json();
              const choice = data.choices?.[0];
              const message = choice?.message || {};
              const toolCalls = extractToolCalls(choice);

              // 🔍 打印 API 返回的 tool_calls ID（用于排查格式问题）
              if (toolCalls.length > 0) {
                console.log(`[DEBUG] API returned ${toolCalls.length} tool_call(s):`);
                for (const tc of toolCalls) {
                  console.log(`[DEBUG]   id="${tc.id}", name=${tc.function?.name}`);
                }
              }

              // 🔧 规范化 tool_call IDs，确保格式正确（call_ 前缀，不含连字符）
              const normalizedToolCalls = toolCalls.map((tc: any) => {
                let id = tc.id || '';
                if (!id.startsWith('call_')) {
                  const oldId = id;
                  id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  console.log(`[WARN] tool_call id "${oldId}" doesn't match expected format, normalized to "${id}"`);
                }
                return { ...tc, id };
              });

              if (normalizedToolCalls.length > 0) {
                anyToolCalled = true;  // 标记本轮调过工具（用于安全网检测）
                console.log(`[DEBUG] Processing ${normalizedToolCalls.length} tool call(s)`);
                for (const tc of normalizedToolCalls) {
                  console.log(`[DEBUG]   tool_call id=${tc.id}, name=${tc.function?.name}`);
                }
                // 记录 tool role message 数量
                const toolMsgCount = finalMessages.filter((m: any) => m.role === 'tool').length;
                console.log(`[DEBUG]   finalMessages currently has ${toolMsgCount} tool messages`);
      
      // 检测重复的工具调用（防止死循环）
      // 只有连续3次相同调用才中断（允许模型重试）
      const currentSignature = normalizedToolCalls.map((tc: any) => 
        tc.function?.name + ':' + JSON.stringify(tc.function?.arguments).slice(0, 100)
      ).join('|');
      
      if (currentSignature === lastToolCallSignature) {
        repeatCallCount++;
        console.log(`[WARN] Same tool call repeated (${repeatCallCount} times)`);
        if (repeatCallCount >= 3) {
          console.log('[ERROR] Breaking loop after 3 repeated calls');
          reply.raw.write(`data: ${JSON.stringify({ chunk: '\n\n⚠️ 检测到重复的工具调用（连续3次），已自动停止。请尝试重新描述您的需求。' })}\n\n`);
          break;
        }
      } else {
        repeatCallCount = 1;
      }
      lastToolCallSignature = currentSignature;

                // 🔧 NOTE: We no longer stream message.content here because it often contains
                // <think>...[/think] thinking blocks which pollute the UI.
                // The final response will be streamed after tool calls are processed.

                reply.raw.write(`data: ${JSON.stringify({ 
                  type: 'tool_call', 
                  toolCalls: normalizedToolCalls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function?.name,
                    arguments: tc.function?.arguments
                  }))
                })}\n\n`);

                finalMessages.push({
                  role: 'assistant',
                  content: normalizedToolCalls.length > 0 ? '' : (choice?.message?.content || ''),
                  tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
                });

                // 保存 assistant 消息到数据库（带 tool_calls）并执行工具调用
                await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
                  role: 'assistant',
                  content: '',
                  tool_calls: normalizedToolCalls
                });

                // 执行工具调用
                for (const toolCall of normalizedToolCalls) {
                  let toolResult: any;
                  try {
                    toolResult = await executeToolCall(targetProject, toolCall, allProjectAgents, allEnabledSkills, reply);
                    projectRuntimeManager.incrementToolCalls(chatId);
                    projectRuntimeManager.getEventService().record('tool_call', {
                      chatId,
                      projectId: targetProject.id,
                      toolName: toolCall.function?.name || 'unknown',
                      toolArgs: JSON.parse(toolCall.function?.arguments || '{}'),
                    });
                  } catch (err: any) {
                    toolResult = { error: err.message };
                  }

                  reply.raw.write(`data: ${JSON.stringify({
                    type: 'tool_result',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function?.name,
                    arguments: toolCall.function?.arguments,
                    result: toolResult
                  })}\n\n`);

                  finalMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: safeToolContent(toolResult)
                  });

                  // 保存工具结果到数据库
                  await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: safeToolContent(toolResult)
                  });
                }
                continue;
              }

              // 没有 tool_calls → 视为最终响应
              // 安全网 Case A：若 LLM 没调过任何工具且响应是「承诺式敷衍」+ 用户要委派，
              //       不 break，继续循环并强制下一轮 tool_choice: required。
              fullAssistantContent = choice?.message?.content || '';
              if (
                !anyToolCalled &&
                detectPromiseResponse(fullAssistantContent) &&
                detectDelegationIntent(finalMessages) &&
                delegateRetryCount < MAX_DELEGATE_RETRY
              ) {
                delegateRetryCount++;
                console.warn(`[Coord] ⚠️ LLM 没真调工具且回复是敷衍式承诺。强制重试 #${delegateRetryCount}。`);
                console.warn(`[Coord] 敷衍文本: ${fullAssistantContent.slice(0, 200)}`);
                // 把敷衍回复 push 进 messages
                finalMessages.push({
                  role: 'assistant',
                  content: fullAssistantContent
                });
                // 推一个强指令，让 LLM 知道必须调工具
                // 用闭包捕获的 `content`（当前 user message，**不被对话历史污染**）。
                // 之前从 finalMessages 挖可能被旧 task 干扰（"改写 ux-test3.txt" 等）。
                const originalTask = (typeof content === 'string' ? content : '（未找到原始任务）').slice(0, 500);
                finalMessages.push({
                  role: 'user',
                  content: '[系统提示] 你刚才的回复"承诺跟进"是无效的——你并没有真的调用 delegate_to_agent 工具。\n' +
                    '**UX agent / Backend agent / Frontend agent 等所有成员 agent 都必须通过 `delegate_to_agent` 工具调用才能工作。**\n' +
                    '请立即调用 `delegate_to_agent` 工具，根据用户的原始任务选择合适的 agent（如 Backend / Frontend / UX 等），\n' +
                    '并将原始用户任务原文传入 `task` 参数：\n\n' +
                    `**用户原始任务**：\n${originalTask}\n\n` +
                    '这次是必须调工具，不允许跳过或编造结果。'
                });
                // 不发送敷衍 chunk 给前端（避免用户看到"我已委派"假话）
                // continue 进下一轮迭代，reqBody.tool_choice 会被 detectDelegationIntent 触发设为 required
                continue;
              }

              // 安全网 Case B：LLM 调过工具，但 final reply 仍是"承诺跟进"型
              //   （例：调了 delegate_to_agent 让后端+UX 汇报，两 agent 都跑完了，
              //    协调员收到结果后输出"整体结论... 我会继续跟进并在完成后向您汇报" 就 break）
              //   这种情况任何ToolCalled=true，Case A 不会触发。LLM 把承诺当最终回复，
              //   用户等不到"最终集成结果"。修复：注入 nudge 强制 LLM 重新生成真正 final。
              if (
                anyToolCalled &&
                detectPromiseResponse(fullAssistantContent) &&
                detectDelegationIntent(finalMessages) &&
                delegateRetryCount < MAX_DELEGATE_RETRY
              ) {
                delegateRetryCount++;
                caseBInProgress = true;  // 重试时 tool_choice 改为 auto（让 LLM 给 final 而非再调工具）
                console.warn(`[Coord] ⚠️ LLM 调了工具但 final reply 仍是承诺式。强制重试 #${delegateRetryCount}。`);
                console.warn(`[Coord] 承诺文本: ${fullAssistantContent.slice(0, 200)}`);
                // 把承诺式 final push 进 messages
                finalMessages.push({
                  role: 'assistant',
                  content: fullAssistantContent
                });
                // 推一个强指令，让 LLM 知道：所有工具结果已经在 messages 里，
                // 不要再承诺"会跟进/完成后汇报"等 — 直接给最终结论
                const originalTask = (typeof content === 'string' ? content : '（未找到原始任务）').slice(0, 500);
                finalMessages.push({
                  role: 'user',
                  content: '[系统提示] 你刚才的最终回复包含"我会继续跟进/完成后向您汇报"等承诺式语言，' +
                    '但你已经调过工具了（成员 agent 的真实结果已经在 messages 里的 tool 角色消息中）。\n' +
                    '**重要**：\n' +
                    '1. 你不需要再调任何工具。所有必要信息已经在 tool 结果里。\n' +
                    '2. 请直接基于已有工具结果给出**完整、明确、可执行的最终结论**。\n' +
                    '3. **禁止**使用"我会继续跟进"、"等他完成后再汇报"、"完成后向您汇报"等承诺式语言。\n' +
                    '4. 如果用户的任务涉及"最终集成结果"等尚未发生的事，明确告诉用户当前阶段是 X、还差 Y，而不是承诺将来。\n\n' +
                    `**用户原始任务**：\n${originalTask}\n\n` +
                    '请直接输出完整最终结论。'
                });
                // 不发送承诺 chunk 给前端（避免用户看到"我会跟进"假承诺）
                continue;
              }

              // ========== 安全网 Case C：调过工具但 final 报告"操作步骤/计划" 模式 ==========
              // 场景: LLM 调了 edit_file 后回 '我将立即亲自操作... 我的操作步骤：1. 引入依赖 2. 渲染 ...' 却没真调
              // 修复: 不需要委派意图（普通 fix bug 任务也会触发），强制 LLM 继续用工具真做
              if (
                anyToolCalled &&
                detectPromiseResponse(fullAssistantContent) &&
                delegateRetryCount < MAX_DELEGATE_RETRY
              ) {
                delegateRetryCount++;
                caseBInProgress = false;  // Case C 重试要 tool_choice: required (强制 LLM 调工具真做)
                console.warn(`[Coord] ⚠️ LLM 调了工具但 final 报告操作步骤/计划 (Case C)。强制重试 #${delegateRetryCount}。`);
                console.warn(`[Coord] 报告计划文本: ${fullAssistantContent.slice(0, 200)}`);
                finalMessages.push({
                  role: 'assistant',
                  content: fullAssistantContent
                });
                const originalTask = (typeof content === 'string' ? content : '（未找到原始任务）').slice(0, 500);
                finalMessages.push({
                  role: 'user',
                  content: '[系统提示] 你刚才的最终回复是"报告操作步骤/计划"（包含"我的操作步骤"、"接下来，我将..."、' +
                    '"我将立即亲自操作"、"1. **引入依赖** 2. **渲染**"等模式）。\\n' +
                    '**重要**：\\n' +
                    '1. **禁止**报告操作步骤/计划。**所有修改必须用工具实际执行**。\\n' +
                    '2. **立即**用 edit_file / write_file / shell_exec 等工具**真做**，不要再说"我接下来将..."、"我的步骤是 1...2..."。\\n' +
                    '3. 如果是"修复某 bug / 添加某功能"任务，**直接调用工具修改文件**，然后告诉用户改了什么。\\n' +
                    '4. 如果工具已经调过且结果正确，直接总结最终结果并**告诉用户改了什么文件**。\\n\\n' +
                    `**用户原始任务**：\\n${originalTask}\\n\\n` +
                    '请立即用工具真做，不要再报告计划。'
                });
                // 不发送 chunk 给前端（避免用户看到"我的操作步骤"假计划）
                continue;
              }

              // ========== 安全网 Case D：调过工具 + 工具失败 + LLM 给空/极短 final (沉默式失败) ==========
              // 场景: LLM 调了 shell_exec mvn compile 失败, 但 final response 是空字符串 (silence),
              //       SSE 自然 break, 用户看到"工具调了但 LLM 没说话"就停在那。
              //       Case A/B/C 全部因 content.length < 10 早返 false, 永远不触发。
              // 修复: 检查最近 3 条 tool message 含 "error"/"Command failed"/"失败", 强制 LLM 继续
              //       (要求 LLM 分析错误 + 修复 + 再验证)
              if (
                anyToolCalled &&
                (!fullAssistantContent || fullAssistantContent.length < 10) &&
                delegateRetryCount < MAX_DELEGATE_RETRY
              ) {
                // 检查最近 3 条 tool message 是否含 error
                const recentToolMsgs = finalMessages.filter((m: any) => m.role === 'tool').slice(-3);
                const lastToolHasError = recentToolMsgs.some((m: any) => {
                  const c = typeof m.content === 'string' ? m.content : '';
                  return /"error"\s*:|"Command failed"|失败|错误|exit=1|COMPIATION ERROR/i.test(c);
                });
                if (lastToolHasError) {
                  delegateRetryCount++;
                  caseBInProgress = false;  // Case D 要 tool_choice: required (强制 LLM 调工具真做)
                  console.warn(`[Coord] ⚠️ LLM 调了工具但 final 是空 + 工具结果含 error (Case D)。强制重试 #${delegateRetryCount}。`);
                  const lastToolPreview = (recentToolMsgs[recentToolMsgs.length-1]?.content || '').toString().slice(0, 400);
                  console.warn(`[Coord] 最近 tool 结果: ${lastToolPreview}`);
                  const originalTask = (typeof content === 'string' ? content : '（未找到原始任务）').slice(0, 500);
                  finalMessages.push({
                    role: 'user',
                    content: '[系统提示] 你刚才调了工具，但工具**失败了**（exit code 非 0 / 编译错误 / 命令报错），' +
                      '而且你**没有**给用户任何文字回应就直接结束了。\n' +
                      '**重要**：\n' +
                      '1. **不要**沉默。工具失败时必须**明确告诉用户**当前状态。\n' +
                      '2. **分析错误**（最近的 tool result 里能看到完整 stderr/stdout）。\n' +
                      '3. **立即**用工具修复（例如 edit_file / write_file 改错的代码、shell_exec 验证修复结果）。\n' +
                      '4. 修复后**重新跑**验证命令确认成功，再给用户最终总结。\n\\n' +
                      `**用户原始任务**：\\n${originalTask}\\n\\n` +
                      '请立即分析错误并修复，不要沉默。'
                  });
                  // 不发送空 chunk 给前端
                  continue;
                }
              }

              if (fullAssistantContent) {
                reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
              }
              success = true;
              currentModelSuccess = true;
              pickedModelCfg = modelCfg;
              console.log(`[DEBUG] Response content: ${fullAssistantContent?.slice(0, 200)}`);
              break;
            }
          } catch (err: any) {
            modelRetryCount++;
            console.error(`[Model Fail] ${modelCfg.name} failed (attempt ${modelRetryCount}/${MAX_RETRIES}): ${err.message}`);
            lastError = err.message;

            // --- 429 错误专门处理 ---
            const rateLimitInfo = parseApiError(err);
            if (rateLimitInfo?.isRateLimited) {
              setModelRateLimited(modelCfg.id, rateLimitInfo);
              console.log(`[429] ${modelCfg.name} rate limited. Reset at: ${rateLimitInfo.resetTime?.toISOString()}`);

              reply.raw.write(`data: ${JSON.stringify({
                type: 'rate_limit',
                model: modelCfg.name,
                retryAfter: rateLimitInfo.retryAfter,
                message: `⚠️ 模型 ${modelCfg.name} 触发限流，正在切换备用模型...`
              })}\n\n`);

              const waitTime = rateLimitInfo.retryAfter
                ? rateLimitInfo.retryAfter * 1000
                : calculateBackoff(modelRetryCount);

              if (modelRetryCount < MAX_RETRIES) {
                console.log(`[Model] Waiting ${waitTime / 1000}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000)));
              }
            } else {
              if (modelRetryCount < MAX_RETRIES) {
                const backoff = calculateBackoff(modelRetryCount);
                console.log(`[Model] Retrying ${modelCfg.name} in ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
              }
            }
          }
        }
      }

      if (!success || !pickedModelCfg) {
        // 🔧 如果有累积内容（guard 达到上限但有文本），使用它
        if (fullAssistantContent) {
          console.log(`[Model] Guard limit reached, using accumulated content (${fullAssistantContent.length} chars)`);
          success = true;
          pickedModelCfg = modelsToTry[0];
        } else if (partialContent) {
          console.log(`[Model] Using partial content due to failure`);
          fullAssistantContent = partialContent;
          success = true;
          pickedModelCfg = modelsToTry[0];
        } else {
          throw new Error(`所有模型均不可用 (已尝试: ${modelsToTry.map((m: any) => m.name).join(', ')}): ${lastError}`);
        }
      }

      // 模型切换通知
      if (pickedModelCfg.id !== activeModelId) {
        console.log(`[Model Switch] Notifying UI: ${pickedModelCfg.name}`);
        reply.raw.write(`data: ${JSON.stringify({
          info: `已自动切换至备用模型: ${pickedModelCfg.name}`,
          switchedModelId: pickedModelCfg.id
        })}\n\n`);

        // 更新会话使用的模型（通过 PATCH 更新到项目目录）
        const chatToUpdate = await ProjectChatService.getChatFromProject(workspacePath, chatId);
        if (chatToUpdate) {
          chatToUpdate.modelId = pickedModelCfg.id;
          await ProjectChatService.saveChatToProject(workspacePath, chatToUpdate);
        }
      }

      // 🔧 持久化最终响应（fullAssistantContent 已在内层循环中通过 SSE 发送过）
      // ⚠️ 修复：原本此处再发一次 SSE chunk，会导致同一份内容在对话框里出现 2 次。
      const finalContent = fullAssistantContent || partialContent;
      // 保存到数据库（内容和对话框完全一致，包括 thinking block）
      await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
        role: 'assistant',
        content: finalContent
      });

      // 自动记忆保存（后台，不阻塞响应）
      const msgsAfterAdd = [...(chatWithHistory?.messages || []), { id: Date.now().toString(), role: 'assistant', content: finalContent }];
      console.log(`[MemoryAutoSave] ⏩ Triggered for chat ${chatId}, ${msgsAfterAdd.length} messages, project=${targetProject.name}`);
      autoSaveMemory(targetProject, chatId, msgsAfterAdd).catch((err: any) => console.warn('[MemoryAutoSave]', err.message));

      reply.raw.write(`data: [DONE]\n\n`);

    } catch (err: any) {
      console.error('[SSE Error Final]', err.message);

      // 🔧 如果有部分内容，发送它
      if (partialContent) {
        reply.raw.write(`data: ${JSON.stringify({
          chunk: partialContent + '\n\n⚠️ 注意：部分操作未能完成，以上是已生成的内容。'
        })}\n\n`);
        await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
          role: 'assistant',
          content: partialContent
        });
        reply.raw.write(`data: [DONE]\n\n`);
      } else if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        console.log(`[SSE] Chat ${chatId} was stopped by user`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\n❌ 彻底失败: ${err.message}` })}\n\n`);
        reply.raw.write(`data: [DONE]\n\n`);
      }
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      clearAbortController(chatId);
      // Phase 4: 清理运行时会话
      projectRuntimeManager.stopStreaming(chatId);
      projectRuntimeManager.removeChatSession(chatId);
      try { reply.raw.end(); } catch {}
    }
  });

  // ============================================
  // POST /:id/stop - 停止对话生成
  // ============================================
  fastify.post('/:id/stop', async (request, reply) => {
    const { id: chatId } = request.params as any;
    console.log(`[Stop] Request to stop chat ${chatId}`);

    const stopped = stopChat(chatId);
    // Phase 4: 清理运行时会话
    projectRuntimeManager.stopStreaming(chatId);
    projectRuntimeManager.removeChatSession(chatId);
    if (stopped) {
      console.log(`[Stop] Successfully stopped chat ${chatId}`);
      return { success: true, message: '已停止生成' };
    } else {
      return { success: false, message: '没有正在进行的生成' };
    }
  });

  // ============================================
  // POST /:id/resend - 重发用户消息（复用 /send 的核心流式逻辑）
  // ============================================
  fastify.post('/:id/resend', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments } = request.body as any;

    console.log(`[Resend] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}...`);

    // 解析附件内容（Word/Excel/TXT/图片 → 文本），与 /send 保持一致
    let finalContent = content || '';
    if (attachments && attachments.length > 0) {
      console.log(`[Resend Attachments] 解析 ${attachments.length} 个附件...`);
      const parsed = await parseAttachments(attachments);
      finalContent = buildMessageWithAttachments(content || '', parsed);
      console.log(`[Resend Attachments] 解析完成，合并后文本长度: ${finalContent.length}`);
    }

    // 找到所属项目
    const projects = await DbService.getProjects();
    let targetProject = null;
    for (const p of projects) {
      const projectChats = await ProjectChatService.getChatsFromProject(getProjectWorkspacePath(p.workspace));
      if (projectChats.some(c => String(c.id) === String(chatId))) {
        targetProject = p;
        break;
      }
    }
    if (!targetProject) {
      return reply.code(404).send({ error: '未找到所属项目' });
    }

    // 设置 SSE 响应头
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ chunk: '' })}\n\n`);

    // 创建 AbortController
    const abortController = new AbortController();
    setAbortController(chatId, abortController);

    // Phase 4: 创建/更新运行时会话
    projectRuntimeManager.createChatSession({
      chatId,
      projectId: targetProject.id,
      agentId: targetProject.coordinatorAgentId || '',
      modelId: targetProject.defaultModel || '',
      abortController,
    });
    projectRuntimeManager.startStreaming(chatId, `resend_${chatId}_${Date.now()}`);

    const onAbort = () => {
      console.log(`[Resend Stop] Chat ${chatId} aborted`);
      try {
        reply.raw.write(`data: ${JSON.stringify({ chunk: '\n\n⏹️ 已停止生成' })}\n\n`);
        reply.raw.write(`data: [DONE]\n\n`);
        reply.raw.end();
      } catch {}
    };
    abortController.signal.addEventListener('abort', onAbort);

    let fullAssistantContent = '';
    let partialContent = '';

    try {
      const workspacePath = getProjectWorkspacePath(targetProject.workspace);
      const chat = await ProjectChatService.getChatFromProject(workspacePath, chatId);
      const allModels = await DbService.getModels();
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // 复用 /send 相同的模型选择和流式处理逻辑
      const modelsToTry = [
        ...(chat?.modelId ? allModels.filter((m: any) => m.id === chat.modelId) : []),
        ...allModels.filter((m: any) => m.id === targetProject.defaultModel),
        ...allModels,
      ].filter((m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === m.id) === i);

      let success = false;
      let pickedModelCfg: any = null;
      let lastError = '';
      let activeModelId = chat?.modelId || targetProject.defaultModel || '';

      let modelIndex = 0;
      for (const model of modelsToTry) {
        modelIndex++;
        console.log(`[Resend] 尝试模型 ${modelIndex}/${modelsToTry.length}: ${model.name} (${model.modelId}) @ ${model.baseUrl}`);
        try {
          const modelCfg: any = {
            baseUrl: model.baseUrl,
            apiKey: model.apiKey,
            modelId: model.modelId,
            name: model.name,
            maxTokens: model.maxTokens,
            temperature: model.temperature,
          };

          const enabledAgentIds = targetProject?.enabledAgentIds || [];
          const allGlobalAgents = await DbService.getAgents();
          const projectPrivateAgents = targetProject?.projectAgents || [];
          const allProjectAgents = [...allGlobalAgents.filter((a: any) => enabledAgentIds.includes(a.id)), ...projectPrivateAgents];

          const coordinatorAgentId = targetProject?.coordinatorAgentId || chat?.modelId || '1';
          const coordinatorAgent = allProjectAgents.find((a: any) => String(a.id) === String(coordinatorAgentId));

          const enabledSkillIds = targetProject?.enabledSkillIds || [];
          const allGlobalSkills = await DbService.getGlobalSkills();
          const globalProjectSkills = allGlobalSkills.filter(s => enabledSkillIds.includes(s.id));
          const projectPrivateSkills = targetProject?.projectSkills || [];
          const allEnabledSkills = [...globalProjectSkills, ...projectPrivateSkills];

          // 构建消息历史（复用相同逻辑）
          const systemMessage = buildSystemMessage({
            project: targetProject,
            coordinatorAgent,
            allProjectAgents,
            allEnabledSkills,
          });
          // ═══════════════════════════════════════════════════════════════════════
          // 上下文管理：动态预算 + 两层保护（与 /send 保持一致）
          // 原则：system prompt 优先，历史消息次之；总 token 不能超过 contextWindow
          // ═══════════════════════════════════════════════════════════════════════

          // Step 1: 估算 system prompt token 大小
          const sysMsgLen = (systemMessage?.content?.length || 0);
          const sysPromptTokens = Math.round(sysMsgLen / 4);
          const CONTEXT_WINDOW = 128_000;
          const historyBudget = Math.max(CONTEXT_WINDOW - sysPromptTokens - 4_000, 8_000);

          // Step 2: 滑动窗口 — 动态 budget，保留前 2 条意图锚点
          let historyMessages = buildHistoryMessages(chat?.messages || [], historyBudget, 2);

          // Step 3: 初步工具结果修剪
          const prunedMessages = pruneContext(historyMessages as Message[], {
            contextWindow: historyBudget,
            keepLastAssistants: 3
          });
          const contextStats = getContextStats(prunedMessages as Message[]);

          // Step 4: 防止滑动窗口切断 tool_call 链
          const prunedMessagesFixed = [...prunedMessages];
          if (prunedMessagesFixed.length > 0 && prunedMessagesFixed[0]?.role === 'assistant' && prunedMessagesFixed[0]?.tool_calls?.length > 0) {
            const lastUserIdx = prunedMessagesFixed.findIndex(m => m.role === 'user');
            if (lastUserIdx > 0) {
              prunedMessagesFixed.splice(0, lastUserIdx);
              console.log(`[Context] ⚠️ Sliding window cut through tool_call chain — truncated ${lastUserIdx} orphaned messages, keeping ${prunedMessagesFixed.length}`);
            } else {
              prunedMessagesFixed.shift();
              console.log(`[Context] ⚠️ Dropped leading orphan assistant(tool_calls), keeping ${prunedMessagesFixed.length}`);
            }
          }

          let finalMessages = [...prunedMessagesFixed];

          // Step 5: 两层验证
          const combinedTokens = sysPromptTokens + Math.round((prunedMessagesFixed.reduce((s: number, m: any) => s + (m.content?.length || 0), 0)) / 4);
          console.log(`[Context] System prompt: ${sysMsgLen} chars (~${sysPromptTokens} tokens)`);
          console.log(`[Context] History budget: ${historyBudget} tokens (dynamic)`);
          console.log(`[Context] History: ${prunedMessagesFixed.length} msgs (~${contextStats.estimatedTokens} tokens, ${contextStats.usagePercent}% of history budget)`);
          console.log(`[Context] Combined total: ~${combinedTokens} tokens (~${Math.round((combinedTokens / CONTEXT_WINDOW) * 100)}% of ${CONTEXT_WINDOW} context window)`);

          // Step 6: 超过 80% 则 compaction
          const combinedUsagePercent = Math.round((combinedTokens / CONTEXT_WINDOW) * 100);
          if (combinedUsagePercent > 80) {
            console.log(`[Context] ⚠️ Combined context exceeds 80% of ${CONTEXT_WINDOW} — triggering compaction...`);
            const { compacted } = await compactContext(prunedMessagesFixed as Message[]);
            const compactStats = getContextStats(compacted as Message[]);
            const finalCombined = [systemMessage, ...compacted];
            const finalTokens = sysPromptTokens + compactStats.estimatedTokens;
            console.log(`[Context] Compaction done: ${compactStats.messageCount} msgs (~${compactStats.estimatedTokens} tokens). Final combined: ~${finalTokens} tokens (~${Math.round((finalTokens / CONTEXT_WINDOW) * 100)}%)`);
            finalMessages = finalCombined;
          }

          const tools = buildToolList(targetProject, allProjectAgents, coordinatorAgentId, allEnabledSkills);

          // 发送初始消息
          reply.raw.write(`data: ${JSON.stringify({ type: 'assistant', chunk: '' })}\n\n`);

          let guard = 0;
          const MAX_GUARDS = 8;

          // 判断 system message 是否已在 finalMessages[0]（compaction 分支会放入）
          const hasSystemInMessages = finalMessages.length > 0 && finalMessages[0]?.role === 'system';
          while (guard++ < MAX_GUARDS) {
            const reqBody: any = {
              model: modelCfg.modelId,
              messages: finalMessages,
              stream: false,
              max_tokens: Math.max(modelCfg.maxTokens || 32768, 16384),
              temperature: modelCfg.temperature || 0.7
            };
            // 只有 system message 不在 messages 里时才用 system 字段（兼容旧格式）
            if (!hasSystemInMessages) {
              reqBody.system = systemMessage.content;
            }

            if (tools.length > 0) {
              reqBody.tools = tools;
              // /resend 端点也用相同的委派意图检测（虽然通常不需要，但保持一致性）
              const wantsDelegate = detectDelegationIntent(finalMessages);
              const hasDelegateTool = tools.some((t: any) =>
                (t.function?.name || t.name) === 'delegate_to_agent'
              );
              reqBody.tool_choice = (wantsDelegate && hasDelegateTool) ? 'required' : 'auto';
              console.log(`[Resend Request] tools count: ${tools.length}, names: ${tools.map((t: any) => t.function?.name).join(', ')}`);
              console.log(`[Resend Request] tool_choice: ${reqBody.tool_choice} (delegate-intent=${wantsDelegate}), messages count: ${finalMessages.length}`);
            } else {
              console.log(`[Resend Request] ⚠️ NO TOOLS AVAILABLE! tools.length=0`);
            }

            // 🧹 清理所有消息中的损坏 JSON 内容
            const sanitizedMessages = sanitizeMessages(reqBody.messages);
            reqBody.messages = sanitizedMessages;

            // 🔍 打印前3条消息的 role 和 content 类型（用于排查 tool result 格式）
            for (let i = 0; i < Math.min(3, sanitizedMessages.length); i++) {
              const m = sanitizedMessages[i];
              const contentType = typeof m.content;
              const tcPresent = m.tool_calls ? `, tc=${m.tool_calls.length}` : m.tool_call_id ? `, tcid=${m.tool_call_id}` : '';
              console.log(`[Req Msg ${i}] role=${m.role}, contentType=${contentType}${tcPresent}, contentLen=${String(m.content||'').length}`);
            }

            const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${modelCfg.apiKey}`
              },
              body: JSON.stringify(reqBody),
              signal: abortController.signal
            });

            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
            }

            const data: any = await res.json();

            // 🔍 详细日志：打印 API 原始响应的关键字段
            const rawChoice = data.choices?.[0];
            const rawMsg = rawChoice?.message || {};
            const hasDirectToolCalls = Array.isArray(rawMsg.tool_calls);
            const rawContent = (rawMsg.content || '').slice(0, 200);
            console.log(`[Resend Raw] finish=${rawChoice?.finish_reason}, hasDirectTC=${hasDirectToolCalls}, tcCount=${rawMsg.tool_calls?.length || 0}, contentLen=${(rawMsg.content || '').length}, contentPreview=${rawContent}`);
            // 打印 usage 信息
            if (data.usage) {
              console.log(`[Resend Raw] usage: prompt_tokens=${data.usage.prompt_tokens}, completion_tokens=${data.usage.completion_tokens}, total=${data.usage.total_tokens}`);
            } else {
              console.log(`[Resend Raw] usage: NOT PRESENT in response`);
            }
            if (data.model) {
              console.log(`[Resend Raw] model=${data.model}`);
            }
            console.log(`[Resend Raw] keys=${Object.keys(data).join(',')}, choiceKeys=${rawChoice ? Object.keys(rawChoice).join(',') : 'none'}`);

            // 打印实际发送的请求体摘要
            const reqJson: any = JSON.parse(JSON.stringify(reqBody));
            const sysLen = (reqJson.messages?.[0]?.content || '').length;
            console.log(`[Resend ReqBody] systemPrompt=${sysLen}chars, totalMsgs=${reqJson.messages?.length}, tools=${reqJson.tools?.length}, model=${reqJson.model}, maxTokens=${reqJson.max_tokens}`);
            // 打印最后3条消息（关注 tool result 的大小）
            for (let i = Math.max(0, reqJson.messages.length - 3); i < reqJson.messages.length; i++) {
              const m = reqJson.messages[i];
              const contentStr = String(m.content || '');
              console.log(`[Resend ReqBody] msg[${i}] role=${m.role}, hasTC=${!!m.tool_calls}, tcid=${m.tool_call_id || 'none'}, contentType=${typeof m.content}, contentLen=${contentStr.length}`);
            }
            // 打印 system prompt 末尾
            const sysContent = reqJson.messages?.[0]?.content || '';
            console.log(`[Resend ReqBody] systemPrompt tail: ...${sysContent.slice(-300)}`);
            // 打印 tools 摘要
            if (reqJson.tools && reqJson.tools.length > 0) {
              console.log(`[Resend ReqBody] tool[0]: ${JSON.stringify(reqJson.tools[0]).slice(0, 300)}`);
            }
            // 打印 user message
            const userMsg = reqJson.messages?.find((m: any) => m.role === 'user');
            console.log(`[Resend ReqBody] userMsg content: ${userMsg?.content?.slice(0, 100)}`);
            // CHECK: largest tool result (might be root cause of empty response)
            const toolMsgs = reqJson.messages?.filter((m: any) => m.role === 'tool') || [];
            if (toolMsgs.length > 0) {
              const largest = toolMsgs.reduce((a: any, b: any) => (String(a.content||'').length > String(b.content||'').length ? a : b));
              console.log(`[Resend ReqBody] Largest tool result: ${String(largest.content||'').length} chars, tcid=${largest.tool_call_id}`);
            }
            // CHECK: total estimated tokens
            const totalChars = reqJson.messages?.reduce((s: number, m: any) => s + String(m.content||'').length, 0) || 0;
            const estimatedTotalTokens = Math.round(totalChars / 4);
            console.log(`[Resend ReqBody] Total chars: ${totalChars}, est tokens: ~${estimatedTotalTokens} (max ~1M)`);

            const choice = rawChoice;
            const message = rawMsg;
            const toolCalls = extractToolCalls(choice);

            // 发送助手消息到前端
            if (message.content) {
              reply.raw.write(`data: ${JSON.stringify({ chunk: message.content })}\n\n`);
              fullAssistantContent += message.content;
            }

            if (toolCalls.length > 0) {
              reply.raw.write(`data: ${JSON.stringify({
                type: 'tool_call',
                toolCalls: toolCalls.map((tc: any) => ({
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments
                }))
              })}\n\n`);

              finalMessages.push({
                role: 'assistant',
                content: '', // Omit partial content with <think> block
                tool_calls: toolCalls
              });

              // 保存 assistant 消息（带 tool_calls）到数据库，避免 tool result 成为孤儿
              await ProjectChatService.addMessageToChat(workspacePath, chatId, {
                role: 'assistant',
                content: '', // Omit partial content with <think> block
                tool_calls: toolCalls
              });

              for (const toolCall of toolCalls) {
                let toolResult: any;
                try {
                  toolResult = await executeToolCall(targetProject, toolCall, allProjectAgents, allEnabledSkills, reply);
                  projectRuntimeManager.incrementToolCalls(chatId);
                  projectRuntimeManager.getEventService().record('tool_call', {
                    chatId,
                    projectId: targetProject.id,
                    toolName: toolCall.function?.name || 'unknown',
                    toolArgs: JSON.parse(toolCall.function?.arguments || '{}'),
                  });
                } catch (err: any) {
                  toolResult = { error: err.message };
                }

                const toolName = toolCall.function?.name;
                const toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
                const cmd = (toolArgs.command || '').toLowerCase();
                const isReadCmd = toolName === 'read_file' || toolName === 'list_files' ||
                  (toolName === 'file-io' && (cmd === 'read_file' || cmd === 'read' || cmd === 'list_files' || cmd === 'list'));

                let displayResult: any;
                if (isReadCmd) {
                  displayResult = {
                    success: true,
                    message: toolResult.message || '✅ 操作完成',
                    path: toolResult.path,
                    totalLines: toolResult.totalLines,
                    entriesCount: toolResult.entries?.length,
                    preview: toolResult.content ? toolResult.content.split('\n').slice(0, 3).join('\n') + '\n...' : undefined
                  };
                } else {
                  displayResult = toolResult;
                }

                reply.raw.write(`data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function?.name,
                  arguments: toolCall.function?.arguments,
                  result: displayResult
                })}\n\n`);

                finalMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: safeToolContent(displayResult)
                });

                // 保存工具结果到数据库
                await ProjectChatService.addMessageToChat(workspacePath, chatId, {
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: safeToolContent(displayResult)
                });
              }
              continue;
            }

            // 空响应检测：模型返回 200 但既无内容也无工具调用（可能是 content filter 或格式问题）
            if (!message.content && toolCalls.length === 0) {
              console.warn(`[Resend] ⚠️ 模型 ${model.name} 返回空响应 (contentLen=0, tcCount=0) — 视为失败，尝试下一个模型`);
              lastError = `空响应: finish=${rawChoice?.finish_reason}, prompt_tokens=${data.usage?.prompt_tokens}, completion_tokens=${data.usage?.completion_tokens}`;
              continue;
            }

            // 无工具调用，退出循环
            success = true;
            pickedModelCfg = modelCfg;
            console.log(`[Resend] ✅ 模型 ${model.name} 成功`);
            break;
          }

          if (success) break;
        } catch (err: any) {
          console.warn(`[Resend] ❌ 模型 ${model.name} 失败: ${err.message}`);
          lastError = err.message;
          if (err.name === 'AbortError') throw err;
        }
      }

      if (!success) {
        const triedModels = modelsToTry.map((m: any) => m.name).join(', ');
        throw new Error(`所有模型均不可用 (已尝试: ${triedModels}): ${lastError}`);
      }

      // 发送完成
      if (fullAssistantContent) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }
      reply.raw.write(`data: [DONE]\n\n`);

      // 保存助手响应到聊天
      if (fullAssistantContent) {
        await ProjectChatService.addMessageToChat(workspacePath, chatId, {
          role: 'assistant',
          content: fullAssistantContent
        });

        // 自动记忆保存（后台，不阻塞响应）
        const msgsAfterAdd = [...(chat?.messages || []), { id: Date.now().toString(), role: 'assistant', content: fullAssistantContent }];
        console.log(`[MemoryAutoSave] ⏩ Triggered (resend) for chat ${chatId}, ${msgsAfterAdd.length} messages, project=${targetProject.name}`);
        autoSaveMemory(targetProject, chatId, msgsAfterAdd).catch((err: any) => console.warn('[MemoryAutoSave]', err.message));
      }

    } catch (err: any) {
      console.error('[Resend Error]', err.message);
      if (partialContent) {
        reply.raw.write(`data: ${JSON.stringify({
          chunk: partialContent + '\n\n⚠️ 注意：部分操作未能完成'
        })}\n\n`);
      } else if (err.name !== 'AbortError') {
        reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\n❌ 失败: ${err.message}` })}\n\n`);
      }
      reply.raw.write(`data: [DONE]\n\n`);
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      clearAbortController(chatId);
      projectRuntimeManager.stopStreaming(chatId);
      projectRuntimeManager.removeChatSession(chatId);
      try { reply.raw.end(); } catch {}
    }
  });
}
