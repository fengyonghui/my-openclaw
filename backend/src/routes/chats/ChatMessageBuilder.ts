/**
 * ChatMessageBuilder - 聊天消息构建器
 * 
 * 构建系统消息和用户消息，处理多模态内容
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadMemoryFile } from './MemoryFileHandler.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ChatContext {
  project: any;
  coordinatorAgent: any;
  allProjectAgents: any[];
  allEnabledSkills: any[];
}

/**
 * 构建系统消息
 */
export function buildSystemMessage(context: ChatContext): Message {
  const { project, coordinatorAgent, allProjectAgents, allEnabledSkills } = context;
  
  // Agent 身份提示
  let agentRolePrompt = '';
  if (coordinatorAgent) {
    agentRolePrompt = `\n## YOUR IDENTITY\nYou are **${coordinatorAgent.name}**${coordinatorAgent.role ? ` (${coordinatorAgent.role})` : ''}. ` +
      `${coordinatorAgent.description || 'A professional AI assistant.'}\n`;
    if (coordinatorAgent.instructions) {
      agentRolePrompt += `\n## YOUR INSTRUCTIONS\n${coordinatorAgent.instructions}\n`;
    }
  }
  
  // 团队成员提示
  const availableDelegates = allProjectAgents
    .filter((a: any) => String(a.id) !== String(coordinatorAgent?.id))
    .map((a: any) => a.name);
  
  let teamPrompt = '';
  if (availableDelegates.length > 0) {
    const delegateDetails = allProjectAgents
      .filter((a: any) => String(a.id) !== String(coordinatorAgent?.id))
      .map((a: any) => `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${a.description || ''}`)
      .join('\n');
    teamPrompt = `\n\n## YOUR TEAM\nYou can delegate tasks to these team members:\n${delegateDetails}`;
  }
  
  // 加载项目 MEMORY.md
  const memoryPrompt = '\n\n## PROJECT MEMORY\n' + loadMemoryFile(project.workspace);
  
  // 构建系统消息内容
  const systemContent = 
    `You are an AI assistant working inside project workspace: **${project.workspace}**\n` +
    `Project: ${project.name}\n` +
    `${agentRolePrompt}` +
    `${teamPrompt}` +
    `${memoryPrompt}` +
    `\n\n## TOOL CALLING RULES\n` +
    `- If a tool call fails, READ the error message carefully and FIX the arguments\n` +
    `- For write_file: ALWAYS include BOTH path AND content parameters\n` +
    `- For edit_file: include path, oldText (exact text to find), and newText\n` +
    `\n\n## IMPORTANT RULES\n` +
    `- When a task requires specific expertise, delegate it to the appropriate team member\n` +
    `- Always use read_file before editing files\n` +
    `- You can understand and analyze images when provided\n` +
    `- Provide clear, concise, and helpful responses`;
  
  return {
    role: 'system',
    content: systemContent
  };
}

/**
 * 转换消息格式（支持多模态）
 */
export function transformMessage(m: any): Message {
  const base: Message = {
    role: m.role,
    content: m.content || ''
  };
  
  // 如果有附件（图片等），使用多模态格式
  if (m.attachments && m.attachments.length > 0) {
    const content: any[] = [];
    
    // 添加文本内容
    if (m.content && m.content.trim()) {
      content.push({ type: 'text', text: m.content });
    }
    
    // 添加图片附件
    m.attachments.forEach((att: any) => {
      if (att.type?.startsWith('image/') || att.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
        if (att.dataUrl) {
          content.push({ type: 'image_url', image_url: { url: att.dataUrl } });
        }
      } else {
        // 非图片附件，在文本中提及
        if (m.content) {
          content.push({ type: 'text', text: `${m.content}\n\n[附件: ${att.name}]` });
        } else {
          content.push({ type: 'text', text: `[附件: ${att.name}]` });
        }
      }
    });
    
    return { ...base, content: content.length > 0 ? content : m.content || '' };
  }
  
  return base;
}

/**
 * 构建对话历史消息
 */
export function buildHistoryMessages(
  historyMessages: any[],
  contextWindow: number = 100,
  initialIntentCount: number = 2
): Message[] {
  let apiMessages: Message[] = [];
  
  if (historyMessages.length > contextWindow + initialIntentCount) {
    apiMessages = [
      ...historyMessages.slice(0, initialIntentCount).map(transformMessage),
      ...historyMessages.slice(-contextWindow).map(transformMessage)
    ];
  } else {
    apiMessages = historyMessages.map(transformMessage);
  }
  
  return apiMessages;
}

/**
 * 清理消息中的 @AgentName 提及
 */
export function cleanMentions(content: string): { cleanContent: string; mentions: string[] } {
  const mentions = content?.match(/@([^\s@]+)/g)?.map((m: string) => m.substring(1)) || [];
  const cleanContent = content?.replace(/@([^\s@]+)/g, '$1').trim() || '';
  return { cleanContent, mentions };
}

export default {
  buildSystemMessage,
  transformMessage,
  buildHistoryMessages,
  cleanMentions
};
