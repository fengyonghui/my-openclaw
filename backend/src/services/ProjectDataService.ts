/**
 * 项目数据服务 - 按项目隔离数据存储
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ProjectChat {
  id: string;
  name: string;
  projectId: string;
  agentId?: string;   // 创建时绑定的 Agent ID
  modelId?: string;  // 使用的模型 ID
  messages: any[];
  createdAt: string;
  updatedAt: string;
}

/**
 * tool 结果内容的存储侧上限（字符数）。
 *
 * 2026-11-11: 之前 tool 结果原样落库，一个 shell_exec 输出就能撑出几 MB。
 * 实测单个会话文件最大 12MB，其中 88% 是 tool 结果正文。
 *
 * 为什么是 8000 而非更小：
 *   发给 LLM 时 ChatMessageBuilder.truncateToolContent 截到 4000 字符，
 *   存储侧留 8000 是为了让「历史回看 / UI 展示」仍能看到比 LLM 更多的上下文，
 *   同时把体积压到原来的 ~1%。两者独立：存储可以更宽，喂给模型的仍按 4000 截。
 */
const TOOL_CONTENT_MAX_CHARS = 8000;

/**
 * 截断 tool 消息的正文，避免超长工具输出把会话文件撑爆。
 *
 * 注意：tool result 的 content 必须是合法 JSON（MiniMax 严格校验
 * "tool_call 必须紧跟 role=tool 的合法 JSON result"），所以这里
 * 不能直接 slice —— 会破坏 JSON 结构导致整条请求被 API 拒绝。
 * 做法是包一层 envelope：保留预览 + 标记截断，输出仍是合法 JSON。
 */
export function truncateStoredToolContent(message: any): any {
  if (!message || message.role !== 'tool') return message;

  const content = message.content;
  if (typeof content !== 'string') return message;
  if (content.length <= TOOL_CONTENT_MAX_CHARS) return message;

  const preview = content.slice(0, TOOL_CONTENT_MAX_CHARS);
  const trimmed = preview.trim();
  const envelope = {
    _truncated: true,
    _originalLength: content.length,
    _preview: preview,
  };

  // 原内容是 JSON → 用合法 JSON envelope 承载（保结构）
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { ...message, content: JSON.stringify(envelope) };
  }
  // 原内容是纯文本 → 文本 + 标记
  return { ...message, content: preview + '\n\n[内容过长，已截断]' };
}

export class ProjectDataService {
  private basePath: string;

  constructor(workspacePath: string) {
    this.basePath = workspacePath;
  }

  // 获取项目数据目录
  private getDataDir(): string {
    const dataDir = path.join(this.basePath, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }

  // 获取会话目录
  private getChatsDir(): string {
    const chatsDir = path.join(this.getDataDir(), 'chats');
    if (!fs.existsSync(chatsDir)) {
      fs.mkdirSync(chatsDir, { recursive: true });
    }
    return chatsDir;
  }

  // 获取内存目录
  private getMemoryDir(): string {
    const memoryDir = path.join(this.getDataDir(), 'memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    return memoryDir;
  }

  // ============ 会话管理 ============

  // 获取所有会话
  getChats(): ProjectChat[] {
    const chatsDir = this.getChatsDir();
    const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));

    return files.map(file => {
      const content = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
      return JSON.parse(content);
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  // 并发版 getChats（性能优化 2026-09-12）：用 Promise.all 并发读取，避免
  // N×单文件读取的串行阻塞。适用于 dashboard 列表等多文件场景。
  async getChatsAsync(): Promise<ProjectChat[]> {
    const chatsDir = this.getChatsDir();
    let files: string[];
    try {
      files = await fs.promises.readdir(chatsDir);
    } catch {
      return [];
    }
    files = files.filter(f => f.endsWith('.json'));
    const chats = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await fs.promises.readFile(path.join(chatsDir, file), 'utf-8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      })
    );
    return chats
      .filter((c): c is ProjectChat => c !== null)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }

  // 获取单个会话
  getChat(chatId: string): ProjectChat | null {
    const filePath = path.join(this.getChatsDir(), `${chatId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  // 创建新会话
  createChat(name: string, projectId: string, agentId?: string, modelId?: string): ProjectChat {
    const chatId = Date.now().toString();
    const now = new Date().toISOString();
    
    const chat: ProjectChat = {
      id: chatId,
      name: name || `会话 ${new Date().toLocaleString('zh-CN')}`,
      projectId,
      agentId: agentId || undefined,
      modelId: modelId || undefined,
      messages: [],
      createdAt: now,
      updatedAt: now
    };

    this.saveChat(chat);
    return chat;
  }

  // 保存会话
  saveChat(chat: ProjectChat): void {
    const filePath = path.join(this.getChatsDir(), `${chat.id}.json`);
    chat.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(chat, null, 2), 'utf-8');
  }

  // 删除会话
  deleteChat(chatId: string): boolean {
    const filePath = path.join(this.getChatsDir(), `${chatId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  // 删除指定消息及其之后的所有消息
  deleteMessagesFrom(chatId: string, fromMessageId: string): void {
    const chat = this.getChat(chatId);
    if (!chat) return;
    const idx = chat.messages.findIndex((m: any) => String(m.id) === String(fromMessageId));
    if (idx === -1) return;
    chat.messages = chat.messages.slice(0, idx);
    this.saveChat(chat);
  }

  // 添加消息到会话
  addMessage(chatId: string, message: any): void {
    const chat = this.getChat(chatId);
    if (!chat) {
      // 关键 (2026-10-30): 之前这里直接静默 return，导致消息无声丢失。
      // 排查"LLM 说没收到我的问题"时，根因就是这一行 —— user 消息写入时
      // chat 文件不存在（服务启动后新建的项目，workspace 缓存未失效导致
      // 创建时跳过文件写入），消息被丢弃且无任何日志。
      // 现在显式告警，日志里能直接看到"哪条消息没写进去"。
      console.warn(
        `[ProjectData] addMessage 失败：会话文件不存在，消息已丢弃 chatId=${chatId}, role=${message?.role}, workspace=${this.basePath}`
      );
      return;
    }

    chat.messages.push({
      ...truncateStoredToolContent({
        ...message,
        id: Date.now().toString(),
        timestamp: new Date().toISOString()
      })
    });
    this.saveChat(chat);
  }

  // ============ 项目内存文件 ============

  // 加载 MEMORY.md
  loadMemory(): string | null {
    const memoryPath = path.join(this.basePath, 'MEMORY.md');
    if (fs.existsSync(memoryPath)) {
      return fs.readFileSync(memoryPath, 'utf-8');
    }
    return null;
  }

  // 保存 MEMORY.md
  saveMemory(content: string): void {
    const memoryPath = path.join(this.basePath, 'MEMORY.md');
    fs.writeFileSync(memoryPath, content, 'utf-8');
  }

  // 加载 REQUIREMENT.md
  loadRequirement(): string | null {
    const reqPath = path.join(this.basePath, 'REQUIREMENT.md');
    if (fs.existsSync(reqPath)) {
      return fs.readFileSync(reqPath, 'utf-8');
    }
    return null;
  }

  // 保存 REQUIREMENT.md
  saveRequirement(content: string): void {
    const reqPath = path.join(this.basePath, 'REQUIREMENT.md');
    fs.writeFileSync(reqPath, content, 'utf-8');
  }

  // ============ 初始化项目数据目录 ============
  
  static initProjectDataDir(workspacePath: string): void {
    const dataDir = path.join(workspacePath, 'data');
    const chatsDir = path.join(dataDir, 'chats');
    const memoryDir = path.join(dataDir, 'memory');
    
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(chatsDir)) fs.mkdirSync(chatsDir, { recursive: true });
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    
    console.log(`[ProjectData] Initialized data directory for: ${workspacePath}`);
  }
}

export default ProjectDataService;
