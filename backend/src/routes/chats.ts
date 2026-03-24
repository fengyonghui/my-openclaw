import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function ChatRoutes(fastify: FastifyInstance) {
  // 获取所有会话或项目下会话
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return await DbService.getChats(projectId);
  });

  // 获取单个会话详情 (包含历史消息)
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getChat(id);
  });

  // 修改会话 (例如标题)
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

  fastify.post('/', async (request) => {
    const { projectId, title, agentId } = request.body as any;
    return await DbService.createChat(projectId, title, agentId);
  });

  // 删除会话
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteChat(id);
  });

  // 发送消息 (SSE 流式返回并持久化)
  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content.slice(0, 20)}...`);

    // 1. 立即持久化用户发送的消息
    await DbService.addMessageToChat(chatId, { role: 'user', content });

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    // 发送空信号
    reply.raw.write(`data: ${JSON.stringify({ chunk: "" })}\n\n`);

    let fullAssistantContent = "";

    try {
      const projects = await DbService.getProjects();
      const chats = await DbService.getChats();
      const chat = chats.find(c => String(c.id) === String(chatId));
      const project = projects.find(p => p.id === chat?.projectId);
      const models = await DbService.getModels();
      
      // 优先使用会话级别的 modelId，否则回退到项目默认模型
      const activeModelId = chat?.modelId || project?.defaultModel;
      const modelCfg = models.find(m => m.id === activeModelId) || models[0];

      if (!modelCfg || !modelCfg.baseUrl) throw new Error("项目未配置有效的模型");

      // --- 加载技能 Prompt ---
      const enabledSkillIds = project?.enabledSkillIds || [];
      const allSkills = await DbService.getGlobalSkills();
      const projectSkills = allSkills.filter(s => enabledSkillIds.includes(s.id));
      
      let skillsPrompt = "";
      if (projectSkills.length > 0) {
        skillsPrompt = "\n\nAvailable Skills (Follow their instructions strictly):\n" + 
          projectSkills.map(s => `--- SKILL: ${s.name} ---\n${s.rawContent}`).join("\n\n");
      }

      const systemMessage = {
        role: 'system',
        content: `You are a professional AI assistant. ${skillsPrompt}`
      };

      // 3. 构造历史消息 (并进行智能精简)
      const chatWithHistory = await DbService.getChat(chatId);
      let historyMessages = chatWithHistory?.messages || [];
      
      const CONTEXT_WINDOW = 20;
      const INITIAL_INTENT_COUNT = 2;

      let apiMessages = [];
      if (historyMessages.length > CONTEXT_WINDOW + INITIAL_INTENT_COUNT) {
        const firstTwo = historyMessages.slice(0, INITIAL_INTENT_COUNT);
        const lastTwenty = historyMessages.slice(-CONTEXT_WINDOW);
        apiMessages = [...firstTwo, ...lastTwenty];
      } else {
        apiMessages = historyMessages;
      }

      // 合并 System Prompt + 历史消息
      const finalMessages = [
        systemMessage,
        ...apiMessages.map((m: any) => ({ role: m.role, content: m.content }))
      ];

      const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${modelCfg.apiKey}` },
        body: JSON.stringify({ 
          model: modelCfg.modelId, 
          messages: finalMessages, 
          stream: true 
        })
      });

      if (!res.ok) throw new Error(`AI 服务报错: ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      if (!reader) throw new Error('流读取失败');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        for (const line of lines) {
          const l = line.trim();
          if (!l || l === 'data: [DONE]') continue;
          if (l.startsWith('data: ')) {
            try {
              const jsonMatch = l.match(/\{.*\}/);
              if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                const text = data.choices?.[0]?.delta?.content || '';
                if (text) {
                  fullAssistantContent += text;
                  reply.raw.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
                }
              }
            } catch (e) {}
          }
        }
      }

      // 2. 持久化回复
      if (fullAssistantContent) {
        await DbService.addMessageToChat(chatId, { role: 'assistant', content: fullAssistantContent });
      }

      reply.raw.write(`data: [DONE]\n\n`);
    } catch (err: any) {
      console.error('[SSE Error]', err.message);
      reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\n❌ 出错了: ${err.message}` })}\n\n`);
      reply.raw.write(`data: [DONE]\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
