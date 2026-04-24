/**
 * 项目数据服务 - 按项目隔离数据存储
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ProjectChat {
  id: string;
  name: string;
  projectId: string;
  messages: any[];
  createdAt: string;
  updatedAt: string;
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

  // 获取单个会话
  getChat(chatId: string): ProjectChat | null {
    const filePath = path.join(this.getChatsDir(), `${chatId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  // 创建新会话
  createChat(name: string, projectId: string): ProjectChat {
    const chatId = Date.now().toString();
    const now = new Date().toISOString();
    
    const chat: ProjectChat = {
      id: chatId,
      name: name || `会话 ${new Date().toLocaleString('zh-CN')}`,
      projectId,
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

  // 添加消息到会话
  addMessage(chatId: string, message: any): void {
    const chat = this.getChat(chatId);
    if (!chat) return;

    chat.messages.push({
      ...message,
      id: Date.now().toString(),
      timestamp: new Date().toISOString()
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
