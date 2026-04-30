/**
 * 项目会话服务 - 从项目目录读取会话
 */

import * as fs from 'fs';
import * as path from 'path';

export class ProjectChatService {
  
  // 根据项目工作区获取会话列表（调用方已处理路径转换）
  static async getChatsFromProject(projectWorkspace: string): Promise<any[]> {
    const chatsDir = path.join(projectWorkspace, 'data', 'chats');
    
    if (!fs.existsSync(chatsDir)) {
      return [];
    }
    
    const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
    return files.map(file => {
      const content = fs.readFileSync(path.join(chatsDir, file), 'utf-8');
      return JSON.parse(content);
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  // 获取单个会话（调用方已处理路径转换）
  static async getChatFromProject(projectWorkspace: string, chatId: string): Promise<any | null> {
    const chatFile = path.join(projectWorkspace, 'data', 'chats', `${chatId}.json`);
    
    if (!fs.existsSync(chatFile)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(chatFile, 'utf-8'));
  }

  // 保存会话到项目目录（调用方已处理路径转换）
  static async saveChatToProject(projectWorkspace: string, chat: any): Promise<void> {
    const chatsDir = path.join(projectWorkspace, 'data', 'chats');
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

    // 去重：带 tool_call_id 的消息不重复保存（避免 resend 多次导致孤儿累积）
    if (message.role === 'tool' && message.tool_call_id) {
      const exists = chat.messages.some((m: any) => m.tool_call_id === message.tool_call_id);
      if (exists) {
        console.log(`[ProjectChat] Duplicate tool message skipped: tool_call_id=${message.tool_call_id}`);
        return;
      }
    }

    chat.messages.push({
      ...message,
      id: message.id || Date.now().toString(),  // prefer frontend-provided id
      timestamp: new Date().toISOString()
    });
    
    await this.saveChatToProject(projectWorkspace, chat);
    console.log(`[ProjectChat] Message saved to chat ${chatId}: role=${message.role}, content=${message.content?.slice(0, 50)}...`);
  }

  // 创建新会话
  static async createChat(projectWorkspace: string, projectId: string, title: string, agentId?: string, modelId?: string): Promise<any> {
    const chatId = Date.now().toString();
    const now = new Date().toISOString();
    
    const chat = {
      id: chatId,
      projectId,
      agentId: agentId || undefined,
      modelId: modelId || undefined,
      title: title || '新会话',
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    
    await this.saveChatToProject(projectWorkspace, chat);
    return chat;
  }

  // 删除会话（调用方已处理路径转换）
  static async deleteChat(projectWorkspace: string, chatId: string): Promise<boolean> {
    const chatFile = path.join(projectWorkspace, 'data', 'chats', `${chatId}.json`);
    
    if (fs.existsSync(chatFile)) {
      fs.unlinkSync(chatFile);
      return true;
    }
    return false;
  }
}

export default ProjectChatService;
