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
  // PATCH /:id - 更新聊天
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
          Object.assign(chat, updates);
          await ProjectChatService.saveChatToProject(getProjectWorkspacePath(project.workspace), chat);
          return chat;
        }
      }
      return { error: '会话不存在' };
    }
    
    // 搜索所有项目
    const projects = await DbService.getProjects();
    for (const project of projects) {
      const chat = await ProjectChatService.getChatFromProject(getProjectWorkspacePath(project.workspace), id);
      if (chat) {
        Object.assign(chat, updates);
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
    
    return await ProjectChatService.createChat(getProjectWorkspacePath(project.workspace), projectId, title);
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
        return { deleted: await ProjectChatService.deleteChat(getProjectWorkspacePath(project.workspace), id) };
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
      const chats = await ProjectChatService.getChatsFromProject(getProjectWorkspacePath(getProjectWorkspacePath(targetProject.workspace)));
      const chat = chats.find(c => String(c.id) === String(chatId));
      const allModels = await DbService.getModels();

      if (!targetProject) throw new Error('未找到所属项目');
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // 处理 MEMORY.md 触发
      if (content.startsWith('请注意') || content.startsWith('请记住')) {
        const saved = await saveToMemoryFile(content, getProjectWorkspacePath(getProjectWorkspacePath(targetProject.workspace)));
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
      const chatWithHistory = await ProjectChatService.getChatFromProject(getProjectWorkspacePath(getProjectWorkspacePath(targetProject.workspace)), chatId);
      const historyMessages = chatWithHistory?.messages || [];
      let apiMessages = buildHistoryMessages(historyMessages, 100, 2);
  
  // 限制历史消息数量，避免影响模型工具调用能力
  const maxHistoryMessages = 30;
  if (apiMessages.length > maxHistoryMessages) {
    apiMessages = apiMessages.slice(-maxHistoryMessages);
    console.log(`[Context] Limited to ${apiMessages.length} recent messages`);
  }

      // 上下文管理
      const prunedMessages = pruneContext(apiMessages as Message[], {
        contextWindow: 128000,
        keepLastAssistants: 3
      });

      const contextStats = getContextStats(prunedMessages as Message[]);
      console.log(`[Context] Messages: ${contextStats.messageCount}, Tokens: ~${contextStats.estimatedTokens}`);

      if (contextStats.needsCompaction) {
        const { compacted } = await compactContext(prunedMessages as Message[]);
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
              console.log('═'.repeat(60));
              console.log('');

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
              const choice = data.choices?.[0];
              const message = choice?.message || {};
              const toolCalls = extractToolCalls(choice);

              if (toolCalls.length > 0) {
                console.log(`[DEBUG] Processing ${toolCalls.length} tool call(s)`);
                for (const tc of toolCalls) {
                  console.log(`[DEBUG]   tool_call id=${tc.id}, name=${tc.function?.name}`);
                }
                // 记录 tool role message 数量
                const toolMsgCount = finalMessages.filter((m: any) => m.role === 'tool').length;
                console.log(`[DEBUG]   finalMessages currently has ${toolMsgCount} tool messages`);
      
      // 检测重复的工具调用（防止死循环）
      // 只有连续3次相同调用才中断（允许模型重试）
      const currentSignature = toolCalls.map((tc: any) => 
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
                    content: JSON.stringify(toolResult)
                  });

                  // 保存工具结果到数据库
                  await ProjectChatService.addMessageToChat(getProjectWorkspacePath(targetProject.workspace), chatId, {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult)
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

        const db = await DbService.load();
        const chatToUpdate = db.chats.find((c: any) => String(c.id) === String(chatId));
        if (chatToUpdate) {
          chatToUpdate.modelId = pickedModelCfg.id;
          await DbService.save();
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
    if (stopped) {
      console.log(`[Stop] Successfully stopped chat ${chatId}`);
      return { success: true, message: '已停止生成' };
    } else {
      return { success: false, message: '没有正在进行的生成' };
    }
  });

  // ============================================
  // POST /:id/resend - 重发用户消息
  // ============================================
  fastify.post('/:id/resend', async (request, reply) => {
    return { success: false, message: '功能开发中' };
  });
}
