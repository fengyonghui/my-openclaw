import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ProjectRoutes(fastify: FastifyInstance) {
  // 获取项目列表
  fastify.get('/', async () => {
    return await DbService.getProjects();
  });

  // 获取单个项目详情
  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProject(id);
  });

  // 创建新项目
  fastify.post('/', async (request) => {
    const { name, description, parentDir } = request.body as any;
    return await DbService.createProject(name, description, parentDir);
  });

  // 导入现有项目目录
  fastify.post('/import', async (request) => {
    const { name, description, workspace } = request.body as any;
    return await DbService.importProject(name, description, workspace);
  });

  // 修改项目配置 (通用修改)
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    const project = await DbService.getProject(id);
    if (project) {
      Object.assign(project, updates);
      await DbService.saveProject(project);
    }
    return project;
  });

  // 删除项目
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteProject(id);
  });

  // 获取项目下的会话
  fastify.get('/:id/chats', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getChats(id);
  });

  // 获取项目下的 Agent
  fastify.get('/:id/agents', async () => {
    return await DbService.getAgents();
  });

  // 添加全局 Agent (暂时作为通用配置)
  fastify.post('/:id/agents', async (request) => {
    const agent = request.body as any;
    return await DbService.addAgent(agent);
  });

  // 删除 Agent
  fastify.delete('/:id/agents/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    return await DbService.deleteAgent(agentId);
  });

  // 修改 Agent
  fastify.patch('/:id/agents/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const updates = request.body as any;
    return await DbService.updateAgent(agentId, updates);
  });

  // 获取项目物理文件列表
  fastify.get('/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await DbService.getProject(id);
    if (!project || !project.workspace) return reply.status(404).send({ error: '项目未找到' });
    try {
      const results: any[] = [];
      async function scanDir(currentPath: string, relativeBase: string = '') {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          const relPath = path.join(relativeBase, entry.name);
          const stats = await fs.stat(fullPath);
          if (entry.isDirectory()) await scanDir(fullPath, relPath);
          else {
            const ext = path.extname(entry.name).toLowerCase();
            let type = 'file';
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) type = 'code';
            if (['.md', '.txt'].includes(ext)) type = 'doc';
            results.push({ name: relPath.replace(/\\/g, '/'), type, size: (stats.size / 1024).toFixed(1) + ' KB', updatedAt: stats.mtime.toISOString() });
          }
        }
      }
      await scanDir(project.workspace);
      return results;
    } catch (err: any) { return reply.status(500).send({ error: err.message }); }
  });

  // 项目记忆管理
  fastify.get('/:id/memory', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProjectMemories(id);
  });

  fastify.post('/:id/memory', async (request) => {
    const { id } = request.params as { id: string };
    const memory = request.body as any;
    return await DbService.addProjectMemory(id, memory);
  });

  // 获取项目的已启用 Skill
  fastify.get('/:id/skills', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProjectSkills(id);
  });

  // 获取所有可用 Skill (供项目安装)
  fastify.get('/:id/skills/available', async () => {
    return await DbService.getGlobalSkills();
  });

  // 开启/关闭项目 Skill
  fastify.post('/:id/skills/toggle', async (request) => {
    const { id } = request.params as { id: string };
    const { skillId } = request.body as { skillId: string };
    return await DbService.toggleProjectSkill(id, skillId);
  });
}
