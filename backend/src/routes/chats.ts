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
import { projectRuntimeManager } from '../services/ProjectRuntimeManager.js';
import { parseAttachments, buildMessageWithAttachments } from '../services/FileParserService.js';
import {
  readChat,
  writeChatDual,
  appendMessageDual,
  truncateMessagesDual,
  deleteChatDual,
  createChatDual,
  listChatsForProject,
} from './chats/ChatStorageHelper.js';

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

/**
 * 共享 LLM 流式响应管道
 * - /send 在保存用户消息后调用
 * - /resend 在截断用户消息之后的回复后调用
 *
 * 假设：用户消息已在 DB 中（send 保存 / resend 截断后保留），
 * 调用方需自行设置 reply.raw 为 SSE 模式之前不要写入任何字节。
 */
async function runChatLLMStream(chatId: string, reply: any): Promise<void> {
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
    // 性能优化 (2026-09-12): 先用快速路径读 chat 拿到 projectId，
    // 避免 DbService.getChats() 加载整个 130MB db.json
    const chat = await readChat(chatId);
    if (!chat) throw new Error('会话不存在');
    const workspace = await DbService.getProjectWorkspace(chat.projectId);
    const project = workspace ? await DbService.getProject(chat.projectId) : null;
    const allModels = await DbService.getModels();

    if (!project) throw new Error('未找到所属项目');
    if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

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

    // 获取聊天历史（chat 已通过 readChat 读出，messages 在 chat 上）
    const historyMessages = chat.messages || [];

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

    // 🛡️ edit_file 死循环防护：连续 3 次返回"无变化"时直接终止
    // 历史 bug: 旧逻辑 break 后 LoopGuard 重启循环 → LLM 再次生成相同参数 → 无限循环
    // 每轮 148 条消息 × ~5K token → 快速耗尽 Token 计划 → 所有模型 429
    let editFileStuckCount = 0;
    const EDIT_FILE_STUCK_THRESHOLD = 3;

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
              reqBody.tool_choice = 'auto';
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

                // 跟踪 edit_file 无变化错误（连续触发 → 终止循环）
                const errMsg: string = typeof toolResult?.error === 'string' ? toolResult.error : '';
                const isEditFileStuck = toolCall.function?.name === 'edit_file' &&
                  errMsg.includes('替换未产生任何变化') &&
                  errMsg.includes('oldText 和 newText 相同');
                if (isEditFileStuck) {
                  editFileStuckCount++;
                } else {
                  editFileStuckCount = 0;
                }
              }

              // 🛡️ edit_file 死循环防护：达到阈值时终止所有模型循环
              if (editFileStuckCount >= EDIT_FILE_STUCK_THRESHOLD) {
                console.warn(`[Coord] edit_file 连续 ${editFileStuckCount} 次返回"无变化"，终止循环`);
                reply.raw.write(`data: ${JSON.stringify({
                  chunk: '\n\n⚠️ 编辑失败：连续多次尝试修改文件但未产生任何变化。请重新读取文件后确认内容。',
                  suggestion: '建议：1) 先用 read_file 确认文件当前内容 2) 再调用 edit_file 并提供准确的 oldText 3) 或改用 write_file 重写整个文件'
                })}\n\n`);
                // 跳出所有模型循环：设置标志 + 跳出 guard while
                success = true;
                currentModelSuccess = true;
                pickedModelCfg = modelCfg;
                fullAssistantContent = '';
                break;
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

    // 模型切换通知（双写 db.json + 项目文件）
    if (pickedModelCfg.id !== activeModelId) {
      console.log(`[Model Switch] Notifying UI: ${pickedModelCfg.name}`);
      reply.raw.write(`data: ${JSON.stringify({
        info: `已自动切换至备用模型: ${pickedModelCfg.name}`,
        switchedModelId: pickedModelCfg.id
      })}\n\n`);

      // 通过快速路径读最新 chat，再双写更新 modelId（传入 projectId 跳过全表查）
      const chatToUpdate = await readChat(chatId, project?.id);
      if (chatToUpdate) {
        chatToUpdate.modelId = pickedModelCfg.id;
        await writeChatDual(chatToUpdate);
      }
    }

    // 发送最终响应（双写 db.json + 项目文件）
    if (fullAssistantContent) {
      reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
      await appendMessageDual(chatId, {
        role: 'assistant',
        content: fullAssistantContent
      }, project?.id);
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
}

export async function ChatRoutes(fastify: FastifyInstance) {
  // ============================================
  // GET / - 获取聊天列表
  // 性能优化：项目文件优先 + db.json 合并（替代 DbService.getChats() 全量加载 130MB）
  // ============================================
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) {
      // 无 projectId 时回退到原 DbService 路径（兼容调用）
      return await DbService.getChats();
    }
    return await listChatsForProject(projectId);
  });

  // ============================================
  // GET /:id - 获取单个聊天
  // 性能优化：项目文件优先 → db.json 回退（130MB→单文件，~38 倍加速）
  // ============================================
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { projectId: queryProjectId } = request.query as any;
    const chat = await readChat(id, queryProjectId);
    if (!chat) return reply.code(404).send({ error: '会话不存在' });
    return chat;
  });

  // ============================================
  // GET /:id/status - 查询会话实时状态（前端轮询用）
  // 返回：exists / streaming / lastActivity / stale
  // - exists: 会话是否在运行时管理器中存在
  // - streaming: 是否正在流式生成
  // - lastActivity: 最后活动时间戳（毫秒）
  // - stale: 流式状态超过 STREAMING_STALE_MS 视为卡死
  // 与前端 chat-hooks.ts 的 STREAMING_STALE_MS 保持一致（5 分钟）
  // ============================================
  fastify.get('/:id/status', async (request) => {
    const { id } = request.params as { id: string };
    const session = projectRuntimeManager.getChatSession(id);
    if (!session) {
      return { exists: false, streaming: false, lastActivity: 0, stale: false };
    }
    const STREAMING_STALE_MS = 5 * 60 * 1000;
    const lastActivity = session.lastActiveAt;
    const isStreaming = session.status === 'streaming';
    const stale = isStreaming && Date.now() - lastActivity > STREAMING_STALE_MS;
    return { exists: true, streaming: isStreaming, lastActivity, stale };
  });

  // ============================================
  // PATCH /:id - 更新聊天（双写：db.json + 项目文件）
  // ============================================
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { projectId: queryProjectId, ...updates } = request.body as any;
    // 先走快速路径读出当前会话
    const current = await readChat(id, queryProjectId);
    if (!current) return null;
    Object.assign(current, updates);
    return await writeChatDual(current);
  });

  // ============================================
  // POST / - 创建聊天（双写：db.json + 项目文件）
  // ============================================
  fastify.post('/', async (request) => {
    const { projectId, title, agentId, modelId } = request.body as any;
    return await createChatDual({ projectId, title, agentId, modelId });
  });

  // ============================================
  // DELETE /:id - 删除聊天（双源：db.json + 项目文件）
  // ============================================
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { projectId: queryProjectId } = request.query as any;
    return { success: await deleteChatDual(id, queryProjectId) };
  });

  // ============================================
  // POST /:id/send - 发送消息（核心 SSE 流）
  // ============================================
  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments, projectId: queryProjectId } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}...`);

    // 清理消息中的 @AgentName 提及
    const { cleanContent, mentions } = cleanMentions(content);

    // 解析附件内容（性能关键：把 txt/doc/pdf/excel 内容合并进 content，
    //   否则 LLM 只看到 "[附件: xxx]" 占位符，看不到真实内容 — 已多次反馈）
    // 图片走 vision（OCR + image_url），文本类走 FileParserService 抽出文字
    let finalContent = cleanContent;
    if (attachments && attachments.length > 0) {
      try {
        const parsed = await parseAttachments(attachments);
        if (parsed.length > 0) {
          finalContent = buildMessageWithAttachments(cleanContent, parsed);
        }
      } catch (err: any) {
        console.warn(`[Chat /send] 附件解析失败，保留原始占位符: ${err.message}`);
      }
    }

    // 保存用户消息（双写：db.json + 项目文件）
    // content 已包含附件解析后的文本；attachments 数组保留供前端 UI 渲染
    await appendMessageDual(chatId, {
      role: 'user',
      content: finalContent,
      mentions,
      attachments: attachments || []
    } as any, queryProjectId);

    // MEMORY.md 触发：仅 /send 时处理（resend 不重复触发）
    // 走轻量级 workspace 缓存，避免 getProject 触发 130MB db.json 解析
    const chatPre = await readChat(chatId, queryProjectId);
    const workspace = chatPre?.projectId ? await DbService.getProjectWorkspace(chatPre.projectId) : null;
    if (workspace && (content.startsWith('请注意') || content.startsWith('请记住'))) {
      const saved = await saveToMemoryFile(content, workspace);
      console.log(`[Memory] saveToMemoryFile result: ${saved}`);
    }

    await runChatLLMStream(chatId, reply);
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
  // POST /:id/resend - 重发用户消息（截断该消息之后的回复，重新触发 LLM 流）
  // ============================================
  fastify.post('/:id/resend', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { messageId, projectId: queryProjectId } = request.body as any;

    if (!messageId) {
      return { success: false, message: 'messageId 是必填参数' };
    }

    // 走快速路径读取（项目文件优先）
    const chat = await readChat(chatId, queryProjectId);
    if (!chat) {
      return { success: false, message: '对话不存在' };
    }

    // 找到要重发的消息索引
    const msgIndex = chat.messages.findIndex((m: any) => String(m.id) === String(messageId));
    if (msgIndex === -1) {
      return { success: false, message: '消息不存在' };
    }

    // 删除该消息之后的所有消息（包括 assistant 回复）— 双写（传入 projectId 跳过全表查）
    await truncateMessagesDual(chatId, messageId, chat.projectId);

    console.log(`[Resend] ChatID: ${chatId}, re-generating from messageId: ${messageId}`);

    // 复用 /send 的 LLM 流管道（用户消息已存在 DB 中，无需 addMessageToChat）
    await runChatLLMStream(chatId, reply);
  });
}
