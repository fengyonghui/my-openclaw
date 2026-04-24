/**
 * 项目会话服务 - 从项目目录读取会话
 */

import * as fs from 'fs';
import * as path from 'path';
import { toWSLPath } from './PathService.js';

export class ProjectChatService {
  
  // 根据项目工作区获取会话列表
  static async getChatsFromProject(projectWorkspace: string): Promise<any[]> {
    const chatsDir = path.join(toWSLPath(projectWorkspace), 'data', 'chats');
    if (!fs.existsSync(chatsDir)) {
      return [];
    }
    
    const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
    return files.map(file => {
      const content = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
      return JSON.parse(content);
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  // 获取单个会话
  static async getChatFromProject(projectWorkspace: string, chatId: string): Promise<any | null> {
    const chatFile = path.join(toWSLPath(projectWorkspace), 'data', 'chats', `${chatId}.json`);
    if (!fs.existsSync(chatFile)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
  }

  // 保存会话到项目目录
  static async saveChatToProject(projectWorkspace: string, chat: any): Promise<void> {
    const chatsDir = path.join(toWSLPath(projectWorkspace), 'data', 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });
    
    chat.updatedAt = new Date().toISOString();
    const chatFile = path.join(chatsDir, `${chat.id}.json`);
    fs.writeFileSync(chatFile, JSON.stringify(chat, null, 2), 'utf-8');
  }

  // 添加消息到会话
  static async addMessageToChat(projectWorkspace: string, chatId: string, message: any): Promise<void> {
    const chat = await this.getChatFromProject(projectWorkspace, chatId);
    if (!chat) {
      console.error(`[ProjectChat] Chat not found: ${chatId}`);
      return;
    }
    
    if (!chat.messages) chat.messages = [];
    chat.messages.push({
      ...message,
      id: Date.now().toString(),
      timestamp: new Date().toISOString()
    });
    
    await this.saveChatToProject(projectWorkspace, chat);
    console.log(`[ProjectChat] Message saved to chat ${chatId}: role=${message.role}, content=${message.content?.slice(0, 50)}...`);
  }

  // 创建新会话
  static async createChat(projectWorkspace: string, projectId: string, title: string): Promise<any> {
    const chatId = Date.now().toString();
    const now = new Date().toISOString();
    
    const chat = {
      id: chatId,
      projectId,
      title: title || '新会话',
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    
    await this.saveChatToProject(projectWorkspace, chat);
    return chat;
  }

  // 删除会话
  static async deleteChat(projectWorkspace: string, chatId: string): Promise<boolean> {
    const chatFile = path.join(toWSLPath(projectWorkspace), 'data', 'chats', `${chatId}.json`);
    if (fs.existsSync(chatFile)) {
      fs.unlinkSync(chatFile);
      return true;
    }
    return false;
  }
}

export default ProjectChatService;
