import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { FileToolService } from '../services/FileToolService.js';
import fs from 'fs';
import path from 'path';

// 递归搜索文件内容 - 支持 Windows 路径
function searchInDirectory(dirPath: string, keyword: string, results: any[], maxResults: number = 100): boolean {
  if (results.length >= maxResults) return true;
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(dirPath, fullPath);
      
      // 跳过隐藏文件和常见忽略目录
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === '__pycache__' ||
          entry.name === 'dist' ||
          entry.name === 'build') {
        continue;
      }
      
      if (entry.isDirectory()) {
        searchInDirectory(fullPath, keyword, results, maxResults);
      } else if (entry.isFile()) {
        // 只搜索文本文件
        const ext = path.extname(entry.name).toLowerCase();
        const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.py', '.html', '.css', '.scss', '.yaml', '.yml', '.xml', '.sh', '.bash', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.sql', '.graphql', '.env'];
        
        if (textExtensions.includes(ext) || entry.name.match(/\.(env|gitignore|dockerfile|makefile)$/i)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lowerContent = content.toLowerCase();
            const lowerKeyword = keyword.toLowerCase();
            
            // 全局搜索，查找所有匹配的行
            const lines = content.split('\n');
            let found = false;
            
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerKeyword)) {
                results.push({
                  path: relativePath.replace(/\\/g, '/'),
                  line: i + 1,
                  content: lines[i].trim(),
                  matches: lines[i].toLowerCase().split(lowerKeyword).length - 1
                });
                found = true;
                // 不再 break，允许一个文件有多个匹配结果
              }
            }
            
            // 如果没找到精确匹配，尝试模糊匹配（包含关键字的任意位置）
            if (!found && lowerContent.includes(lowerKeyword)) {
              // 找到第一个包含关键字的位置附近的行
              const idx = lowerContent.indexOf(lowerKeyword);
              let lineNum = 1;
              let charCount = 0;
              for (let i = 0; i < lines.length; i++) {
                charCount += lines[i].length + 1;
                if (charCount > idx) {
                  lineNum = i + 1;
                  break;
                }
              }
              results.push({
                path: relativePath.replace(/\\/g, '/'),
                line: lineNum,
                content: lines[lineNum - 1]?.trim() || '',
                matches: 1
              });
            }
          } catch (e) {
            // 跳过无法读取的文件
          }
        }
      }
    }
  } catch (e) {
    // 跳过无法访问的目录
  }
  
  return results.length >= maxResults;
}

export async function FileRoutes(fastify: FastifyInstance) {
  // 文本搜索 API
  fastify.get('/projects/:id/files/search', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { keyword, path: searchSubPath = '' } = request.query as { keyword?: string; path?: string };
    
    if (!keyword) {
      return reply.status(400).send({ error: 'keyword is required' });
    }
    
    const project = await DbService.getProject(id);
    if (!project?.workspace) {
      return reply.status(404).send({ error: '项目未找到' });
    }
    
    // 直接使用 Windows 路径（后端运行在 Windows 上）
    let searchPath = project.workspace;
    if (searchSubPath) {
      searchPath = path.join(project.workspace, searchSubPath);
    }
    // 统一路径分隔符
    searchPath = searchPath.replace(/\//g, '\\');
    
    console.log(`[Search] searchPath: ${searchPath}, keyword: ${keyword}`);
    
    const results: any[] = [];
    try {
      searchInDirectory(searchPath, keyword, results, 100);
    } catch (err: any) {
      console.error(`[Search] Error: ${err.message}`);
    }
    console.log(`[Search] Found ${results.length} results`);
    
    return {
      keyword,
      path: searchPath,
      count: results.length,
      results: results.slice(0, 100)
    };
  });

  fastify.get('/projects/:id/files/tree', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path = '.', depth = '3' } = request.query as { path?: string; depth?: string };
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    // 直接使用原始路径
    return await FileToolService.listFiles(project.workspace, path, Number(depth) || 3);
  });

  fastify.get('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, offset = '1', limit = '200' } = request.query as { path?: string; offset?: string; limit?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    // 不再转换路径，直接使用原始 Windows 路径，让 FileToolService 处理
    console.log(`[files/content] project.workspace=${project.workspace}, filePath=${path}`);
    try {
      return await FileToolService.readFile(project.workspace, path, Number(offset) || 1, Number(limit) || 200);
    } catch (err: any) {
      console.error(`[files/content] Error: ${err.message}`);
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.put('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, content } = request.body as { path?: string; content?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.writeFile(project.workspace, path, content || '');
  });

  fastify.patch('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, oldText, newText } = request.body as { path?: string; oldText?: string; newText?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      return reply.status(400).send({ error: 'oldText and newText are required' });
    }
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.editFile(project.workspace, path, oldText, newText);
  });
}
