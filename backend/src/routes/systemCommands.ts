/**
 * 系统命令 API 路由 - 增强版
 * 
 * 端点：
 * - GET /api/tools/commands     - 获取完整命令集
 * - GET /api/tools/info         - 获取系统信息
 * - GET /api/tools/commands/:name - 获取特定命令
 * - POST /api/tools/check       - 检查命令安全性
 */

import { FastifyInstance } from 'fastify';
import {
  getSystemInfo,
  getSystemCommands,
  getCommand,
  isCommandSafe,
  getMergedPath,
  COMMAND_MAPPINGS,
  SystemInfo
} from '../services/SystemCommands.js';

export async function SystemCommandsRoutes(fastify: FastifyInstance) {
  // ============================================
  // GET /api/tools/commands - 获取完整命令集
  // ============================================
  fastify.get('/commands', async (request, reply) => {
    const commands = getSystemCommands();
    return commands;
  });

  // ============================================
  // GET /api/tools/info - 获取系统信息
  // ============================================
  fastify.get('/info', async (request, reply) => {
    const sysInfo = getSystemInfo();
    const mergedPath = getMergedPath();
    
    return {
      success: true,
      system: {
        platform: sysInfo.platform,
        platformName: sysInfo.platformName,
        isWindows: sysInfo.isWindows,
        isLinux: sysInfo.isLinux,
        isMac: sysInfo.isMac,
        shell: sysInfo.shell,
        shellPath: sysInfo.shellPath,
        loginShell: sysInfo.loginShell,
        pathSeparator: sysInfo.pathSeparator,
        lineEnding: sysInfo.lineEnding,
        homeDir: sysInfo.homeDir,
        tempDir: sysInfo.tempDir
      },
      path: {
        minimal: sysInfo.isWindows 
          ? ['C:\\Windows\\System32', 'C:\\Windows']
          : sysInfo.isMac 
            ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
            : ['/usr/local/bin', '/usr/bin', '/bin'],
        merged: mergedPath
      },
      recommendations: {
        useTools: '推荐使用 read/write 工具进行文件操作，避免使用 shell 命令',
        shell: sysInfo.isWindows 
          ? 'Windows 上优先使用 PowerShell 7 (pwsh)，fallback 到 PowerShell 5.1'
          : 'Unix 系统使用 $SHELL，如果 SHELL=fish 则优先使用 bash',
        security: '执行前使用 /api/tools/check 验证命令安全性'
      }
    };
  });

  // ============================================
  // GET /api/tools/commands/:name - 获取特定命令
  // ============================================
  fastify.get('/commands/:name', async (request: any, reply) => {
    const { name } = request.params;
    
    // 查找命令映射
    const mapping = COMMAND_MAPPINGS.find(m => m.name === name);
    
    if (!mapping) {
      return reply.code(404).send({
        success: false,
        error: `未找到命令: ${name}`,
        available: COMMAND_MAPPINGS.map(m => m.name)
      });
    }
    
    const sysInfo = getSystemInfo();
    const command = sysInfo.isWindows 
      ? mapping.windows 
      : sysInfo.isMac 
        ? mapping.mac 
        : mapping.linux;
    
    return {
      success: true,
      name: mapping.name,
      description: mapping.description,
      command: command,
      platform: sysInfo.platform,
      alternatives: {
        windows: mapping.windows,
        linux: mapping.linux,
        mac: mapping.mac
      },
      examples: mapping.examples
    };
  });

  // ============================================
  // POST /api/tools/check - 检查命令安全性
  // ============================================
  fastify.post('/check', async (request: any, reply) => {
    const { command } = request.body || {};
    
    if (!command) {
      return reply.code(400).send({
        success: false,
        error: '缺少 command 参数'
      });
    }
    
    const safetyCheck = isCommandSafe(command);
    
    return {
      success: true,
      command: command,
      safe: safetyCheck.safe,
      reason: safetyCheck.reason,
      recommendation: safetyCheck.safe 
        ? '命令看起来是安全的，但仍需谨慎执行'
        : '命令包含危险模式，强烈建议不要执行'
    };
  });

  // ============================================
  // GET /api/tools/mappings - 获取所有命令映射
  // ============================================
  fastify.get('/mappings', async (request, reply) => {
    const sysInfo = getSystemInfo();
    
    return {
      success: true,
      platform: sysInfo.platform,
      shell: sysInfo.shell,
      mappings: COMMAND_MAPPINGS.map(m => ({
        name: m.name,
        description: m.description,
        current: sysInfo.isWindows 
          ? m.windows 
          : sysInfo.isMac 
            ? m.mac 
            : m.linux
      }))
    };
  });

  // ============================================
  // GET /api/tools/quick-ref - 快速参考
  // ============================================
  fastify.get('/quick-ref', async (request, reply) => {
    const sysInfo = getSystemInfo();
    
    // 常用命令快速参考
    const quickRef = {
      platform: sysInfo.platform,
      shell: sysInfo.shell,
      
      fileOperations: {
        list: sysInfo.isWindows ? 'dir' : 'ls -la',
        read: sysInfo.isWindows ? 'type 文件路径' : 'cat 文件路径',
        readFirstN: sysInfo.isWindows 
          ? 'powershell -Command "Get-Content -Path 文件路径 | Select-Object -First N"'
          : 'head -n N 文件路径',
        copy: sysInfo.isWindows ? 'copy 源 目标' : 'cp 源 目标',
        move: sysInfo.isWindows ? 'move 源 目标' : 'mv 源 目标',
        delete: sysInfo.isWindows ? 'del 文件路径' : 'rm 文件路径',
        mkdir: sysInfo.isWindows ? 'mkdir 目录路径' : 'mkdir -p 目录路径',
        rmdir: sysInfo.isWindows ? 'rmdir /s /q 目录路径' : 'rm -rf 目录路径'
      },
      
      search: {
        inFiles: sysInfo.isWindows 
          ? 'findstr /s /n "内容" *.txt'
          : 'grep -rn "内容" .',
        findFiles: sysInfo.isWindows 
          ? 'dir /s /b *关键词*'
          : 'find . -name "*关键词*"'
      },
      
      process: {
        list: sysInfo.isWindows ? 'tasklist' : 'ps aux',
        find: sysInfo.isWindows ? 'tasklist | findstr "名称"' : 'ps aux | grep "名称"',
        kill: sysInfo.isWindows ? 'taskkill /PID ID /F' : 'kill -9 ID'
      },
      
      network: {
        ports: sysInfo.isWindows 
          ? 'netstat -ano | findstr LISTENING'
          : (sysInfo.isMac ? 'lsof -i -P' : 'netstat -tlnp'),
        checkPort: sysInfo.isWindows 
          ? 'netstat -ano | findstr :端口'
          : 'lsof -i :端口'
      },
      
      git: {
        status: 'git status',
        log: 'git log --oneline -10',
        diff: 'git diff',
        branch: 'git branch'
      },
      
      npm: {
        install: 'npm install',
        run: 'npm run 脚本名',
        version: 'node --version'
      }
    };
    
    return quickRef;
  });
}
