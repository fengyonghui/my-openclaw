import fs from 'node:fs/promises';
import path from 'node:path';

const DB_PATH = path.resolve(process.cwd(), 'data/db.json');

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

  static async load() {
    try {
      const content = await fs.readFile(DB_PATH, 'utf-8');
      this.data = JSON.parse(content);
      return this.data;
    } catch (err) {
      const initial = {
        projects: [],
        agents: [{ id: "1", name: "PM Agent", description: "项目经理 Agent", type: "pm", role: "Manager", status: "idle" }],
        chats: [],
        availableModels: [],
        availableSkills: [], // 新增全局技能池
        memories: []
      };
      await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
      await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      this.data = initial;
      return initial;
    }
  }

  static async save() {
    if (!this.data) return;
    await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // --- 项目记忆管理 ---
  static async getProjectMemories(projectId: string) {
    const db = await this.load();
    if (!db.memories) db.memories = [];
    return db.memories.filter((m: any) => m.projectId === projectId);
  }

  static async addProjectMemory(projectId: string, memory: any) {
    const db = await this.load();
    const newMemory = { ...memory, id: Date.now().toString(), projectId, createdAt: new Date().toISOString() };
    if (!db.memories) db.memories = [];
    db.memories.unshift(newMemory);
    await this.save();
    return newMemory;
  }

  // --- 全局模型 CRUD ---
  static async getModels() {
    const db = await this.load();
    return db.availableModels || [];
  }

  static async addGlobalModel(config: ModelConfig) {
    const db = await this.load();
    const newModel = { ...config, id: config.id || Date.now().toString(), temperature: config.temperature ?? 0.7, maxTokens: config.maxTokens ?? 4096 };
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
      await fs.mkdir(workspace, { recursive: true });
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
      createdAt: new Date().toISOString()
    };

    db.projects.push(newProject);
    await this.save();
    return newProject;
  }

  static async importProject(name: string, description: string, workspace: string) {
    const db = await this.load();
    if (!workspace) throw new Error('workspace 不能为空');

    const st = await fs.stat(workspace).catch(() => null as any);
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

  static async addMessageToChat(chatId: string, message: { role: string, content: string }) {
    const db = await this.load();
    const chat = db.chats.find((c: any) => String(c.id) === String(chatId));
    if (chat) {
      if (!chat.messages) chat.messages = [];
      chat.messages.push({ ...message, id: Date.now().toString(), timestamp: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      await this.save();
    }
    return chat;
  }

  // --- Agent 管理 ---
  static async getAgents(projectId?: string) {
    const db = await this.load();
    // 目前 Agent 还是全局配置，未来可以根据 projectId 过滤
    return db.agents || [];
  }

  static async addAgent(agent: any) {
    const db = await this.load();
    const newAgent = { ...agent, id: Date.now().toString(), status: 'idle' };
    db.agents.push(newAgent);
    await this.save();
    return db.agents;
  }

  static async updateAgent(id: string, updates: any) {
    const db = await this.load();
    const index = db.agents.findIndex((a: any) => String(a.id) === String(id));
    if (index !== -1) {
      db.agents[index] = { ...db.agents[index], ...updates };
      await this.save();
    }
    return db.agents;
  }

  static async deleteAgent(id: string) {
    const db = await this.load();
    db.agents = db.agents.filter((a: any) => String(a.id) !== String(id));
    await this.save();
    return db.agents;
  }

  // --- Skill 管理 ---
  static async getGlobalSkills() {
    const db = await this.load();
    return db.availableSkills || [];
  }

  static async addGlobalSkill(skill: any) {
    const db = await this.load();
    const newSkill = { ...skill, id: skill.id || Date.now().toString(), createdAt: new Date().toISOString() };
    if (!db.availableSkills) db.availableSkills = [];
    db.availableSkills.push(newSkill);
    await this.save();
    return db.availableSkills;
  }

  static async getProjectSkills(projectId: string) {
    const project = await this.getProject(projectId);
    const globalSkills = await this.getGlobalSkills();
    // 项目专属 Skill (通过 ID 关联)
    const skillIds = project.enabledSkillIds || [];
    return globalSkills.filter((s: any) => skillIds.includes(s.id));
  }

  static async toggleProjectSkill(projectId: string, skillId: string) {
    const project = await this.getProject(projectId);
    if (!project.enabledSkillIds) project.enabledSkillIds = [];
    const index = project.enabledSkillIds.indexOf(skillId);
    if (index === -1) project.enabledSkillIds.push(skillId);
    else project.enabledSkillIds.splice(index, 1);
    await this.saveProject(project);
    return project.enabledSkillIds;
  }
}
