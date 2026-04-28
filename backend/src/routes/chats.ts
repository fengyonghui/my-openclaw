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
    const { projectId } = request.query as { projectId?: string };
    
    if (projectId) {
      const projects = await DbService.getProjects();
      const project = projects.find((p: any) => p.id === projectId);
      if (project) {
        return await ProjectChatService.getChatFromProject(getProjectWorkspacePath(project.workspace), id);
      }
    }
    
    // 搜索所有项目
    const projects = await DbService.getProjects();
    for (const project of projects) {
      const chat = await ProjectChatService.getChatFromProject(getProjectWorkspacePath(project.workspace), id);
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

    // 保存用户消息到项目目录
    await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
      role: 'user',
      content: cleanContent,
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
      let apiMessages = buildHistoryMessages(historyMessages, 20, 2);
  
  // 限制历史消息数量，避免影响模型工具调用能力
  const maxHistoryMessages = 30;
  if (apiMessages.length > maxHistoryMessages) {
    apiMessages = apiMessages.slice(-maxHistoryMessages);
    console.log(`[Context] Limited to ${apiMessages.length} recent messages`);
  }

      // 上下文管理 - 使用较小的 contextWindow 确保超长消息被裁剪
      // mx27 上下文窗口约 100K，这里用 32K 触发压缩（mx27 报告了 162K tokens）
      const prunedMessages = pruneContext(apiMessages as Message[], {
        contextWindow: 32000,
        keepLastAssistants: 3
      });

      const contextStats = getContextStats(prunedMessages as Message[]);
      console.log(`[Context] Before prune: ${apiMessages.length} msgs, ~${Math.round((apiMessages.reduce((s: number, m: any) => s + (m.content?.length || 0), 0)) / 4)} tokens`);
      console.log(`[Context] After prune: ${contextStats.messageCount} msgs, ~${contextStats.estimatedTokens} tokens, usage=${contextStats.usagePercent}%`);

      if (contextStats.needsCompaction) {
        console.log(`[Context] Starting compaction (${contextStats.estimatedTokens} tokens -> target ${4000})...`);
        const { compacted, summary } = await compactContext(prunedMessages as Message[]);
        const compactStats = getContextStats(compacted as Message[]);
        console.log(`[Context] Compaction done: ${compactStats.messageCount} messages, ~${compactStats.estimatedTokens} tokens`);
        apiMessages = compacted as any[];
      }

      // 构建模型队列
      const activeModelId = chat?.modelId || targetProject?.defaultModel;
      const primaryModel = allModels.find(m => m.id === activeModelId) || allModels[0];
      const fallbackModels = allModels.filter(m => m.id !== primaryModel.id).slice(0, 2);
      const modelsToTry = [primaryModel, ...fallbackModels];

      const finalMessages = [systemMessage, ...apiMessages];

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
            while (guard++ < 8) {
              const reqBody: any = {
                model: modelCfg.modelId,
                messages: finalMessages,
                stream: false,
                max_tokens: modelCfg.maxTokens || 32768,
                temperature: modelCfg.temperature || 0.7
              };

              if (tools.length > 0) {
                reqBody.tools = tools;
                reqBody.tool_choice = 'auto';
                console.log(`[Request] tools count: ${tools.length}, tool_choice: auto`);
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

                // 🔧 保存工具调用时的部分内容
                if (message.content) {
                  partialContent = message.content;
                  reply.raw.write(`data: ${JSON.stringify({ 
                    chunk: message.content, 
                    type: 'assistant' 
                  })}\n\n`);
                }

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
                  content: message.content || '',
                  tool_calls: normalizedToolCalls
                });

                for (const toolCall of normalizedToolCalls) {
                  let toolResult: any;
                  try {
                    toolResult = await executeToolCall(targetProject, toolCall, allProjectAgents, allEnabledSkills, reply);
                    projectRuntimeManager.incrementToolCalls(chatId);
                    projectRuntimeManager.getEventService().record('tool_call', {
                      chatId,
                      projectId: targetProject.id,
                      toolName: toolCall.function?.name || toolCall.function?.name || 'unknown',
                      toolArgs: JSON.parse(toolCall.function?.arguments || '{}'),
                    });
                  } catch (err: any) {
                    toolResult = { error: err.message };
                  }

                  reply.raw.write(`data: ${JSON.stringify({
                    type: 'tool_result',
                    toolCallId: toolCall.id,
                    toolName: toolCall.function?.name,
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

              // 获取最终响应
              fullAssistantContent = message.content || '';
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
        // 🔧 如果有部分内容，使用它而不是抛出错误
        if (partialContent) {
          console.log(`[Model] Using partial content due to failure`);
          fullAssistantContent = partialContent;
          success = true;
          pickedModelCfg = modelsToTry[0];
        } else {
          throw new Error(`所有模型均不可用。最后错误: ${lastError}`);
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

      // 🔧 发送最终响应（使用 fullAssistantContent 或 partialContent）
      const finalContent = fullAssistantContent || partialContent;
      if (finalContent) {
        // 如果使用的是部分内容，添加说明
        if (!fullAssistantContent && partialContent) {
          reply.raw.write(`data: ${JSON.stringify({
            chunk: partialContent + '\n\n⚠️ 注意：部分操作未能完成，以上是已生成的内容。'
          })}\n\n`);
        } else {
          reply.raw.write(`data: ${JSON.stringify({ chunk: finalContent })}\n\n`);
        }
        await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
          role: 'assistant',
          content: finalContent
        });
      }

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

      for (const model of modelsToTry) {
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

          const enabledSkillIds = targetProject?.enabledSkillIds || [];
          const globalSkills = await DbService.getGlobalSkills();
          const allEnabledSkills = globalSkills.filter((s: any) => enabledSkillIds.includes(s.id));

          // 构建消息历史（复用相同逻辑）
          const systemMessage = buildSystemMessage(targetProject, allProjectAgents, allEnabledSkills);
          const historyMessages = buildHistoryMessages(chat?.messages || [], []);
          const finalMessages = [systemMessage, ...historyMessages];

          const tools = buildToolList(allProjectAgents, allEnabledSkills);

          // 发送初始消息
          reply.raw.write(`data: ${JSON.stringify({ type: 'assistant', chunk: '' })}\n\n`);

          let guard = 0;
          const MAX_GUARDS = 8;

          while (guard++ < MAX_GUARDS) {
            const reqBody: any = {
              model: modelCfg.modelId,
              messages: finalMessages,
              stream: false,
              max_tokens: modelCfg.maxTokens || 32768,
              temperature: modelCfg.temperature || 0.7
            };

            if (tools.length > 0) {
              reqBody.tools = tools;
              reqBody.tool_choice = 'auto';
            }

            const res = await fetch(modelCfg.baseUrl, {
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
            const choice = data.choices?.[0];
            const message = choice?.message || {};
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
                content: message.content || '',
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
                  result: displayResult
                })}\n\n`);

                finalMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: safeToolContent(displayResult)
                });
              }
              continue;
            }

            // 无工具调用，退出循环
            success = true;
            pickedModelCfg = modelCfg;
            break;
          }

          if (success) break;
        } catch (err: any) {
          lastError = err.message;
          if (err.name === 'AbortError') throw err;
        }
      }

      if (!success) {
        throw new Error(`所有模型均不可用: ${lastError}`);
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
