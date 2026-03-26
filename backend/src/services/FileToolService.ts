import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 50 * 1024;

function normalizeInputPath(inputPath: string) {
  return (inputPath || '.').replace(/\\/g, '/').trim();
}

export class FileToolService {
  static resolveWorkspacePath(workspace: string, inputPath: string) {
    if (!workspace) throw new Error('项目 workspace 未配置');

    const workspaceRoot = path.resolve(workspace);
    const normalized = normalizeInputPath(inputPath || '.');
    const candidate = path.isAbsolute(normalized)
      ? path.resolve(normalized)
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
    const { absolutePath, relativePath } = this.resolveWorkspacePath(workspace, inputPath);
    
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
