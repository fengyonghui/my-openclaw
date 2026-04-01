import { FastifyInstance } from 'fastify';
import { getSystemInfo, getCommands, readFileCommand } from '../services/systemTools.js';
import { getCommandSet } from '../services/systemBootstrap.js';

export async function SystemToolsRoutes(fastify: FastifyInstance) {
  
  // 获取当前系统的完整命令集（推荐使用）
  fastify.get('/commands', async (request, reply) => {
    return getCommandSet();
  });
  
  // 获取系统信息
  fastify.get('/info', async (request, reply) => {
    const sysInfo = getSystemInfo();
    const cmds = getCommands();
    
    return {
      success: true,
      system: sysInfo,
      commands: {
        listDir: cmds.listDir[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        readFile: cmds.readFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        readFileHead: 'head -n 100 "文件路径"  (Linux) 或 powershell -Command "Get-Content -Path \'文件路径\' | Select-Object -First 100" (Windows)',
        readFileTail: 'tail -n 50 "文件路径"  (Linux) 或 powershell -Command "Get-Content -Path \'文件路径\' | Select-Object -Last 50" (Windows)',
        createFile: cmds.createFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        deleteFile: cmds.deleteFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        copyFile: cmds.copyFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        moveFile: cmds.moveFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        createDir: cmds.createDir[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        deleteDir: cmds.deleteDir[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        searchFile: cmds.searchFile[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        currentDir: cmds.currentDir[sysInfo.platform === 'win32' ? 'win' : 'linux'],
        gitStatus: cmds.gitStatus.linux,
        gitLog: cmds.gitLog.linux,
      },
      examples: {
        listDir: sysInfo.isWindows ? 'dir' : 'ls -la',
        readFirst100Lines: readFileCommand('/path/to/file', { lines: 100 }),
        searchText: sysInfo.isWindows ? 'findstr /s /n "搜索内容" *.ts' : 'grep -rn "搜索内容" *.ts',
      },
      important: `当前运行在 ${sysInfo.platform === 'win32' ? 'Windows' : sysInfo.platform === 'darwin' ? 'macOS' : 'Linux'} 系统上，shell: ${sysInfo.shell}`
    };
  });
  
  // 生成读取文件的命令
  fastify.post('/system/read-file-cmd', async (request: any, reply) => {
    const { filePath, lines, from, to } = request.body || {};
    
    if (!filePath) {
      return { success: false, error: '缺少 filePath 参数' };
    }
    
    try {
      const cmd = readFileCommand(filePath, { lines, from, to });
      return { success: true, command: cmd };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}