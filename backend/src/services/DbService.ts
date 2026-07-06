import { readFile, writeFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { BUILTIN_FILE_IO_SKILL, BUILTIN_INLINE_PYTHON_SKILL, BUILTIN_SHELL_CMD_SKILL } from './BuiltinSkills.js';

const DB_PATH = path.resolve(process.cwd(), 'data/db.json');
const CURRENT_VERSION = 3;

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
}

export class DbService {
  private static data: any = null;
  private static tableMetadataCache: Map<string, any> = new Map(); // 缓存：tableName -> metadata

  static async load() {
    try {
      const content = await readFile(DB_PATH, 'utf-8');
      this.data = JSON.parse(content);
      // 版本迁移
      await this.migrateToV3();
      return this.data;
    } catch (err) {
      const initial = {
        version: CURRENT_VERSION,
        projects: [],
        agents: [],
        chats: [],
        availableModels: [],
        availableSkills: [],
        memories: []
      };
      await mkdir(path.dirname(DB_PATH), { recursive: true });
      await writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      this.data = initial;
      return initial;
    }
  }

  static async save() {
    if (!this.data) return;
    await writeFile(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ============================================================
  // 版本迁移 (Migration)
  // ============================================================

  private static getProjectAgentsDir(projectWorkspace: string): string {
    return path.join(projectWorkspace, 'agents');
  }

  // v1: agents 在 db.json
  // v2: agents 在 backend/agents/ (全局)
  // v3: agents 在各项目的 workspace/agents/ (项目私有)
  private static async migrateToV3() {
    const db = this.data;
    const version = db.version ?? 1;

    if (version >= CURRENT_VERSION) return;

    console.log(`[Migration] 检测到旧版本 (v${version})，正在迁移到 v${CURRENT_VERSION}...`);

    // --- v1 → v2: db.json agents 迁移到 backend/agents/ ---
    if (version === 1 && (db.agents ?? []).length > 0) {
      const globalAgentsDir = path.resolve(process.cwd(), 'agents');
      await mkdir(globalAgentsDir, { recursive: true });
      for (const agent of db.agents) {
        const fileName = this.agentIdToFileName(agent);
        await writeFile(path.join(globalAgentsDir, fileName), JSON.stringify(agent, null, 2), 'utf-8');
      }
      console.log(`[Migration] v1 → v2: ${db.agents.length} 个 Agent 已写入 backend/agents/`);
      db.agents = [];
    }

    // --- v2 → v3: backend/agents/ 迁移到各项目 workspace/agents/ ---
    if (version <= 2) {
      const globalAgentsDir = path.resolve(process.cwd(), 'agents');
      try {
        const files = (await readdir(globalAgentsDir)).filter(f => f.endsWith('.json'));
        for (const proj of db.projects ?? []) {
          if (!proj.workspace) continue;
          const projAgentsDir = this.getProjectAgentsDir(proj.workspace);
          await mkdir(projAgentsDir, { recursive: true });
          for (const file of files) {
            const content = await readFile(path.join(globalAgentsDir, file), 'utf-8');
            await writeFile(path.join(projAgentsDir, file), content, 'utf-8');
          }
          console.log(`[Migration] v2 → v3: Agent 已复制到 ${projAgentsDir}/`);
        }
      } catch {
        console.log(`[Migration] v2 → v3: backend/agents/ 不存在，跳过`);
      }
    }

    db.version = CURRENT_VERSION;
    await this.save();
    console.log(`[Migration] 完成，已升级到 v${CURRENT_VERSION}`);
  }

  private static agentIdToFileName(agent: any): string {
    const id = String(agent.id);
    const knownFiles: Record<string, string> = {
      '1': 'product-manager.json',
      '2': 'backend.json',
      '1774659173367': 'ux.json',
      '1774670276206': 'qa.json',
    };
    if (knownFiles[id]) return knownFiles[id];
    const safeName = (agent.name || 'agent').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return `${safeName}-${id}.json`;
  }

  // --- 项目记忆管理 ---
  // 单一数据源：从 MEMORY.md 文件读取，不再维护 db.json 副本
  static async getProjectMemories(projectId: string) {
    const db = await this.load();
    const project = db.projects?.find((p: any) => p.id === projectId);
    if (!project) return [];

    // 从 MEMORY.md 文件读取（单一数据源）
    try {
      const { loadMemoryFile } = await import('../routes/chats/MemoryFileHandler.js');
      const content = loadMemoryFile(project.workspace);
      // 解析记忆条目格式: - [category] content（来源: source）
      const lines = content.split('\n');
      const memories: any[] = [];
      for (const line of lines) {
        const m = line.match(/^\s*-\s*\[(.+?)\]\s*(.+?)（来源:\s*(.+?)\)/);
        if (m) {
          memories.push({
            id: `mem_${memories.length}`,
            projectId,
            category: m[1] as any,
            content: m[2].trim(),
            source: m[3].trim(),
            createdAt: new Date().toISOString()
          });
        }
      }
      return memories;
    } catch {
      return [];
    }
  }

  // 保留 addProjectMemory 用于前端 API 兼容（实际写入 MEMORY.md）
  static async addProjectMemory(projectId: string, memory: any) {
    const db = await this.load();
    const project = db.projects?.find((p: any) => p.id === projectId);
    if (!project) return null;

    const { saveToMemoryFile } = await import('../routes/chats/MemoryFileHandler.js');
    const result = await saveToMemoryFile(`请注意: ${memory.content}`, project.workspace);
    return result === 'success' ? memory : null;
  }

  // --- 全局模型 CRUD ---
  static async getModels() {
    const db = await this.load();
    return db.availableModels || [];
  }

  static async addGlobalModel(config: ModelConfig) {
    const db = await this.load();
    const newModel = { ...config, id: config.id || config.modelId || Date.now().toString(), temperature: config.temperature ?? 0.7, maxTokens: config.maxTokens ?? 4096 };
    db.availableModels.push(newModel);
    await this.save();
    return db.availableModels;
  }

  static async deleteGlobalModel(id: string) {
    const db = await this.load();
    db.availableModels = db.availableModels.filter((m: any) => m.id !== id);
    await this.save();
    return db.availableModels;
  }

  // --- 项目管理 ---
  static async getProjects() {
    const db = await this.load();
    return db.projects || [];
  }

  static async getProject(id: string) {
    const projects = await this.getProjects();
    return projects.find((p: any) => p.id === id);
  }

  static async saveProject(project: any) {
    const db = await this.load();
    const index = db.projects.findIndex((p: any) => p.id === project.id);
    if (index !== -1) {
      db.projects[index] = project;
      await this.save();
    }
  }

  static async deleteProject(id: string) {
    const db = await this.load();
    db.projects = db.projects.filter((p: any) => p.id !== id);
    db.chats = db.chats.filter((c: any) => c.projectId !== id);
    if (db.memories) db.memories = db.memories.filter((m: any) => m.projectId !== id);
    await this.save();
    return db.projects;
  }

  static async createProject(name: string, description: string, parentDir: string) {
    const db = await this.load();
    const baseId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    let id = baseId || `project-${Date.now()}`;
    let counter = 1;
    while ((db.projects || []).some((p: any) => p.id === id)) {
      id = `${baseId}-${counter++}`;
    }

    const safeParentDir = parentDir || process.cwd();
    const workspace = path.join(safeParentDir, name || id);
    try {
      await mkdir(workspace, { recursive: true });
    } catch (err: any) {
      throw new Error(`无法创建物理目录: ${err.message}`);
    }

    const newProject = {
      id,
      name: name || id,
      description: description || '',
      workspace,
      defaultAgentId: '1',
      defaultModel: db.availableModels?.[0]?.id || '',
      ignorePatterns: ['node_modules', '.git', 'dist', '.DS_Store', 'package-lock.json'],
      enabledSkillIds: [],
      projectSkills: [],
      enabledAgentIds: [],
      projectAgents: [],
      coordinatorAgentId: null,
      createdAt: new Date().toISOString()
    };

    db.projects.push(newProject);
    await this.save();
    return newProject;
  }

  static async importProject(name: string, description: string, workspace: string) {
    const db = await this.load();
    if (!workspace) throw new Error('workspace 不能为空');

    const st = await stat(workspace).catch(() => null as any);
    if (!st || !st.isDirectory()) {
      throw new Error('workspace 目录不存在或不是文件夹');
    }

    const inferredName = name || path.basename(workspace);
    const baseId = inferredName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
    let id = baseId || `project-${Date.now()}`;
    let counter = 1;
    while ((db.projects || []).some((p: any) => p.id === id)) {
      id = `${baseId}-${counter++}`;
    }

    const newProject = {
      id,
      name: inferredName,
      description: description || '',
      workspace,
      defaultAgentId: '1',
      defaultModel: db.availableModels?.[0]?.id || '',
      ignorePatterns: ['node_modules', '.git', 'dist', '.DS_Store', 'package-lock.json'],
      enabledSkillIds: [],
      projectSkills: [],
      enabledAgentIds: [],
      projectAgents: [],
      coordinatorAgentId: null,
      createdAt: new Date().toISOString()
    };

    db.projects.push(newProject);
    await this.save();
    return newProject;
  }

  // --- 会话管理 ---
  static async getChats(projectId?: string) {
    const db = await this.load();
    return projectId ? db.chats.filter((c: any) => c.projectId === projectId) : db.chats;
  }

  static async getChat(id: string) {
    const db = await this.load();
    return db.chats.find((c: any) => String(c.id) === String(id));
  }

  static async createChat(projectId: string, title: string, agentId: string) {
    const db = await this.load();
    const newChat = { id: Date.now().toString(), projectId, title: title || '新会话', agentId, messages: [], updatedAt: new Date().toISOString() };
    db.chats.unshift(newChat);
    await this.save();
    return newChat;
  }

  static async deleteChat(id: string) {
    const db = await this.load();
    db.chats = db.chats.filter((c: any) => String(c.id) !== String(id));
    await this.save();
    return db.chats;
  }

  static async deleteMessagesFrom(chatId: string, fromMessageId: string) {
    const db = await this.load();
    const chat = db.chats.find((c: any) => String(c.id) === String(chatId));
    if (!chat) throw new Error('Chat not found');
    if (!chat.messages) return chat;
    const idx = chat.messages.findIndex((m: any) => String(m.id) === String(fromMessageId));
    if (idx === -1) return chat;
    chat.messages = chat.messages.slice(0, idx);
    chat.updatedAt = new Date().toISOString();
    await this.save();
    return chat;
  }

  static async addMessageToChat(chatId: string, message: { role: string, content: string }) {
    const db = await this.load();
    const chat = db.chats.find((c: any) => String(c.id) === String(chatId));
    if (!chat) {
      console.error(`[DB] Chat not found: ${chatId}`);
      return null;
    }
    if (!chat.messages) chat.messages = [];
    chat.messages.push({ ...message, id: Date.now().toString(), timestamp: new Date().toISOString() });
    chat.updatedAt = new Date().toISOString();
    await this.save();
    console.log(`[DB] Message saved to chat ${chatId}: role=${message.role}, content=${message.content?.slice(0, 50)}...`);
    return chat;
  }

  // --- Agent 管理 ---
  // 从项目的 agents/*.json 文件加载 Agent 定义
  static async loadAgentsFromProjectDir(projectWorkspace: string) {
    try {
      const agentsDir = this.getProjectAgentsDir(projectWorkspace);
      const files = (await readdir(agentsDir)).filter(f => f.endsWith('.json'));
      const agents = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(path.join(agentsDir, file), 'utf-8');
          return JSON.parse(content);
        })
      );
      return agents;
    } catch {
      return [];
    }
  }

  // 全局 agents 回退目录（backend/agents/）
  private static getGlobalAgentsDir(): string {
    return path.resolve(process.cwd(), 'agents');
  }

  static async loadAgentsFromFiles() {
    try {
      const dir = this.getGlobalAgentsDir();
      const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
      const agents = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(path.join(dir, file), 'utf-8');
          return JSON.parse(content);
        })
      );
      return agents;
    } catch {
      return [];
    }
  }

  static async getAgents(projectId?: string) {
    // 优先从项目 workspace/agents/ 加载
    if (projectId) {
      const project = await this.getProject(projectId);
      if (project?.workspace) {
        const fileAgents = await this.loadAgentsFromProjectDir(project.workspace);
        if (fileAgents.length > 0) return fileAgents;
      }
    }
    // 回退：从 backend/agents/ 加载（全局 agents）
    const fileAgents = await this.loadAgentsFromFiles();
    if (fileAgents.length > 0) return fileAgents;
    // 再回退：db.json（兼容旧数据）
    const db = await this.load();
    return db.agents || [];
  }

  static async addAgent(agent: any) {
    const db = await this.load();
    const newAgent = { ...agent, id: Date.now().toString(), status: 'idle' };
    db.agents.push(newAgent);
    await this.save();
    // 同时写入 backend/agents/ 目录（getAgents 优先读文件）
    try {
      const dir = this.getGlobalAgentsDir();
      await mkdir(dir, { recursive: true });  // 确保目录存在
      await writeFile(path.join(dir, `${newAgent.id}.json`), JSON.stringify(newAgent, null, 2), 'utf-8');
      console.log(`[addAgent] Wrote agent to ${path.join(dir, `${newAgent.id}.json`)}`);
    } catch (err) {
      console.error('[addAgent] Failed to write agent file:', err);
    }
    return db.agents;
  }

  static async updateAgent(id: string, updates: any) {
    const db = await this.load();
    const index = db.agents.findIndex((a: any) => String(a.id) === String(id));
    if (index !== -1) {
      db.agents[index] = { ...db.agents[index], ...updates };
      await this.save();
    }
    // 同步更新 backend/agents/ 下的文件
    try {
      const agentFile = path.join(this.getGlobalAgentsDir(), `${id}.json`);
      if (existsSync(agentFile)) {
        const content = await readFile(agentFile, 'utf-8');
        const agent = JSON.parse(content);
        await writeFile(agentFile, JSON.stringify({ ...agent, ...updates }, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error('[updateAgent] Failed to sync agent file:', err);
    }
    return db.agents;
  }

  static async getAgent(id: string) {
    const db = await this.load();
    return db.agents.find((a: any) => String(a.id) === String(id));
  }

  static async deleteAgent(id: string) {
    const db = await this.load();
    db.agents = db.agents.filter((a: any) => String(a.id) !== String(id));
    await this.save();
    // 同时删除 backend/agents/ 下的文件
    try {
      const agentFile = path.join(this.getGlobalAgentsDir(), `${id}.json`);
      if (existsSync(agentFile)) {
        await unlink(agentFile);
      }
    } catch (err) {
      console.error('[deleteAgent] Failed to remove agent file:', err);
    }
    return db.agents;
  }

  // --- 项目私有 Agent 管理 ---
  static async getProjectPrivateAgents(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    return project.projectAgents || [];
  }

  // 生成文件名（PA_{slugified_name}.json）
  private static slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  private static getPrivateAgentFilePath(workspace: string, agent: any): string {
    const name = this.slugify(agent.name || agent.id);
    return path.join(this.getProjectAgentsDir(workspace), `PA_${name}.json`);
  }

  static async addProjectPrivateAgent(projectId: string, agent: any) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectAgents) project.projectAgents = [];
    const newAgent = {
      ...agent,
      id: agent.id || `PA_${Date.now()}`,
      isPrivate: true,
      createdAt: new Date().toISOString()
    };
    project.projectAgents.push(newAgent);
    await this.saveProject(project);
    // 同时写入项目的 agents/ 目录（与 loadAgentsFromProjectDir 读取路径一致）
    if (project.workspace) {
      try {
        const agentsDir = this.getProjectAgentsDir(project.workspace);
        await mkdir(agentsDir, { recursive: true });
        await writeFile(this.getPrivateAgentFilePath(project.workspace, newAgent), JSON.stringify(newAgent, null, 2), 'utf-8');
      } catch (err) {
        console.error('[addProjectPrivateAgent] Failed to write agent file:', err);
      }
    }
    return project.projectAgents;
  }

  static async deleteProjectPrivateAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectAgents) project.projectAgents = [];
    const agentToDelete = project.projectAgents.find((a: any) => a.id === agentId);
    project.projectAgents = project.projectAgents.filter((a: any) => a.id !== agentId);
    await this.saveProject(project);
    // 同时删除项目的 agents/ 目录下的文件（旧名和新名都要尝试）
    if (project.workspace && agentToDelete) {
      try {
        const agentsDir = this.getProjectAgentsDir(project.workspace);
        const oldFile = path.join(agentsDir, `${agentId}.json`); // 旧文件名（ID直接命名）
        const newFile = this.getPrivateAgentFilePath(project.workspace, agentToDelete); // 新文件名（PA_name.json）
        if (existsSync(oldFile)) await unlink(oldFile);
        if (oldFile !== newFile && existsSync(newFile)) await unlink(newFile);
      } catch (err) {
        console.error('[deleteProjectPrivateAgent] Failed to delete agent file:', err);
      }
    }
    return project.projectAgents;
  }

  static async updateProjectPrivateAgent(projectId: string, agentId: string, updates: any) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectAgents) project.projectAgents = [];
    const index = project.projectAgents.findIndex((a: any) => a.id === agentId);
    if (index !== -1) {
      project.projectAgents[index] = { ...project.projectAgents[index], ...updates };
      await this.saveProject(project);
      // 同时更新项目的 agents/ 目录下的文件
      if (project.workspace) {
        try {
          const agentFile = this.getPrivateAgentFilePath(project.workspace, project.projectAgents[index]);
          await writeFile(agentFile, JSON.stringify(project.projectAgents[index], null, 2), 'utf-8');
        } catch (err) {
          console.error('[updateProjectPrivateAgent] Failed to update agent file:', err);
        }
      }
    }
    return project.projectAgents;
  }

  static async toggleProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.workspace) throw new Error('项目没有 workspace');

    const globalAgentsDir = path.resolve(process.cwd(), 'agents');
    const globalFileName = await this.findGlobalAgentFile(agentId);
    if (!globalFileName) throw new Error('全局 Agent 不存在: ' + agentId);

    const projAgentsDir = this.getProjectAgentsDir(project.workspace);
    const projAgentFile = path.join(projAgentsDir, globalFileName);

    if (!project.enabledAgentIds) project.enabledAgentIds = [];

    if (project.enabledAgentIds.includes(agentId)) {
      // 停用：删除项目目录下的 agent 文件
      project.enabledAgentIds = project.enabledAgentIds.filter(id => id !== agentId);
      try { await this.deleteFile(projAgentFile); } catch { /* 文件不存在则忽略 */ }
    } else {
      // 启用：复制全局 agent 文件到项目目录
      await mkdir(projAgentsDir, { recursive: true });
      const src = path.join(globalAgentsDir, globalFileName);
      const content = await readFile(src, 'utf-8');
      await writeFile(projAgentFile, content, 'utf-8');
      project.enabledAgentIds.push(agentId);
    }

    await this.saveProject(project);
    return project.enabledAgentIds;
  }

  // 根据 agentId 在 backend/agents/ 中找到对应文件名
  private static async findGlobalAgentFile(agentId: string): Promise<string | null> {
    const globalAgentsDir = path.resolve(process.cwd(), 'agents');
    console.log(`[findGlobalAgentFile] Searching in ${globalAgentsDir} for agentId=${agentId}`);
    try {
      const files = (await readdir(globalAgentsDir)).filter(f => f.endsWith('.json'));
      console.log(`[findGlobalAgentFile] Found ${files.length} files: ${files.join(', ')}`);
      for (const file of files) {
        const content = await readFile(path.join(globalAgentsDir, file), 'utf-8');
        const agent = JSON.parse(content);
        if (String(agent.id) === String(agentId)) {
          console.log(`[findGlobalAgentFile] Matched: ${file} (agent.id=${agent.id})`);
          return file;
        }
      }
    } catch (err) {
      console.error(`[findGlobalAgentFile] Error reading agents dir: ${(err as Error).message}`);
    }
    console.log(`[findGlobalAgentFile] Not found for agentId=${agentId}`);
    return null;
  }

  private static async deleteFile(filePath: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
  }

  // 更新项目目录下的 agent 文件（支持项目定制化描述）
  static async updateProjectAgentFile(projectWorkspace: string, agentId: string, updates: any) {
    const agentsDir = this.getProjectAgentsDir(projectWorkspace);
    const files = (await readdir(agentsDir)).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = await readFile(path.join(agentsDir, file), 'utf-8');
      const agent = JSON.parse(content);
      if (String(agent.id) === String(agentId)) {
        const merged = { ...agent, ...updates };
        await writeFile(path.join(agentsDir, file), JSON.stringify(merged, null, 2), 'utf-8');
        return;
      }
    }
    throw new Error('项目 Agent 不存在: ' + agentId);
  }

  // 获取项目可用的所有 Agent（从项目 workspace/agents/ 目录读取 = 已启用的）
  static async getProjectAgents(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) return [];

    const fileAgents = project.workspace
      ? await this.loadAgentsFromProjectDir(project.workspace)
      : [];

    const privateAgents = project?.projectAgents || [];
    // 去重：私有 Agent（isPrivate=true 或 ID 以 PA_ 开头）以 db.json 为准，
    // 避免与 loadAgentsFromProjectDir 读到的同名文件重复
    const privateIds = new Set(privateAgents.map((a: any) => String(a.id)));
    const uniqueFileAgents = fileAgents.filter((a: any) => !privateIds.has(String(a.id)));
    return [...uniqueFileAgents, ...privateAgents];
  }

  // --- Skill 管理 ---
  static async getGlobalSkills() {
    const db = await this.load();
    const storedSkills = db.availableSkills || [];
    return [BUILTIN_FILE_IO_SKILL, BUILTIN_INLINE_PYTHON_SKILL, BUILTIN_SHELL_CMD_SKILL, ...storedSkills.filter((s: any) => s.id !== BUILTIN_FILE_IO_SKILL.id && s.id !== BUILTIN_INLINE_PYTHON_SKILL.id && s.id !== BUILTIN_SHELL_CMD_SKILL.id)];
  }

  static async addGlobalSkill(skill: any) {
    const db = await this.load();
    const newSkill = { ...skill, id: skill.id || Date.now().toString(), createdAt: new Date().toISOString() };
    if (!db.availableSkills) db.availableSkills = [];
    db.availableSkills.push(newSkill);
    await this.save();
    return await this.getGlobalSkills();
  }

  static async getProjectSkills(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) return [];
    const globalSkills = await this.getGlobalSkills();
    const skillIds = project?.enabledSkillIds || [];
    const enabledGlobalSkills = globalSkills.filter((s: any) => skillIds.includes(s.id));
    const privateSkills = project?.projectSkills || [];
    return [...enabledGlobalSkills, ...privateSkills];
  }

  static async toggleProjectSkill(projectId: string, skillId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.enabledSkillIds) project.enabledSkillIds = [];
    const index = project.enabledSkillIds.indexOf(skillId);
    if (index === -1) project.enabledSkillIds.push(skillId);
    else project.enabledSkillIds.splice(index, 1);
    await this.saveProject(project);
    return project.enabledSkillIds;
  }

  // --- 项目私有技能管理 ---
  static async getProjectPrivateSkills(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    return project.projectSkills || [];
  }

  static async addProjectPrivateSkill(projectId: string, skill: any) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectSkills) project.projectSkills = [];
    const newSkill = {
      ...skill,
      id: skill.id || `project-skill-${Date.now()}`,
      isPrivate: true,
      createdAt: new Date().toISOString()
    };
    project.projectSkills.push(newSkill);
    await this.saveProject(project);
    return project.projectSkills;
  }

  static async deleteProjectPrivateSkill(projectId: string, skillId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectSkills) project.projectSkills = [];
    project.projectSkills = project.projectSkills.filter((s: any) => s.id !== skillId);
    await this.saveProject(project);
    return project.projectSkills;
  }

  static async updateProjectPrivateSkill(projectId: string, skillId: string, updates: any) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectSkills) project.projectSkills = [];
    const index = project.projectSkills.findIndex((s: any) => s.id === skillId);
    if (index !== -1) {
      project.projectSkills[index] = { ...project.projectSkills[index], ...updates };
      await this.saveProject(project);
    }
    return project.projectSkills;
  }

  // ============================================================
  // 表元数据管理 (TableMetadata)
  // ============================================================

  static async getTableMetadataList(keyword?: string) {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    if (!keyword) return db.tableMetadata;
    const kw = keyword.toLowerCase();
    return db.tableMetadata.filter((m: any) =>
      m.tableName.toLowerCase().includes(kw) ||
      (m.businessKeywords || '').toLowerCase().includes(kw) ||
      m.displayName.toLowerCase().includes(kw)
    );
  }

  static async getTableMetadataByName(tableName: string) {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    return db.tableMetadata.find((m: any) => m.tableName === tableName) || null;
  }

  static async saveTableMetadata(record: any) {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    // 检查是否已存在（按 tableName 唯一）
    const index = db.tableMetadata.findIndex((m: any) => m.tableName === record.tableName);
    const newRecord = {
      ...record,
      id: record.id || (index !== -1 ? db.tableMetadata[index].id : Date.now()),
      createdAt: index !== -1 ? db.tableMetadata[index].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (index !== -1) {
      db.tableMetadata[index] = newRecord;
    } else {
      db.tableMetadata.unshift(newRecord);
    }
    await this.save();
    // 刷新缓存
    this.tableMetadataCache.set(record.tableName, newRecord);
    return newRecord;
  }

  static async updateTableMetadata(id: number, updates: any) {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    const index = db.tableMetadata.findIndex((m: any) => m.id === id);
    if (index === -1) throw new Error('记录不存在');
    const oldTableName = db.tableMetadata[index].tableName;
    db.tableMetadata[index] = { ...db.tableMetadata[index], ...updates, updatedAt: new Date().toISOString() };
    await this.save();
    // 刷新缓存
    this.tableMetadataCache.delete(oldTableName);
    this.tableMetadataCache.set(db.tableMetadata[index].tableName, db.tableMetadata[index]);
    return db.tableMetadata[index];
  }

  static async deleteTableMetadata(id: number) {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    const record = db.tableMetadata.find((m: any) => m.id === id);
    if (record) this.tableMetadataCache.delete(record.tableName);
    db.tableMetadata = db.tableMetadata.filter((m: any) => m.id !== id);
    await this.save();
    return db.tableMetadata;
  }

  static async refreshTableMetadataCache() {
    const db = await this.load();
    if (!db.tableMetadata) db.tableMetadata = [];
    this.tableMetadataCache.clear();
    for (const m of db.tableMetadata) {
      this.tableMetadataCache.set(m.tableName, m);
    }
    return this.tableMetadataCache.size;
  }

  // 获取表元数据的分页结果
  static async getTableMetadataPage(pageNum: number, pageSize: number, keyword?: string) {
    let list = await this.getTableMetadataList(keyword);
    const total = list.length;
    const start = (pageNum - 1) * pageSize;
    const records = list.slice(start, start + pageSize);
    return { data: { records, total, pageNum, pageSize } };
  }

  // ============================================================
  // 心跳 (Heartbeat) 管理
  // ============================================================

  static async getProjectHeartbeats(projectId: string) {
    const db = await this.load();
    if (!db.heartbeats) db.heartbeats = [];
    return db.heartbeats.filter((h: any) => h.projectId === projectId);
  }

  static async getHeartbeat(id: string) {
    const db = await this.load();
    if (!db.heartbeats) return null;
    return db.heartbeats.find((h: any) => h.id === id);
  }

  static async createHeartbeat(config: any) {
    const db = await this.load();
    if (!db.heartbeats) db.heartbeats = [];
    const newHeartbeat = {
      id: `hb_${Date.now()}`,
      projectId: config.projectId,
      name: config.name || '心跳任务',
      description: config.description || '',
      cronExpression: config.cronExpression || '',
      intervalMinutes: config.intervalMinutes || 30,
      prompt: config.prompt || '请检查项目状态，确认是否有需要处理的事项。',
      enabled: config.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.heartbeats.push(newHeartbeat);
    await this.save();
    return newHeartbeat;
  }

  static async updateHeartbeat(id: string, updates: any) {
    const db = await this.load();
    if (!db.heartbeats) db.heartbeats = [];
    const index = db.heartbeats.findIndex((h: any) => h.id === id);
    if (index !== -1) {
      db.heartbeats[index] = {
        ...db.heartbeats[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      await this.save();
      return db.heartbeats[index];
    }
    return null;
  }

  static async deleteHeartbeat(id: string) {
    const db = await this.load();
    if (!db.heartbeats) db.heartbeats = [];
    db.heartbeats = db.heartbeats.filter((h: any) => h.id !== id);
    await this.save();
    return db.heartbeats;
  }

  static async getHeartbeatHistory(projectId: string, limit = 20) {
    const db = await this.load();
    if (!db.heartbeatHistory) db.heartbeatHistory = [];
    return db.heartbeatHistory
      .filter((h: any) => h.projectId === projectId)
      .slice(0, limit);
  }

  static async addHeartbeatHistory(entry: any) {
    const db = await this.load();
    if (!db.heartbeatHistory) db.heartbeatHistory = [];
    db.heartbeatHistory.unshift({
      id: `hbh_${Date.now()}`,
      projectId: entry.projectId,
      heartbeatId: entry.heartbeatId,
      heartbeatName: entry.heartbeatName || '',
      status: entry.status || 'completed',
      triggeredAt: entry.triggeredAt || new Date().toISOString(),
      completedAt: entry.completedAt || new Date().toISOString(),
      response: entry.response || '',
      error: entry.error || null
    });
    // 只保留最近 200 条
    if (db.heartbeatHistory.length > 200) {
      db.heartbeatHistory = db.heartbeatHistory.slice(0, 200);
    }
    await this.save();
  }
}