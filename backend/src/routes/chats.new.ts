/**
 * Chat Routes - 聊天路由
 * 
 * 使用模块化设计，将功能拆分到多个子模块中
 */

import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { pruneContext, compactContext, getContextStats, Message } from '../services/ContextManager.js';
import { buildToolList } from '../services/ToolDefinitions.js';
import { parseApiError, setModelRateLimited, calculateBackoff } from '../services/RateLimitHandler.js';

// 导入模块化组件
import {
  setAbortController,
  clearAbortController,
  stopChat,
  saveToMemoryFile,
  loadMemoryFile,
  executeToolCall,
  buildSystemMessage,
  transformMessage,
  buildHistoryMessages,
  cleanMentions,
  makeModelRequest,
  extractToolCalls,
  type ToolCall,
  type Message as ChatMessage
} from './chats/index.js';

export async function ChatRoutes(fastify: FastifyInstance) {
  // ============================================
  // GET / - 获取聊天列表
  // ============================================
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return await DbService.getChats(projectId);
  });

  // ============================================
  // GET /:id - 获取单个聊天
  // ============================================
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getChat(id);
  });

  // ============================================
  // PATCH /:id - 更新聊天
  // ============================================
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const db = await DbService.load();
    const chat = db.chats.find((c: any) => String(c.id) === String(id));
    if (chat) {
      Object.assign(chat, updates);
      await DbService.save();
    }
    return chat;
  });

  // ============================================
  // POST / - 创建聊天
  // ============================================
  fastify.post('/', async (request) => {
    const { projectId, title, agentId } = request.body as any;
    return await DbService.createChat(projectId, title, agentId);
  });

  // ============================================
  // DELETE /:id - 删除聊天
  // ============================================
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteChat(id);
  });

  // ============================================
  // POST /:id/send - 发送消息（核心 SSE 流）
  // ============================================
  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}...`);

    // 清理消息中的 @AgentName 提及
    const { cleanContent, mentions } = cleanMentions(content);

    // 保存用户消息
    await DbService.addMessageToChat(chatId, {
      role: 'user',
      content: cleanContent,
      mentions,
      attachments: attachments || []
    } as any);

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

    try {
      // 加载数据
      const projects = await DbService.getProjects();
      const chats = await DbService.getChats();
      const chat = chats.find(c => String(c.id) === String(chatId));
      const project = projects.find(p => p.id === chat?.projectId);
      const allModels = await DbService.getModels();

      if (!project) throw new Error('未找到所属项目');
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // 处理 MEMORY.md 触发
      if (content.startsWith('请注意') || content.startsWith('请记住')) {
        const saved = await saveToMemoryFile(content, project.workspace);
        if (saved === 'success') {
          reply.raw.write(`data: ${JSON.stringify({ chunk: '✅ 已自动记录到 MEMORY.md\n\n' })}\n\n`);
        } else if (saved === 'duplicate') {
          reply.raw.write(`data: ${JSON.stringify({ chunk: 'ℹ️ 该信息已存在，无需重复记录\n\n' })}\n\n`);
        }
      }

      // 获取项目的 Agent 和技能配置
      const enabledAgentIds = project?.enabledAgentIds || [];
      const allGlobalAgents = await DbService.getAgents();
      const projectPrivateAgents = project?.projectAgents || [];
      const allProjectAgents = [
        ...allGlobalAgents.filter(a => enabledAgentIds.includes(a.id)),
        ...projectPrivateAgents
      ];

      const coordinatorAgentId = project?.coordinatorAgentId || chat?.agentId || '1';
      const coordinatorAgent = allProjectAgents.find((a: any) => String(a.id) === String(coordinatorAgentId));

      const enabledSkillIds = project?.enabledSkillIds || [];
      const allGlobalSkills = await DbService.getGlobalSkills();
      const globalProjectSkills = allGlobalSkills.filter(s => enabledSkillIds.includes(s.id));
      const projectPrivateSkills = project?.projectSkills || [];
      const allEnabledSkills = [...globalProjectSkills, ...projectPrivateSkills];

      // 构建系统消息
      const systemMessage = buildSystemMessage({
        project,
        coordinatorAgent,
        allProjectAgents,
        allEnabledSkills
      });

      // 构建工具列表
      const tools = buildToolList(project, allProjectAgents, coordinatorAgentId, allEnabledSkills);

      // 获取聊天历史
      const chatWithHistory = await DbService.getChat(chatId);
      const historyMessages = chatWithHistory?.messages || [];

      // 构建消息
      let apiMessages = buildHistoryMessages(historyMessages, 100, 2);

      // 上下文管理
      const prunedMessages = pruneContext(apiMessages as Message[], {
        contextWindow: 128000,
        keepLastAssistants: 3,
        softTrimMaxChars: 4000,
        softTrimHeadChars: 1500,
        softTrimTailChars: 1500
      });

      const contextStats = getContextStats(prunedMessages as Message[]);
      console.log(`[Context] Messages: ${contextStats.messageCount}, Tokens: ~${contextStats.estimatedTokens}`);

      if (contextStats.needsCompaction) {
        const { compacted } = await compactContext(prunedMessages as Message[]);
        apiMessages = compacted as any[];
      }

      // 构建模型队列
      const activeModelId = chat?.modelId || project?.defaultModel;
      const primaryModel = allModels.find(m => m.id === activeModelId) || allModels[0];
      const fallbackModels = allModels.filter(m => m.id !== primaryModel.id).slice(0, 2);
      const modelsToTry = [primaryModel, ...fallbackModels];

      // 发送请求
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
            while (guard++ < 8) {
              const reqBody: any = {
                model: modelCfg.modelId,
                messages: finalMessages,
                stream: false,
                max_tokens: modelCfg.maxTokens || 8192,
                temperature: modelCfg.temperature || 0.7
              };

              if (tools.length > 0) {
                reqBody.tools = tools;
                reqBody.tool_choice = 'required';
              }

              console.log('');
              console.log('═'.repeat(60));
              console.log('🤖 MODEL REQUEST');
              console.log('═'.repeat(60));
              console.log(` Model: ${modelCfg.name} (${modelCfg.modelId})`);
              console.log(` API URL: ${apiUrl}`);
              console.log(` Messages: ${finalMessages.length}`);
              console.log(` Tools: ${tools.length > 0 ? tools.length : 'none'}`);
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
                // 处理工具调用
                console.log(`[DEBUG] Processing ${toolCalls.length} tool call(s)`);

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
                    toolResult = await executeToolCall(project, toolCall, allProjectAgents, allEnabledSkills, reply);
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
        throw new Error(`所有模型均不可用。最后错误: ${lastError}`);
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

      // 发送最终响应
      if (fullAssistantContent) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
        await DbService.addMessageToChat(chatId, {
          role: 'assistant',
          content: fullAssistantContent
        });
      }

      reply.raw.write(`data: [DONE]\n\n`);

    } catch (err: any) {
      console.error('[SSE Error Final]', err.message);

      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
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
    // TODO: 实现重发逻辑
    return { success: false, message: '功能开发中' };
  });
}
