import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 50 * 1024;

function normalizeInputPath(inputPath: string) {
  return (inputPath || '.').replace(/\\/g, '/').trim();
}

// 将 Windows 路径转换为 WSL 路径
function convertWindowsToWSLPath(winPath: string): string {
  if (/^[A-Z]:/i.test(winPath)) {
    const drive = winPath.charAt(0).toLowerCase();
    const rest = winPath.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest}`;
  }
  return winPath;
}

// 将路径转换为当前系统可用的绝对路径
function normalizePath(inputPath: string): string {
  let p = inputPath;
  
  // 如果是 Windows 路径且在 WSL 环境中，转换为 WSL 路径
  const isWindows = os.platform() === 'win32';
  const isWSL = !isWindows && fsSync.existsSync('/mnt/c');
  
  if (!isWindows && isWSL) {
    p = convertWindowsToWSLPath(p);
  }
  
  return p;
}

export class FileToolService {
  static resolveWorkspacePath(workspace: string, inputPath: string) {
    if (!workspace) throw new Error('项目 workspace 未配置');

    // 标准化工作区路径
    const normalizedWorkspace = normalizePath(workspace);
    const workspaceRoot = path.resolve(normalizedWorkspace);
    
    let normalized = normalizeInputPath(inputPath || '.');
    
    // 处理 WSL 风格路径（如 /d/...）转换为 Windows 路径（如 d:\...）
    // 当 workspace 是 Windows 路径但 inputPath 是 WSL 风格时
    if (/^\/[a-z]\//i.test(normalized) && /^[A-Z]:\\/i.test(workspace)) {
      const wslMatch = normalized.match(/^\/([a-z])\/(.+)$/i);
      if (wslMatch) {
        normalized = `${wslMatch[1].toUpperCase()}:\\${wslMatch[2].replace(/\//g, '\\')}`;
      }
    }
    
    const candidate = path.isAbsolute(normalized)
      ? path.resolve(normalizePath(normalized))
      : path.resolve(workspaceRoot, normalized);

    const relative = path.relative(workspaceRoot, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('禁止访问项目工作区之外的路径');
    }

    return { workspaceRoot, absolutePath: candidate, relativePath: relative || '.' };
  }

  static async listFiles(workspace: string, inputPath = '.', maxDepth = 3) {
    const { absolutePath, workspaceRoot } = this.resolveWorkspacePath(workspace, inputPath);
    const stat = await fs.stat(absolutePath).catch(() => null as any);
    if (!stat) throw new Error('路径不存在');
    if (!stat.isDirectory()) throw new Error('目标不是目录');

    // 过滤掉 Agent 相关目录和文件
    const EXCLUDED_PATTERNS = [
      'agents',
      'agent',
      '_agent',
      '_agents'
    ];

    const shouldExclude = (name: string, relPath: string) => {
      const lowerName = name.toLowerCase();
      const lowerRel = relPath.toLowerCase();
      return EXCLUDED_PATTERNS.some(p => 
        lowerName === p || 
        lowerRel === p ||
        lowerRel.startsWith(p + '/') ||
        lowerRel.startsWith(p + '\\')
      );
    };

    const results: any[] = [];

    async function walk(currentPath: string, depth: number) {
      if (depth > maxDepth) return;
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const st = await fs.stat(fullPath);
        const rel = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
        
        // 跳过 Agent 相关目录
        if (shouldExclude(entry.name, rel)) continue;
        
        results.push({
          path: rel,
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
          size: st.size,
          updatedAt: st.mtime.toISOString()
        });
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
      }
    }

    await walk(absolutePath, 0);
    return {
      path: path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/') || '.',
      maxDepth,
      entries: results
    };
  }

  static async readFile(workspace: string, inputPath: string, offset = 1, limit = 200) {
    console.log(`[FileToolService.readFile] workspace=${workspace}, inputPath=${inputPath}`);
    const { absolutePath, relativePath } = this.resolveWorkspacePath(workspace, inputPath);
    console.log(`[FileToolService.readFile] absolutePath=${absolutePath}, relativePath=${relativePath}`);
    
    // 禁止读取 Agent 相关目录
    const normalizedRel = relativePath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRel.startsWith('agents/') || 
        normalizedRel === 'agents' ||
        normalizedRel.startsWith('agent/') ||
        normalizedRel === 'agent') {
      throw new Error('禁止读取 agents/ 目录。这些文件由系统管理，不应手动修改。');
    }
    
    const stat = await fs.stat(absolutePath).catch(() => null as any);
    if (!stat) throw new Error('文件不存在');
    if (!stat.isFile()) throw new Error('目标不是文件');

    const content = await fs.readFile(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const safeOffset = Math.max(1, Number(offset) || 1);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, MAX_READ_LINES));
    const start = safeOffset - 1;
    const sliced = lines.slice(start, start + safeLimit);

    let output = sliced.join('\n');
    let truncated = start + safeLimit < lines.length;
    if (Buffer.byteLength(output, 'utf-8') > MAX_READ_BYTES) {
      output = Buffer.from(output, 'utf-8').subarray(0, MAX_READ_BYTES).toString('utf-8');
      truncated = true;
    }

    return {
      path: relativePath.replace(/\\/g, '/'),
      offset: safeOffset,
      limit: safeLimit,
      totalLines: lines.length,
      truncated,
      content: output
    };
  }

  static async writeFile(workspace: string, inputPath: string, content: string) {
    const { absolutePath, relativePath } = this.resolveWorkspacePath(workspace, inputPath);
    
    // 禁止写入 Agent 相关目录
    const normalizedRel = relativePath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRel.startsWith('agents/') || 
        normalizedRel === 'agents' ||
        normalizedRel.startsWith('agent/') ||
        normalizedRel === 'agent') {
      throw new Error('禁止写入 agents/ 目录。请使用系统管理界面配置 Agent。');
    }
    
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content ?? '', 'utf-8');
    const stat = await fs.stat(absolutePath);
    return {
      path: relativePath.replace(/\\/g, '/'),
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  }

  static async editFile(workspace: string, inputPath: string, oldText: string, newText: string) {
    const { absolutePath, relativePath } = this.resolveWorkspacePath(workspace, inputPath);
    
    // 禁止编辑 Agent 相关目录
    const normalizedRel = relativePath.replace(/\\/g, '/').toLowerCase();
    if (normalizedRel.startsWith('agents/') || 
        normalizedRel === 'agents' ||
        normalizedRel.startsWith('agent/') ||
        normalizedRel === 'agent') {
      throw new Error('禁止编辑 agents/ 目录的文件。请使用系统管理界面配置 Agent。');
    }
    
    const current = await fs.readFile(absolutePath, 'utf-8');
    if (!current.includes(oldText)) {
      throw new Error('未找到要替换的精确文本');
    }
    const updated = current.replace(oldText, newText);
    await fs.writeFile(absolutePath, updated, 'utf-8');
    const stat = await fs.stat(absolutePath);
    return {
      path: relativePath.replace(/\\/g, '/'),
      replaced: true,
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  }
}
