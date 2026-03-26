import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { FileToolService } from '../services/FileToolService.js';

type ToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

function getFileToolsForProject(project: any, teamAgents: any[] = [], coordinatorAgentId?: string) {
  if (!project?.enabledSkillIds?.includes('builtin-file-io')) return [] as any[];
  
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files/directories within the current project workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path inside the project workspace. Default: .' },
            depth: { type: 'number', description: 'Directory traversal depth. Default: 3' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a text file from the current project workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path inside the project workspace.' },
            offset: { type: 'number', description: '1-based starting line number.' },
            limit: { type: 'number', description: 'Maximum lines to read.' }
          },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file inside the current project workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path inside the project workspace.' },
            content: { type: 'string', description: 'Full file content.' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace exact text in an existing file inside the current project workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path inside the project workspace.' },
            oldText: { type: 'string', description: 'Exact text to replace.' },
            newText: { type: 'string', description: 'Replacement text.' }
          },
          required: ['path', 'oldText', 'newText']
        }
      }
    }
  ];

  // 如果有团队成员（排除自己），添加委托工具
  const delegateOptions = teamAgents
    .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
    .map(a => a.name);
  
  if (delegateOptions.length > 0) {
    tools.push({
      type: 'function',
      function: {
        name: 'delegate_to_agent',
        description: 'As the team coordinator, delegate a task to a team member with specific expertise.',
        parameters: {
          type: 'object',
          properties: {
            agent_name: { 
              type: 'string', 
              description: `Name of the team member to delegate to. Available: ${delegateOptions.join(', ')}` 
            },
            task: { type: 'string', description: 'Clear and specific task description for the delegate.' },
            context: { type: 'string', description: 'Relevant context, requirements, or information the delegate needs.' }
          },
          required: ['agent_name', 'task']
        }
      }
    });
  }

  return tools;
}

async function executeToolCall(project: any, toolCall: ToolCall, allProjectAgents: any[], allEnabledSkills: any[]) {
  const fn = toolCall.function?.name;
  const rawArgs = toolCall.function?.arguments || '{}';
  const args = JSON.parse(rawArgs || '{}');

  switch (fn) {
    case 'list_files':
      return await FileToolService.listFiles(project.workspace, args.path || '.', Number(args.depth) || 3);
    case 'read_file':
      return await FileToolService.readFile(project.workspace, args.path, Number(args.offset) || 1, Number(args.limit) || 200);
    case 'write_file':
      return await FileToolService.writeFile(project.workspace, args.path, args.content || '');
    case 'edit_file':
      return await FileToolService.editFile(project.workspace, args.path, args.oldText || '', args.newText || '');
    case 'delegate_to_agent':
      return await executeAgentDelegation(project, args, allProjectAgents, allEnabledSkills);
    default:
      throw new Error(`未知工具: ${fn}`);
  }
}

// Agent 委托执行
async function executeAgentDelegation(project: any, args: any, allProjectAgents: any[], allEnabledSkills: any[]) {
  const { agent_name, task, context } = args;
  
  // 查找目标 Agent
  const targetAgent = allProjectAgents.find((a: any) => 
    a.name?.toLowerCase().includes(agent_name?.toLowerCase()) ||
    agent_name?.toLowerCase().includes(a.name?.toLowerCase())
  );
  
  if (!targetAgent) {
    return { error: `Agent "${agent_name}" not found. Available agents: ${allProjectAgents.map(a => a.name).join(', ')}` };
  }

  console.log(`[Delegation] Task delegated to: ${targetAgent.name}, Task: ${task.slice(0, 50)}...`);

  // 构建委托 Agent 的系统提示词
  const skillsPrompt = allEnabledSkills.length > 0 
    ? '\n\n## AVAILABLE SKILLS\n' + allEnabledSkills.map(s => `### ${s.name}\n${s.description || ''}\n\`\`\`\n${s.rawContent || s.content || ''}\n\`\`\``).join('\n\n')
    : '';

  const delegationSystemPrompt = `You are **${targetAgent.name}**${targetAgent.role ? ` (${targetAgent.role})` : ''}. ${targetAgent.description || ''}
${targetAgent.instructions ? `\n## YOUR INSTRUCTIONS\n${targetAgent.instructions}` : ''}
${skillsPrompt}

## IMPORTANT
- You are being delegated a task by another team member
- Focus ONLY on the delegated task
- Provide clear, actionable results
- If you need to read files, use the available tools`;

  // 构建委托对话的消息
  const delegationMessages = [
    { role: 'system', content: delegationSystemPrompt },
    { role: 'user', content: `## DELEGATED TASK\n${task}\n\n${context ? `## CONTEXT\n${context}` : ''}` }
  ];

  // 获取模型配置
  const allModels = await DbService.getModels();
  const defaultModel = allModels[0];
  if (!defaultModel) {
    return { error: 'No model available for delegation' };
  }

  const apiUrl = `${defaultModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: defaultModel.modelId,
        messages: delegationMessages,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result: any = await response.json();
    const delegationResult = result.choices?.[0]?.message?.content || 'Task completed with no result';

    return {
      success: true,
      agent: targetAgent.name,
      task: task,
      result: delegationResult
    };
  } catch (error: any) {
    return { error: `Delegation failed: ${error.message}` };
  }
}

function extractToolCalls(choice: any): ToolCall[] {
  if (Array.isArray(choice?.message?.tool_calls)) return choice.message.tool_calls;
  if (Array.isArray(choice?.delta?.tool_calls)) return choice.delta.tool_calls;
  return [];
}

export async function ChatRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return await DbService.getChats(projectId);
  });

  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getChat(id);
  });

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

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteChat(id);
  });

  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId } = request.params as any;
    const { content, attachments } = request.body as any;

    console.log(`[SSE Start] ChatID: ${chatId}, Content: ${content?.slice(0, 50)}..., Attachments: ${attachments?.length || 0}`);
    
    // 解析被提及的 Agent 名称
    const mentionedAgentNames = content?.match(/@([^\s@]+)/g)?.map((m: string) => m.substring(1)) || [];
    
    // 清理消息中的 @AgentName
    const cleanContent = content?.replace(/@([^\s@]+)/g, '$1').trim() || '';

    await DbService.addMessageToChat(chatId, { 
      role: 'user', 
      content: cleanContent,
      mentions: mentionedAgentNames,
      attachments: attachments || []
    } as any);

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.write(`data: ${JSON.stringify({ chunk: '' })}\n\n`);

    let fullAssistantContent = '';

    try {
      const projects = await DbService.getProjects();
      const chats = await DbService.getChats();
      const chat = chats.find(c => String(c.id) === String(chatId));
      const project = projects.find(p => p.id === chat?.projectId);
      const allModels = await DbService.getModels();
      
      if (!project) throw new Error('未找到所属项目');
      if (!allModels || allModels.length === 0) throw new Error('系统中未配置任何模型');

      // 清理消息中的 @AgentName（保留用于通知）
      const mentionedAgentNames = content.match(/@([^\s@]+)/g)?.map((m: string) => m.substring(1)) || [];
      let cleanContent = content.replace(/@([^\s@]+)/g, '$1').trim();

      // 获取项目的 Agent 列表
      const enabledAgentIds = project?.enabledAgentIds || [];
      const allGlobalAgents = await DbService.getAgents();
      const projectPrivateAgents = project?.projectAgents || [];
      const allProjectAgents = [
        ...allGlobalAgents.filter(a => enabledAgentIds.includes(a.id)),
        ...projectPrivateAgents
      ];

      // --- 1. 获取主协调 Agent ---
      // 优先使用项目指定的主协调 Agent，否则使用默认 Agent
      const coordinatorAgentId = project?.coordinatorAgentId || chat?.agentId || project?.defaultAgentId || '1';
      const coordinatorAgent = allProjectAgents.find((a: any) => String(a.id) === String(coordinatorAgentId));
      
      let agentRolePrompt = '';
      if (coordinatorAgent) {
        agentRolePrompt = `\n## YOUR IDENTITY\nYou are **${coordinatorAgent.name}**${coordinatorAgent.role ? ` (${coordinatorAgent.role})` : ''}. ` +
          `${coordinatorAgent.description || 'A professional AI assistant.'}\n`;
        if (coordinatorAgent.instructions) {
          agentRolePrompt += `\n## YOUR INSTRUCTIONS\n${coordinatorAgent.instructions}\n`;
        }
      }

      // --- 2. 可委托的团队成员列表（排除自己） ---
      const availableDelegates = allProjectAgents
        .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
        .map(a => a.name);
      
      let teamPrompt = '';
      if (availableDelegates.length > 0) {
        const delegateDetails = allProjectAgents
          .filter((a: any) => String(a.id) !== String(coordinatorAgentId))
          .map((a: any) => `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${a.description || ''}`)
          .join('\n');
        teamPrompt = `\n\n## YOUR TEAM\nYou can delegate tasks to these team members:\n${delegateDetails}`;
      }

      // --- 3. 技能（自动可用） ---
      const enabledSkillIds = project?.enabledSkillIds || [];
      const allGlobalSkills = await DbService.getGlobalSkills();
      const globalProjectSkills = allGlobalSkills.filter(s => enabledSkillIds.includes(s.id));
      const projectPrivateSkills = project?.projectSkills || [];
      const allEnabledSkills = [...globalProjectSkills, ...projectPrivateSkills];

      // --- 4. 构建系统消息 ---
      const systemMessage = {
        role: 'system',
        content: `You are an AI assistant working inside project workspace: **${project.workspace}**\n` +
          `Project: ${project.name}\n` +
          `${agentRolePrompt}` +
          `${teamPrompt}` +
          `\n\n## IMPORTANT RULES\n` +
          `- When a task requires specific expertise, delegate it to the appropriate team member\n` +
          `- Always use read_file before editing files\n` +
          `- You can understand and analyze images when provided\n` +
          `- Provide clear, concise, and helpful responses`
      };

      // --- 构造候选模型队列 (故障转移) ---
      const activeModelId = chat?.modelId || project?.defaultModel;
      const primaryModel = allModels.find(m => m.id === activeModelId) || allModels[0];
      const fallbackModels = allModels.filter(m => m.id !== primaryModel.id);
      const modelsToTry = [primaryModel, ...fallbackModels].slice(0, 3); // 最多尝试前3个模型

      // 获取工具
      const tools = getFileToolsForProject(project, allProjectAgents, coordinatorAgentId);

      const chatWithHistory = await DbService.getChat(chatId);
      const historyMessages = chatWithHistory?.messages || [];
      const CONTEXT_WINDOW = 20;
      const INITIAL_INTENT_COUNT = 2;

      // 转换消息格式，支持附件（图片等）
      const transformMessage = (m: any): any => {
        const base = { role: m.role };
        
        // 如果有附件（图片等），使用多模态格式
        if (m.attachments && m.attachments.length > 0) {
          const content: any[] = [];
          
          // 添加文本内容
          if (m.content && m.content.trim()) {
            content.push({ type: 'text', text: m.content });
          }
          
          // 添加图片附件
          m.attachments.forEach((att: any) => {
            if (att.type?.startsWith('image/') || att.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
              // 支持 base64 dataUrl 或 URL
              if (att.dataUrl) {
                content.push({
                  type: 'image_url',
                  image_url: { url: att.dataUrl }
                });
              }
            } else {
              // 非图片附件，在文本中提及
              if (m.content) {
                content.push({ type: 'text', text: `${m.content}\n\n[附件: ${att.name}]` });
              } else {
                content.push({ type: 'text', text: `[附件: ${att.name}]` });
              }
            }
          });
          
          return { ...base, content: content.length > 0 ? content : m.content || '' };
        }
        
        // 无附件，使用普通格式
        return { ...base, content: m.content || '' };
      };

      let apiMessages: any[] = [];
      if (historyMessages.length > CONTEXT_WINDOW + INITIAL_INTENT_COUNT) {
        apiMessages = [
          ...historyMessages.slice(0, INITIAL_INTENT_COUNT).map(transformMessage),
          ...historyMessages.slice(-CONTEXT_WINDOW).map(transformMessage)
        ];
      } else {
        apiMessages = historyMessages.map(transformMessage);
      }

      
      // --- 模型重试外层循环 ---
      let success = false;
      let lastError = '';
      let pickedModelCfg: any = null;

      for (const modelCfg of modelsToTry) {
        if (success) break;

        console.log(`[Model Try] Using Model: ${modelCfg.name} (${modelCfg.modelId})`);
        const apiUrl = `${modelCfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        
        const finalMessages: any[] = [
          systemMessage,
          ...apiMessages.map((m: any) => ({ role: m.role, content: m.content }))
        ];

        try {
          let guard = 0;
          while (guard++ < 8) {
            const reqBody: any = {
              model: modelCfg.modelId,
              messages: finalMessages,
              stream: false
            };
            if (tools.length > 0) reqBody.tools = tools;

            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${modelCfg.apiKey}` 
              },
              body: JSON.stringify(reqBody)
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
              finalMessages.push({
                role: 'assistant',
                content: message.content || '',
                tool_calls: toolCalls
              });

              for (const toolCall of toolCalls) {
                let toolResult: any;
                try {
                  toolResult = await executeToolCall(project, toolCall, allProjectAgents, allEnabledSkills);
                } catch (err: any) {
                  toolResult = { error: err.message };
                }

                finalMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult, null, 2)
                });
              }
              continue;
            }

            fullAssistantContent = message.content || '';
            success = true;
            pickedModelCfg = modelCfg;
            break;
          }
        } catch (err: any) {
          console.error(`[Model Fail] ${modelCfg.name} failed: ${err.message}`);
          lastError = err.message;
        }
      }

      if (!success || !pickedModelCfg) {
        throw new Error(`所有模型均不可用。最后错误: ${lastError}`);
      }

      // --- 关键：如果发生了模型切换，通知前端并更新数据库 ---
      if (pickedModelCfg.id !== activeModelId) {
        console.log(`[Model Switch] Notifying UI & Updating DB: ${pickedModelCfg.name}`);
        
        // 1. 发送 SSE 通知块
        reply.raw.write(`data: ${JSON.stringify({ 
          info: `已自动切换至备用模型: ${pickedModelCfg.name}`,
          switchedModelId: pickedModelCfg.id 
        })}\n\n`);

        // 2. 持久化到数据库，让页面下拉框同步更新
        const db = await DbService.load();
        const chatToUpdate = db.chats.find((c: any) => String(c.id) === String(chatId));
        if (chatToUpdate) {
            chatToUpdate.modelId = pickedModelCfg.id;
            await DbService.save();
        }
      }

      if (fullAssistantContent) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: fullAssistantContent })}\n\n`);
        await DbService.addMessageToChat(chatId, { role: 'assistant', content: fullAssistantContent });
      }

      reply.raw.write(`data: [DONE]\n\n`);
    } catch (err: any) {
      console.error('[SSE Error Final]', err.message);
      reply.raw.write(`data: ${JSON.stringify({ chunk: `\n\n❌ 彻底失败: ${err.message}` })}\n\n`);
      reply.raw.write(`data: [DONE]\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
