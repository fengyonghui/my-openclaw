/**
 * MemoryFileHandler - MEMORY.md 功能辅助函数
 * 
 * 将用户消息中以"请注意"开头的内容写入 MEMORY.md
 * 支持缓存：同一项目重复读取时直接返回缓存内容（按 mtime 失效）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type SaveResult = 'success' | 'duplicate' | 'not_trigger' | 'error';

// 支持的触发词列表
const TRIGGER_KEYWORDS = ['请注意', '请记住', '记住', '记住：', '请牢记'];

// ============================================================
// 缓存层：按 (路径, mtime) 缓存 MEMORY.md 内容，避免重复读磁盘
// ============================================================
interface MemoryCacheEntry {
  content: string;
  mtime: number;  // 文件修改时间
}

const _memoryCache = new Map<string, MemoryCacheEntry>();

/** 将项目工作区路径标准化（去除末尾斜杠） */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

/** 获取 MEMORY.md 文件路径（标准化后） */
function getMemoryFilePath(projectWorkspace: string, isWindows: boolean): string {
  let memoryPath = normalizePath(projectWorkspace);

  if (isWindows) {
    if (/^\/mnt\/[a-z]\//i.test(memoryPath)) {
      const match = memoryPath.match(/^\/mnt\/([a-z])\/(.+)$/i);
      if (match) {
        memoryPath = `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
      }
    }
  } else {
    if (/^[A-Z]:/i.test(memoryPath)) {
      memoryPath = `/mnt/${memoryPath.charAt(0).toLowerCase()}${memoryPath.slice(2).replace(/\\/g, '/')}`;
    }
  }

  return memoryPath + '/MEMORY.md';
}

/**
 * 检查消息是否触发记忆保存
 */
export function isMemoryTrigger(userMessage: string): boolean {
  return TRIGGER_KEYWORDS.some(keyword => userMessage.startsWith(keyword));
}

/**
 * 提取需要记录的内容（去掉触发词前缀）
 */
export function extractMemoryContent(userMessage: string): string {
  const matchedTrigger = TRIGGER_KEYWORDS.find(keyword => userMessage.startsWith(keyword));
  if (!matchedTrigger) return '';
  
  let noteContent = userMessage.replace(new RegExp(`^${matchedTrigger}[：:]\\s*`), '').trim();
  if (!noteContent) {
    noteContent = userMessage.replace(new RegExp(`^${matchedTrigger}\\s*`), '').trim();
  }
  return noteContent;
}

/**
 * 将用户消息保存到 MEMORY.md
 * 
 * @param userMessage 用户消息内容
 * @param projectWorkspace 项目工作目录路径
 * @returns 保存结果
 */
export async function saveToMemoryFile(userMessage: string, projectWorkspace: string): Promise<SaveResult> {
  const matchedTrigger = TRIGGER_KEYWORDS.find(keyword => userMessage.startsWith(keyword));
  if (!matchedTrigger) {
    return 'not_trigger';
  }

  // 提取需要记录的内容
  let noteContent = extractMemoryContent(userMessage);
  if (!noteContent) {
    console.log('[Memory] 没有需要记录的内容');
    return 'error';
  }

  const isWindows = os.platform() === 'win32';
  const memoryPath = getMemoryFilePath(projectWorkspace, isWindows);

  try {
    // 读取现有内容或创建新文件
    let existingContent = '';
    if (fs.existsSync(memoryPath)) {
      existingContent = fs.readFileSync(memoryPath, 'utf-8').trim();
    }

    // 去重检查
    const normalizedContent = noteContent.replace(/\s+/g, ' ').trim();
    if (existingContent) {
      const normalizedExisting = existingContent.replace(/\s+/g, ' ').trim();
      if (normalizedExisting.includes(normalizedContent)) {
        console.log('[Memory] 内容已存在，跳过重复写入');
        return 'duplicate';
      }
    }

    // 添加时间戳和新内容
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const newEntry = `\n## 📝 ${timestamp}\n- ${noteContent}\n`;

    // 如果文件为空或没有内容，直接写入
    if (!existingContent) {
      fs.writeFileSync(memoryPath, `# MEMORY.md - 项目记忆\n${newEntry}`, 'utf-8');
    } else {
      fs.writeFileSync(memoryPath, existingContent + newEntry, 'utf-8');
    }

    // 缓存失效：下次 load 时会重新读取
    _memoryCache.delete(memoryPath);

    console.log(`[Memory] 已写入 MEMORY.md: ${noteContent.slice(0, 30)}...`);
    return 'success';
  } catch (e: any) {
    console.log(`[Memory] 写入失败: ${e.message}`);
    return 'error';
  }
}

/**
 * 加载项目的 MEMORY.md 内容（带缓存 + mtime 失效）
 */
export function loadMemoryFile(projectWorkspace: string): string {
  const isWindows = os.platform() === 'win32';
  const memoryPath = getMemoryFilePath(projectWorkspace, isWindows);

  try {
    if (fs.existsSync(memoryPath)) {
      const stat = fs.statSync(memoryPath);
      const currentMtime = stat.mtimeMs;

      // 命中缓存：mtime 未变
      const cached = _memoryCache.get(memoryPath);
      if (cached && cached.mtime === currentMtime) {
        return cached.content;
      }

      // 缓存失效或未命中，重新读取
      const content = fs.readFileSync(memoryPath, 'utf-8');
      _memoryCache.set(memoryPath, { content, mtime: currentMtime });
      return content;
    } else {
      // 文件不存在，创建初始文件
      const initialContent = `# MEMORY.md - 项目记忆

> 此文件用于记录项目重要信息，由 AI 自动管理
> 用户可通过输入 "请注意xxx" 或 "请记住xxx" 来添加记录
`;
      fs.writeFileSync(memoryPath, initialContent, 'utf-8');
      _memoryCache.set(memoryPath, { content: initialContent, mtime: Date.now() });
      console.log(`[Memory] Created new MEMORY.md: ${memoryPath}`);
      return initialContent;
    }
  } catch (e: any) {
    console.log(`[Memory] Could not load MEMORY.md: ${e.message}`);
    return '';
  }
}

/** 主动失效 MEMORY.md 缓存（外部调用，如项目删除时） */
export function invalidateMemoryCache(projectWorkspace?: string): void {
  if (!projectWorkspace) {
    _memoryCache.clear();
    return;
  }
  const isWindows = os.platform() === 'win32';
  const memoryPath = getMemoryFilePath(projectWorkspace, isWindows);
  _memoryCache.delete(memoryPath);
}
