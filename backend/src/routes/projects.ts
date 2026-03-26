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
  // ===== Agent 管理 =====
  // 获取项目可用的 Agent（全局启用 + 私有）
  fastify.get('/:id/agents', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProjectAgents(id);
  });

  // 获取所有全局 Agent
  fastify.get('/:id/agents/global', async () => {
    return await DbService.getAgents();
  });

  // 开启/关闭项目 Agent
  fastify.post('/:id/agents/toggle', async (request) => {
    const { id } = request.params as { id: string };
    const { agentId } = request.body as { agentId: string };
    return await DbService.toggleProjectAgent(id, agentId);
  });

  // ===== 项目私有 Agent 管理 =====
  // 获取项目私有 Agent 列表
  fastify.get('/:id/agents/private', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProjectPrivateAgents(id);
  });

  // 添加项目私有 Agent
  fastify.post('/:id/agents/private', async (request) => {
    const { id } = request.params as { id: string };
    const agent = request.body as any;
    return await DbService.addProjectPrivateAgent(id, agent);
  });

  // 删除项目私有 Agent
  fastify.delete('/:id/agents/private/:agentId', async (request) => {
    const { id, agentId } = request.params as { id: string; agentId: string };
    return await DbService.deleteProjectPrivateAgent(id, agentId);
  });

  // 更新项目私有 Agent
  fastify.patch('/:id/agents/private/:agentId', async (request) => {
    const { id, agentId } = request.params as { id: string; agentId: string };
    const updates = request.body as any;
    return await DbService.updateProjectPrivateAgent(id, agentId, updates);
  });

  // ===== 主协调 Agent 管理 =====
  // 设置项目的主协调 Agent
  fastify.post('/:id/coordinator', async (request) => {
    const { id } = request.params as { id: string };
    const { coordinatorAgentId } = request.body as { coordinatorAgentId: string | null };
    const project = await DbService.getProject(id);
    if (project) {
      project.coordinatorAgentId = coordinatorAgentId || null;
      await DbService.saveProject(project);
    }
    return project;
  });

  // ===== 全局 Agent 管理 (仅用于管理全局 Agent 池) =====
  // 获取全局 Agent 列表
  fastify.get('/global/agents', async () => {
    return await DbService.getAgents();
  });

  // 添加全局 Agent
  fastify.post('/global/agents', async (request) => {
    const agent = request.body as any;
    return await DbService.addAgent(agent);
  });

  // 删除全局 Agent
  fastify.delete('/global/agents/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    return await DbService.deleteAgent(agentId);
  });

  // 修改全局 Agent
  fastify.patch('/global/agents/:agentId', async (request) => {
    const { agentId } = request.params as { agentId: string };
    const updates = request.body as any;
    return await DbService.updateAgent(agentId, updates);
  });

  // 获取项目物理文件列表 (Windows 资源管理器模式：仅返回当前层级)
  fastify.get('/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { subPath = '', showHidden = 'false' } = request.query as { subPath?: string, showHidden?: string };
    const project = await DbService.getProject(id);
    if (!project || !project.workspace) return reply.status(404).send({ error: '项目未找到' });
    
    const ignorePatterns = project.ignorePatterns || ['node_modules', '.git', 'dist'];
    const absoluteTargetDir = path.join(project.workspace, subPath);

    // 安全检查：防止路径穿越
    if (!absoluteTargetDir.startsWith(path.resolve(project.workspace))) {
        return reply.status(403).send({ error: '禁止访问外部路径' });
    }

    try {
      const results: any[] = [];
      const entries = await fs.readdir(absoluteTargetDir, { withFileTypes: true });

      for (const entry of entries) {
        const relPath = path.join(subPath, entry.name).replace(/\\/g, '/');
        const isHidden = ignorePatterns.some(p => entry.name === p);
        
        if (isHidden && showHidden !== 'true') continue;

        const fullPath = path.join(absoluteTargetDir, entry.name);
        const stats = await fs.stat(fullPath);
        
        if (entry.isDirectory()) {
          results.push({ 
              name: entry.name, 
              path: relPath,
              kind: 'directory', 
              isHidden,
              updatedAt: stats.mtime.toISOString() 
          });
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          let type = 'file';
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) type = 'code';
          if (['.md', '.txt', '.json', '.yaml', '.yml'].includes(ext)) type = 'doc';
          
          results.push({ 
              name: entry.name, 
              path: relPath,
              kind: 'file',
              type, 
              isHidden,
              size: (stats.size / 1024).toFixed(1) + ' KB', 
              updatedAt: stats.mtime.toISOString() 
          });
        }
      }
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

  // ===== 项目私有技能管理 =====
  // 获取项目私有技能列表
  fastify.get('/:id/skills/private', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.getProjectPrivateSkills(id);
  });

  // 添加项目私有技能
  fastify.post('/:id/skills/private', async (request) => {
    const { id } = request.params as { id: string };
    const skill = request.body as any;
    return await DbService.addProjectPrivateSkill(id, skill);
  });

  // 删除项目私有技能
  fastify.delete('/:id/skills/private/:skillId', async (request) => {
    const { id, skillId } = request.params as { id: string; skillId: string };
    return await DbService.deleteProjectPrivateSkill(id, skillId);
  });

  // 更新项目私有技能
  fastify.patch('/:id/skills/private/:skillId', async (request) => {
    const { id, skillId } = request.params as { id: string; skillId: string };
    const updates = request.body as any;
    return await DbService.updateProjectPrivateSkill(id, skillId, updates);
  });
}
