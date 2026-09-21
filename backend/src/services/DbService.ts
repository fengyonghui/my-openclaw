import { readFile, writeFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_FILE_IO_SKILL, BUILTIN_INLINE_PYTHON_SKILL, BUILTIN_SHELL_CMD_SKILL } from './BuiltinSkills.js';

// __dirname 等价：相对源文件定位，不依赖 process.cwd()
// （进程可能从任何目录启动 — 用 cwd 会读到错误文件导致数据丢失）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'db.json');
const GLOBAL_AGENTS_DIR = path.join(BACKEND_ROOT, 'agents');
const CURRENT_VERSION = 3;

// 新建项目默认启用的 3 个 builtin 技能 id
// 与 backend/src/services/BuiltinSkills.ts 中常量保持一致
const DEFAULT_ENABLED_SKILL_IDS = [
  BUILTIN_FILE_IO_SKILL.id,
  BUILTIN_SHELL_CMD_SKILL.id,
  BUILTIN_INLINE_PYTHON_SKILL.id,
];

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
  private static tableMetadataCache: Map<string, any> = new Map();
  private static fileMtime: number = 0; // 文件最后修改时间
  private static lastLoadTime: number = 0;
  private static cacheTTL: number = 5000; // 5 秒缓存

  // 性能优化 (2026-09-12): projectId → workspace 映射独立缓存
  // 避免 readChat 热路径每次都触发 DbService.load() 解析 130MB db.json
  // 该缓存只在 fileMtime 变化时失效
  private static workspaceCache: Map<string, string> = new Map();
  private static workspaceCacheMtime: number = 0;

  /**
   * 轻量级项目工作区查询：仅在缓存失效时解析 db.json，命中缓存返回极快
   * 适用于 ChatStorageHelper.readChat 等只需要 workspace 路径的场景
   */
  static async getProjectWorkspace(projectId: string): Promise<string | null> {
    if (this.workspaceCacheMtime === this.fileMtime && this.workspaceCache.has(projectId)) {
      return this.workspaceCache.get(projectId)!;
    }
    // 缓存失效：触发一次完整 load（更新 fileMtime + workspaceCache）
    await this.load();
    return this.workspaceCache.get(projectId) || null;
  }

  /**
   * 列出所有项目工作区路径（性能优化 2026-09-14）
   * 给 ChatStorageHelper.readChat 在没传 projectId 时扫描 chatId 所属项目用
   */
  static getAllProjectWorkspaces(): string[] {
    if (this.workspaceCacheMtime !== this.fileMtime) {
      // 缓存未建立（启动后第一次调用），懒加载一次
      // 不能用 await 这里（getAllProjectWorkspaces 是同步方法），
      // 所以调用方应先确保 load() 至少被调用过一次（启动时已做）
      // 退化：返回空数组，让 readChat 走 db.json 兜底
      // 注意：启动时 index.ts 已调用 await DbService.load() 预热，这里通常有缓存
      this.load().catch(() => {});
    }
    return Array.from(this.workspaceCache.values());
  }

  /**
   * 重建 projectId → workspace 索引（仅在 db.json 实际变化时调用）
   */
  private static rebuildWorkspaceCache() {
    this.workspaceCache.clear();
    const projects = this.data?.projects || [];
    for (const p of projects) {
      if (p?.id && p?.workspace) {
        this.workspaceCache.set(p.id, p.workspace);
      }
    }
    this.workspaceCacheMtime = this.fileMtime;
  }

  // 串行化加载队列（防止并发 load() 触发 N 次 130MB JSON.parse 导致 OOM）
  // 背景 (2026-09-14): 20 个并发 POST /chats 触发 20 个 DbService.createChat，
  //   每个都 await this.load()，但 load() 没有并发保护，每个都 readFile + parse，
  //   内存峰值 20*130MB = 2.6GB → OOM。
  // 机制：所有 load() 通过 loadQueue 串行执行；first call 真正读文件，
  //   后续调用拿到 first call 的 this.data 共享引用。
  //
  // 关键保护 (2026-09-14): 如果 save 正在进行（writeLoopRunning=true），
  //   不能 readFile — 写入是流式的，期间读到的是截断 JSON，会 parse 失败。
  //   此时直接返回 cached this.data（save 正在序列化同一份 data，是最新的）。
  private static loadQueue: Promise<any> = Promise.resolve();

  static async load() {
    // 关键保护 (2026-09-14): save 正在进行时，禁止读文件
    // 写入是流式的，期间读到的是截断 JSON，会 parse 失败
    while (this.writeLoopRunning) {
      await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
    }

    // 有缓存数据直接返回（this.data 是 save 要写入的同一份对象，是最新的）
    // 不再走 stat + readFile，避免与并发 writeFile 撞车读到截断 JSON
    // 显式 reload() 会先清空 this.data 再 load，强制从文件重新加载
    if (this.data) {
      return this.data;
    }

    // 第一次加载或 reload 后：必须从文件读
    this.loadQueue = this.loadQueue.then(async () => {
      return await this._loadUnchecked();
    }).catch((err: any) => {
      console.error('[DbService] load() 失败:', err.message);
      throw err;
    });

    return this.loadQueue;
  }

  /**
   * 实际执行加载的私有方法（无并发保护，由 load() 串行化调用）
   */
  private static async _loadUnchecked() {
    try {
      // 检查文件是否存在
      if (!existsSync(DB_PATH)) {
        console.error('[DbService] DB file not found');
        const initial = this.createInitialDb();
        await writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
        this.data = initial;
        this.fileMtime = Date.now();
        this.lastLoadTime = Date.now();
        this.rebuildWorkspaceCache();
        return initial;
      }

      // 检查文件是否变化（使用 mtime 而不是哈希，更快）
      const fileStat = await stat(DB_PATH);
      const mtime = fileStat.mtimeMs;

      // 如果文件未变化且在缓存有效期内，返回缓存
      if (this.data && mtime === this.fileMtime && Date.now() - this.lastLoadTime < this.cacheTTL) {
        return this.data;
      }

      // 文件有变化或缓存过期，重新加载
      const content = await readFile(DB_PATH, 'utf-8');
      this.data = JSON.parse(content);
      this.fileMtime = mtime;
      this.lastLoadTime = Date.now();

      // 性能优化 (2026-09-12): 重建项目工作区索引（仅缓存项目列表的轻量子集）
      this.rebuildWorkspaceCache();

      // 版本迁移
      await this.migrateToV3();
      return this.data;
    } catch (err: any) {
      console.error('[DbService] Failed to load DB:', err.message);
      // 返回缓存数据，不要重置
      if (this.data) {
        return this.data;
      }
      const initial = this.createInitialDb();
      this.data = initial;
      this.fileMtime = 0;
      this.lastLoadTime = Date.now();
      return initial;
    }
  }

  // 强制重新加载数据库（用于外部修改文件后）
  static async reload() {
    this.data = null;
    this.fileMtime = 0;
    this.lastLoadTime = 0;
    return await this.load();
  }

  // 简单的字符串哈希
  private static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  private static createInitialDb() {
    return {
      version: CURRENT_VERSION,
      projects: [],
      agents: [],
      chats: [],
      availableModels: [],
      availableSkills: [],
      memories: []
    };
  }

  // 串行化 + 合并保存（防止并发写损坏 db.json）
  // 背景 (2026-09-14):
  //   1. 之前 setImmediate(() => DbService.save()) 多并发
  //      会触发交错 writeFile，导致 db.json 尾部追加新 JSON 对象
  //      (实测 position 124352554 处发现 "Extra data")。
  //   2. 之前纯串行化队列：每个 save 都链一个 cb，每个 cb 都跑一次，
  //      写脏标志在写期间又被新 save 重新置 true，导致 90 saves → 90 writes，
  //      每次写 130MB ~2-3s，吞吐量极低。
  //
  // 当前机制：writeLoop 长跑 while 循环，一次处理所有 pending saves；
  // 新 save() 仅标记 dirty 并加入等待，loop 看到 dirty 会再写一轮。
  // 实际效果：burst 内 N 个 save → 通常 1 次 write（writeDirty 在写入期间被重新置 true 才会再写）。
  private static writeLoopRunning: boolean = false;
  private static writeDirty: boolean = false;
  private static writeWaiters: Array<() => void> = [];

  static async save(): Promise<void> {
    if (!this.data) return;

    // 标记有数据要写
    this.writeDirty = true;

    // 如果已有 write loop 跑着，把当前 caller 加入等待队列
    // 这样 burst 内 90 个 save 都共享同一个 loop 实例
    if (this.writeLoopRunning) {
      await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
      return;
    }

    // 启动 write loop（单实例，处理所有 pending writes）
    this.writeLoopRunning = true;
    try {
      while (this.writeDirty && this.data) {
        this.writeDirty = false; // 抢到本次写盘权（下一轮再检查 dirty）

        await writeFile(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');

        // 同步更新 fileMtime，保证下一次 load() 触发 workspaceCache 重建
        try {
          const fileStat = await stat(DB_PATH);
          this.fileMtime = fileStat.mtimeMs;
        } catch {
          // 忽略 stat 失败，下次 load() 仍会基于 mtime 变化触发重建
        }
      }
    } catch (err: any) {
      console.error('[DbService] save() 失败:', err.message);
      // 写失败，下次 save() 自动重试
      this.writeDirty = true;
    } finally {
      this.writeLoopRunning = false;
      // 通知所有等待的 caller
      const waiters = this.writeWaiters.splice(0);
      for (const w of waiters) w();
    }
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
      const globalAgentsDir = GLOBAL_AGENTS_DIR;
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
      const globalAgentsDir = GLOBAL_AGENTS_DIR;
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
      enabledSkillIds: DEFAULT_ENABLED_SKILL_IDS,
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
      enabledSkillIds: DEFAULT_ENABLED_SKILL_IDS,
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

  // 注意 (2026-09-14): 旧的 createChat(projectId, title, agentId) 生成与 ChatStorageHelper.createChatDual
  //   不同的 id，导致 DELETE 时 filter 找不到刚创建的会话。
  //   现已统一用 upsertChat(chat) 接受完整 chat 对象，确保 id 一致。
  static async createChat(_projectId: string, _title: string, _agentId: string) {
    throw new Error('DbService.createChat 已废弃，请使用 upsertChat(chat) 传入完整 chat 对象');
  }

  static async deleteChat(id: string) {
    const db = await this.load();
    db.chats = db.chats.filter((c: any) => String(c.id) !== String(id));
    await this.save();
    return db.chats;
  }

  // 性能优化 (2026-09-12): 替换或插入会话，用于 ChatStorageHelper 双写 db.json 路径
  // 与 PATCH /:id 行为一致：找到则合并，未找到则 unshift 插入
  static async upsertChat(chat: any) {
    const db = await this.load();
    const idx = db.chats.findIndex((c: any) => String(c.id) === String(chat.id));
    if (idx === -1) {
      db.chats.unshift(chat);
    } else {
      Object.assign(db.chats[idx], chat);
    }
    await this.save();
    return chat;
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
    return GLOBAL_AGENTS_DIR;
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

    const globalAgentsDir = GLOBAL_AGENTS_DIR;
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
    const globalAgentsDir = GLOBAL_AGENTS_DIR;
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
    // 可用性验证
    if (skill.url && skill.url.startsWith('http')) {
      try {
        const response = await fetch(skill.url);
        if (!response.ok) {
          throw new Error(`技能 URL 不可用 (HTTP ${response.status})`);
        }
        const text = await response.text();
        if (!text || text.length < 50) {
          throw new Error('技能内容为空或过短');
        }
        // 简单验证是否存在必需的元数据（YAML frontmatter）
        if (!text.includes('---') || (!text.includes('name:') && !text.includes('description:'))) {
          throw new Error('技能格式错误：缺少必需的元数据 (YAML frontmatter)');
        }
      } catch (err: any) {
        throw new Error(`技能验证失败: ${err.message}`);
      }
    }

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