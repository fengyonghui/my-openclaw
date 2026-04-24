/**
 * 项目会话路由 - 基于项目隔离的数据存储
 */

import { FastifyInstance } from 'fastify';
import { ProjectDataService } from '../services/ProjectDataService.js';
import { DbService } from '../services/DbService.js';

export async function ProjectChatRoutes(fastify: FastifyInstance) {
  
  // 获取项目的所有会话
  fastify.get('/chats', async (request, reply) => {
    const { projectId } = request.query as any;
    
    if (!projectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    // 获取项目工作区
    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === projectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);
    const chats = dataService.getChats();

    return { chats };
  });

  // 获取单个会话
  fastify.get('/chats/:id', async (request, reply) => {
    const { id, projectId } = request.params as any;
    const { projectId: queryProjectId } = request.query as any;
    const effectiveProjectId = projectId || queryProjectId;

    if (!effectiveProjectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === effectiveProjectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);
    const chat = dataService.getChat(id);

    if (!chat) {
      return reply.code(404).send({ error: '会话不存在' });
    }

    return chat;
  });

  // 创建新会话
  fastify.post('/chats', async (request, reply) => {
    const { projectId, name } = request.body as any;

    if (!projectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === projectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);
    const chat = dataService.createChat(name || '', projectId);

    return chat;
  });

  // 发送消息（SSE 流）
  fastify.post('/:id/send', async (request, reply) => {
    const { id: chatId, projectId } = request.params as any;
    const { content, attachments } = request.body as any;
    const effectiveProjectId = projectId || (request.query as any).projectId;

    if (!effectiveProjectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === effectiveProjectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);
    const chat = dataService.getChat(chatId);

    if (!chat) {
      return reply.code(404).send({ error: '会话不存在' });
    }

    // 添加用户消息
    dataService.addMessage(chatId, {
      role: 'user',
      content
    });

    // 设置 SSE 响应头
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    // TODO: 实现与模型的交互逻辑
    reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', content: '待实现：模型交互' })}\n\n`);
    reply.raw.write(`data: [DONE]\n\n`);

    return reply;
  });

  // 删除会话
  fastify.delete('/:id', async (request, reply) => {
    const { id, projectId } = request.params as any;
    const { projectId: queryProjectId } = request.query as any;
    const effectiveProjectId = projectId || queryProjectId;

    if (!effectiveProjectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === effectiveProjectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);
    const deleted = dataService.deleteChat(id);

    if (!deleted) {
      return reply.code(404).send({ error: '会话不存在' });
    }

    return { success: true };
  });

  // 加载项目上下文（MEMORY.md + REQUIREMENT.md + 会话历史）
  fastify.get('/context', async (request, reply) => {
    const { projectId, chatId } = request.query as any;

    if (!projectId) {
      return reply.code(400).send({ error: '缺少 projectId 参数' });
    }

    const projects = await DbService.getProjects();
    const project = projects.find((p: any) => p.id === projectId);
    
    if (!project) {
      return reply.code(404).send({ error: '项目不存在' });
    }

    const dataService = new ProjectDataService(project.workspace);

    const context: any = {
      projectId,
      projectName: project.name,
      workspace: project.workspace
    };

    // 1. 加载 MEMORY.md
    context.memory = dataService.loadMemory();
    
    // 2. 加载 REQUIREMENT.md
    context.requirement = dataService.loadRequirement();
    
    // 3. 加载当前会话历史
    if (chatId) {
      const chat = dataService.getChat(chatId);
      context.chat = chat;
      context.chatMessages = chat?.messages || [];
    } else {
      context.chat = null;
      context.chatMessages = [];
    }

    return context;
  });
}

export default ProjectChatRoutes;
