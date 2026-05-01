/**
 * MemoryAutoSaveService - 双层记忆自动保存服务
 * 
 * 方案 D: 会话层 + 项目层双层记忆
 * 
 * 会话层: chat.json 的 sessionMemory 字段（每个对话独有）
 * 项目层: MEMORY.md（项目所有对话共享，自动注入系统提示词）
 */

import { featureFlags } from './FeatureFlags.js';
import { DbService } from './DbService.js';
import { ProjectDataService } from './ProjectDataService.js';
import { ProjectChatService } from './ProjectChatService.js';
import { getProjectWorkspacePath } from './PathService.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface MemoryPoint {
  id: string;
  category: '项目信息' | '技术决策' | '用户偏好' | '待办事项';
  content: string;
  source: string;
  promoted: boolean;   // 是否已升级到项目层
  createdAt: string;
}

export interface ExtractResult {
  summary: string;
  points: Omit<MemoryPoint, 'id' | 'promoted' | 'createdAt'>[];
}

// ==========================================
// LLM 提取
// ==========================================

async function extractMemoryPoints(
  project: { name: string; description?: string; language?: string; workspace: string; id: string },
  recentMessages: Array<{ role: string; content: string }>,
  apiKey: string
): Promise<ExtractResult | null> {
  const messagesText = recentMessages
    .slice(-10)
    .map((m, i) => `[${i + 1}] ${m.role}: ${String(m.content || '').slice(0, 300)}`)
    .join('\n');

  const prompt = `你是一个智能助手，负责从对话中提取关键信息并保存为记忆。

## 项目信息
- 项目名: ${project.name}
- 描述: ${project.description || '无'}
- 技术栈/语言: ${project.language || '未设置'}

## 最近对话（按时间顺序）
${messagesText}

## 任务
请仔细阅读上述对话，提取有价值的信息。规则：
1. 只提取在对话中**明确出现**的信息，不要推测
2. 分类整理为以下四类：
   - **项目信息**：项目目标、目录结构、业务逻辑
   - **技术决策**：架构选择、工具选用、API设计、代码规范
   - **用户偏好**：用户的编码风格偏好、回复格式偏好、常用工具
   - **待办事项**：用户提到但尚未完成的任务
3. 每条记忆必须注明来源（用中文描述是哪条消息的内容）
4. 如果没有值得提取的信息，返回空数组

## 输出格式（严格JSON）
{
  "summary": "一句话描述这次对话的主要收获",
  "points": [
    {
      "category": "项目信息|技术决策|用户偏好|待办事项",
      "content": "具体内容（50字以内）",
      "source": "来源描述"
    }
  ]
}

请直接输出JSON，不要有其他文字：`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('http://localhost:8080/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gemini-3-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[MemoryAutoSave] LLM API error: ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) return null;

    let jsonStr = content;
    if (content.startsWith('```')) {
      const match = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (match) jsonStr = match[1];
    }

    const result = JSON.parse(jsonStr) as ExtractResult;

    if (!result.points || result.points.length === 0) {
      return null;
    }

    return result;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.log('[MemoryAutoSave] LLM call timeout, skipping');
    } else {
      console.warn(`[MemoryAutoSave] LLM call failed: ${err.message}`);
    }
    return null;
  }
}

// ==========================================
// 会话层存储
// ==========================================

/**
 * 保存会话层记忆到 chat.json
 */
async function saveSessionMemory(
  workspacePath: string,
  chatId: string,
  newPoints: Omit<MemoryPoint, 'id' | 'promoted' | 'createdAt'>[]
): Promise<void> {
  try {
    const chat = await ProjectChatService.getChatFromProject(workspacePath, chatId);
    if (!chat) return;

    const now = new Date().toISOString();
    const points: MemoryPoint[] = newPoints.map(p => ({
      ...p,
      id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      promoted: false,
      createdAt: now,
    }));

    const existing = chat.sessionMemory || [];
    // 避免重复（根据 content 字段去重）
    const existingContents = new Set(existing.map((p: MemoryPoint) => p.content));
    const uniquePoints = points.filter(p => !existingContents.has(p.content));

    if (uniquePoints.length === 0) {
      console.log('[MemoryAutoSave] No new unique points to save to session memory');
      return;
    }

    chat.sessionMemory = [...existing, ...uniquePoints];
    await ProjectChatService.saveChatToProject(workspacePath, chat);
    console.log(`[MemoryAutoSave] Saved ${uniquePoints.length} points to session memory (total: ${chat.sessionMemory.length})`);
  } catch (err: any) {
    console.warn(`[MemoryAutoSave] Failed to save session memory: ${err.message}`);
  }
}

// ==========================================
// 项目层存储
// ==========================================

/**
 * 保存项目层记忆到 MEMORY.md
 */
function saveProjectMemory(
  workspacePath: string,
  summary: string,
  points: Omit<MemoryPoint, 'id' | 'promoted' | 'createdAt'>[]
): void {
  try {
    const isWindows = os.platform() === 'win32';
    let memoryPath = workspacePath;

    // 路径转换
    if (isWindows) {
      if (/^\/mnt\/[a-z]\//i.test(memoryPath)) {
        const match = memoryPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
        if (match) memoryPath = `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
      }
    } else {
      if (/^[A-Z]:/i.test(memoryPath)) {
        const match = memoryPath.match(/^([A-Z]):[\\\/](.+)$/i);
        if (match) memoryPath = `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
      }
    }

    // ⚠️ 必须指向文件而非目录
    memoryPath = path.join(memoryPath, 'MEMORY.md');

    let existing = '';
    if (fs.existsSync(memoryPath)) {
      if (fs.statSync(memoryPath).isDirectory()) {
        console.warn(`[MemoryAutoSave] MEMORY.md is a directory, skipping: ${memoryPath}`);
        return;
      }
      existing = fs.readFileSync(memoryPath, 'utf-8');
    }

    const today = new Date().toISOString().split('T')[0];
    const alreadyHasToday = existing.includes(`## ${today}`);

    let newSection = '';
    if (!alreadyHasToday) {
      newSection = existing ? `\n\n## ${today} 自动提取\n` : `## ${today} 自动提取\n`;
    }

    newSection += `**摘要**: ${summary}\n\n`;
    for (const point of points) {
      newSection += `- [${point.category}] ${point.content}（来源: ${point.source}）\n`;
    }

    const updated = existing + newSection;
    fs.writeFileSync(memoryPath, updated, 'utf-8');
    console.log(`[MemoryAutoSave] Saved ${points.length} points to project MEMORY.md`);
  } catch (err: any) {
    console.warn(`[MemoryAutoSave] Failed to save project memory: ${err.message}`);
  }
}

/**
 * 追加单条记忆到 MEMORY.md（用于升级操作）
 */
export function appendPointToProjectMemory(
  workspacePath: string,
  point: MemoryPoint
): void {
  try {
    const isWindows = os.platform() === 'win32';
    let memoryPath = workspacePath;

    if (isWindows) {
      if (/^\/mnt\/[a-z]\//i.test(memoryPath)) {
        const match = memoryPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
        if (match) memoryPath = `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
      }
    } else {
      if (/^[A-Z]:/i.test(memoryPath)) {
        const match = memoryPath.match(/^([A-Z]):[/\\](.+)$/i);
        if (match) memoryPath = `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
      }
    }

    // ⚠️ 必须指向文件而非目录
    memoryPath = path.join(memoryPath, 'MEMORY.md');

    let existing = '';
    if (fs.existsSync(memoryPath)) {
      if (fs.statSync(memoryPath).isDirectory()) {
        console.warn(`[MemoryAutoSave] MEMORY.md is a directory, skipping: ${memoryPath}`);
        return;
      }
      existing = fs.readFileSync(memoryPath, 'utf-8');
    }

    const today = new Date().toISOString().split('T')[0];
    const alreadyHasToday = existing.includes(`## ${today}`);

    let newLine = `- [${point.category}] ${point.content}（来源: ${point.source}）`;
    
    // 避免重复
    if (existing.includes(newLine)) {
      console.log('[MemoryAutoSave] Point already exists in project memory, skipping');
      return;
    }

    let newSection = '';
    if (!alreadyHasToday) {
      newSection = existing ? `\n\n## ${today} 用户升级\n` : `## ${today} 用户升级\n`;
    }

    newSection += newLine + '\n';
    const updated = existing + newSection;
    fs.writeFileSync(memoryPath, updated, 'utf-8');
    console.log(`[MemoryAutoSave] Promoted point to project MEMORY.md`);
  } catch (err: any) {
    console.warn(`[MemoryAutoSave] Failed to promote point: ${err.message}`);
  }
}

// ==========================================
// 缓存
// ==========================================

const recentExtractions = new Map<string, number>();
const CACHE_TTL = 60 * 1000;

function isCacheHit(chatId: string, lastMsgId: string): boolean {
  const cacheKey = `${chatId}:${lastMsgId}`;
  const lastExtract = recentExtractions.get(cacheKey);
  if (lastExtract && Date.now() - lastExtract < CACHE_TTL) return true;
  recentExtractions.set(cacheKey, Date.now());

  // 清理
  if (recentExtractions.size > 50) {
    const cutoff = Date.now() - CACHE_TTL * 5;
    const entries = Array.from(recentExtractions.entries());
    for (const [key, ts] of entries) {
      if (ts < cutoff) recentExtractions.delete(key);
    }
  }
  return false;
}

// ==========================================
// 主入口
// ==========================================

export async function autoSaveMemory(
  project: { name: string; description?: string; language?: string; workspace: string; id: string },
  chatId: string,
  messages: Array<{ id?: string; role: string; content: string }>
): Promise<void> {
  // 1. 检查功能开关
  const flagEnabled = featureFlags.isEnabled('memory_auto_save', { projectId: project.id });
  console.log(`[MemoryAutoSave] Checking flag for project ${project.id}: ${flagEnabled}`);
  if (!flagEnabled) return;

  // 2. 检查缓存
  const lastMsgId = messages[messages.length - 1]?.id || chatId;
  if (isCacheHit(chatId, lastMsgId)) return;

  // 3. 检查消息数量
  if (messages.length < 2) return;

  const meaningfulMessages = messages.filter(
    m => m.role !== 'system' && String(m.content || '').trim().length > 10
  );
  if (meaningfulMessages.length < 2) return;

  // 4. 调用 LLM
  let apiKey = process.env.API_KEY || process.env.OPENAI_API_KEY || '13391822168';
  if (!apiKey || apiKey === 'your-api-key') apiKey = '13391822168';

  const result = await extractMemoryPoints(project, meaningfulMessages.slice(-10), apiKey);
  if (!result || result.points.length === 0) {
    console.log('[MemoryAutoSave] No significant points to extract');
    return;
  }

  console.log(`[MemoryAutoSave] Extracted ${result.points.length} points: ${result.points.map(p => p.category).join(', ')}`);

  // 5. 保存到会话层
  const workspacePath = getProjectWorkspacePath(project.workspace);
  await saveSessionMemory(workspacePath, chatId, result.points);

  // 6. 保存到项目层
  saveProjectMemory(workspacePath, result.summary, result.points);

  // 7. 同步到 db.json（供前端展示）
  syncToDb(project.id, result.points, result.summary).catch(() => {});
}

async function syncToDb(
  projectId: string,
  points: Omit<MemoryPoint, 'id' | 'promoted' | 'createdAt'>[],
  summary: string
): Promise<void> {
  try {
    const memoryEntry = {
      id: Date.now().toString(),
      projectId,
      category: points[0]?.category || 'general',
      content: `[自动提取] ${summary}\n\n${points.map(p => `- ${p.content}`).join('\n')}`,
      source: 'auto_extract',
      createdAt: new Date().toISOString(),
    };
    await DbService.addProjectMemory(projectId, memoryEntry);
  } catch (err: any) {
    console.warn(`[MemoryAutoSave] Failed to sync to db.json: ${err.message}`);
  }
}
