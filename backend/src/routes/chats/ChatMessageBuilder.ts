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
 const systemContent = `You are an AI assistant working inside project workspace: **${project.workspace}**\n` +
 `Project: ${project.name}\n` +
 `${agentRolePrompt}` +
 `${teamPrompt}` +
 `${memoryPrompt}` +
 `\n\n## TOOL CALLING RULES\n` +
 `- Use tools to perform actions. Do not just describe what you will do.\n` +
 `- If a tool call fails, READ the error message carefully and FIX the arguments\n` +
 `- For write_file: ALWAYS include BOTH path AND content parameters\n` +
 `- For edit_file: include path, oldText (exact text to find), and newText\n` +
 `\n\n## CRITICAL: FILE CONTENT RULES\n` +
`- NEVER write user messages or error descriptions as file content\n` +
`- When asked to implement a feature, write ACTUAL CODE, not descriptions\n` +
`- write_file content must be COMPLETE file content, not a placeholder\n` +
`- Do NOT write phrases like "完整文件内容" as content\n` +
`\n\n## IMPORTANT RULES\n` +
 `- When a task requires specific expertise, delegate it to the appropriate team member\n` +
 `- Always use read_file before editing files\n` +
 `- You can understand and analyze images when provided\n` +
 `- Provide clear, concise, and helpful responses`;

 return { role: 'system', content: systemContent };
}

/**
 * 转换消息格式（支持多模态）
 */
export function transformMessage(m: any): Message {
 const base: Message = { role: m.role, content: m.content || '' };

 // 如果是工具消息，添加 tool_call_id
 if (m.role === 'tool') {
   return { ...base, tool_call_id: normalizeToolCallId(m.tool_call_id) };
 }

 // 如果是助手消息且有 tool_calls，保留并规范化
 if (m.role === 'assistant' && m.tool_calls) {
   return {
     ...base,
     tool_calls: m.tool_calls.map((tc: any) => ({
       ...tc,
       id: normalizeToolCallId(tc.id)
     }))
   };
 }

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
 * 规范化 tool_call ID（确保 call_ 前缀格式）
 */
export function normalizeToolCallId(id: string | undefined): string {
 if (!id || !id.startsWith('call_')) {
   return `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
 }
 return id;
}

/**
 * 规范化消息中的所有 tool_call IDs（用于 assistant 和 tool 消息）
 */
export function normalizeMessageToolIds(m: any): any {
 if (m.role === 'tool') {
   return { ...m, tool_call_id: normalizeToolCallId(m.tool_call_id) };
 }
 if (m.role === 'assistant' && m.tool_calls) {
   return {
     ...m,
     tool_calls: m.tool_calls.map((tc: any) => ({
       ...tc,
       id: normalizeToolCallId(tc.id)
     }))
   };
 }
 return m;
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
 ...historyMessages.slice(0, initialIntentCount).map(m => normalizeMessageToolIds(transformMessage(m))),
 ...historyMessages.slice(-contextWindow).map(m => normalizeMessageToolIds(transformMessage(m)))
 ];
 } else {
 apiMessages = historyMessages.map(m => normalizeMessageToolIds(transformMessage(m)));
 }

 // 收集所有有效的 tool_call_ids（来自 assistant.tool_calls）
 const validToolCallIds = new Set<string>();
 for (const m of apiMessages) {
   if (m.role === 'assistant' && m.tool_calls) {
     for (const tc of m.tool_calls) {
       if (tc.id) validToolCallIds.add(tc.id);
     }
   }
 }

 // 过滤孤立 tool 消息（没有对应 assistant.tool_calls 的 tool 结果）
 // 这些是因为 assistant 消息没有保存到数据库导致的孤儿
 const filteredMessages: Message[] = [];
 for (const m of apiMessages) {
   if (m.role === 'tool') {
     if (validToolCallIds.has(m.tool_call_id || '')) {
       filteredMessages.push(m);
     } else {
       console.log(`[DEBUG] Dropping orphan tool message: tool_call_id=${m.tool_call_id}`);
     }
   } else {
     filteredMessages.push(m);
   }
 }
 apiMessages = filteredMessages;

 // 截断超长工具消息，避免单个巨大消息撑爆上下文
 const MAX_TOOL_CONTENT = 4000;
 apiMessages = apiMessages.map(m => {
   if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_CONTENT) {
     const preview = m.content.slice(0, 1500) + '\n\n... [内容过长，已截断] ...\n\n' + m.content.slice(-1500);
     return { ...m, content: preview };
   }
   return m;
 });

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
 normalizeToolCallId,
 normalizeMessageToolIds,
 buildHistoryMessages,
 cleanMentions
};
