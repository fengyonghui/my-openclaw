import fs from 'node:fs/promises';
import path from 'node:path';
import { BUILTIN_FILE_IO_SKILL, BUILTIN_INLINE_PYTHON_SKILL, BUILTIN_SHELL_CMD_SKILL } from './BuiltinSkills.js';

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
      ignorePatterns: ['node_modules', '.git', 'dist', '.DS_Store', 'package-lock.json'],
      enabledSkillIds: [], // 项目启用的全局技能ID列表
      projectSkills: [], // 项目私有技能列表
      enabledAgentIds: [], // 项目启用的全局Agent ID列表
      projectAgents: [], // 项目私有Agent列表
      coordinatorAgentId: null, // 主协调Agent ID
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
      ignorePatterns: ['node_modules', '.git', 'dist', '.DS_Store', 'package-lock.json'],
      enabledSkillIds: [],
      projectSkills: [],
      enabledAgentIds: [],
      projectAgents: [],
      coordinatorAgentId: null, // 主协调Agent
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

  static async getAgent(id: string) {
    const db = await this.load();
    return db.agents.find((a: any) => String(a.id) === String(id));
  }

  // 重复定义已注释
  // static async updateAgent(id: string, updates: any) { ... }

  static async deleteAgent(id: string) {
    const db = await this.load();
    db.agents = db.agents.filter((a: any) => String(a.id) !== String(id));
    await this.save();
    return db.agents;
  }

  // --- 项目私有 Agent 管理 ---
  static async getProjectPrivateAgents(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    return project.projectAgents || [];
  }

  static async addProjectPrivateAgent(projectId: string, agent: any) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectAgents) project.projectAgents = [];
    const newAgent = { 
      ...agent, 
      id: agent.id || `private-agent-${Date.now()}`,
      isPrivate: true,
      createdAt: new Date().toISOString() 
    };
    project.projectAgents.push(newAgent);
    await this.saveProject(project);
    return project.projectAgents;
  }

  static async deleteProjectPrivateAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.projectAgents) project.projectAgents = [];
    project.projectAgents = project.projectAgents.filter((a: any) => a.id !== agentId);
    await this.saveProject(project);
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
    }
    return project.projectAgents;
  }

  static async toggleProjectAgent(projectId: string, agentId: string) {
    const project = await this.getProject(projectId);
    if (!project) throw new Error('项目不存在');
    if (!project.enabledAgentIds) project.enabledAgentIds = [];
    const index = project.enabledAgentIds.indexOf(agentId);
    if (index === -1) project.enabledAgentIds.push(agentId);
    else project.enabledAgentIds.splice(index, 1);
    await this.saveProject(project);
    return project.enabledAgentIds;
  }

  // 获取项目可用的所有 Agent（全局启用 + 私有）
  static async getProjectAgents(projectId: string) {
    const project = await this.getProject(projectId);
    if (!project) return [];
    
    const allGlobalAgents = await this.getAgents();
    const enabledAgentIds = project?.enabledAgentIds || [];
    const enabledGlobalAgents = allGlobalAgents.filter((a: any) => enabledAgentIds.includes(a.id));
    
    const privateAgents = project?.projectAgents || [];
    
    return [...enabledGlobalAgents, ...privateAgents];
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
    
    // 获取项目私有技能
    const privateSkills = project?.projectSkills || [];
    
    // 合并返回
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
}
