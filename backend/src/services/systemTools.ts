/**
 * 系统工具服务 - 跨平台兼容
 * 用于获取系统信息，帮助 AI 选择正确的命令
 */

import { platform } from 'os';
import { execSync } from 'child_process';

export interface SystemInfo {
  platform: string;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  shell: string;
  pathSeparator: string;
  lineEnding: string;
  tempDir: string;
}

export function getSystemInfo(): SystemInfo {
  const p = platform();
  const isWin = p === 'win32';
  const isLin = p === 'linux';
  const isMac = p === 'darwin';
  
  return {
    platform: p,
    isWindows: isWin,
    isLinux: isLin,
    isMac: isMac,
    shell: isWin ? 'powershell' : 'bash',
    pathSeparator: isWin ? '\\' : '/',
    lineEnding: isWin ? '\r\n' : '\n',
    tempDir: require('os').tmpdir()
  };
}

export function getCommands() {
  const sys = getSystemInfo();
  
  return {
    // 文件操作
    listDir: {
      win: 'dir',
      linux: 'ls -la',
      desc: '列出目录内容'
    },
    readFile: {
      win: 'type',
      linux: 'cat',
      desc: '读取文件内容'
    },
    readFileHead: {
      win: 'powershell -Command "Get-Content -Path',
      linux: 'head -n',
      desc: '读取文件前N行'
    },
    readFileTail: {
      win: 'powershell -Command "Get-Content -Path',
      linux: 'tail -n',
      desc: '读取文件后N行'
    },
    createFile: {
      win: 'echo. >',
      linux: 'touch',
      desc: '创建空文件'
    },
    deleteFile: {
      win: 'del',
      linux: 'rm',
      desc: '删除文件'
    },
    copyFile: {
      win: 'copy',
      linux: 'cp',
      desc: '复制文件'
    },
    moveFile: {
      win: 'move',
      linux: 'mv',
      desc: '移动/重命名文件'
    },
    createDir: {
      win: 'mkdir',
      linux: 'mkdir -p',
      desc: '创建目录'
    },
    deleteDir: {
      win: 'rmdir /s /q',
      linux: 'rm -rf',
      desc: '删除目录'
    },
    
    // 文本搜索
    searchFile: {
      win: 'findstr /s /n',
      linux: 'grep -rn',
      desc: '在文件中搜索文本'
    },
    searchFileContent: {
      win: 'select-string',
      linux: 'grep',
      desc: '搜索文件内容'
    },
    
    // 系统信息
    currentDir: {
      win: 'cd',
      linux: 'pwd',
      desc: '获取当前目录'
    },
    listProcesses: {
      win: 'tasklist',
      linux: 'ps aux',
      desc: '列出进程'
    },
    killProcess: {
      win: 'taskkill /PID',
      linux: 'kill -9',
      desc: '终止进程'
    },
    
    // Git
    gitStatus: {
      win: 'git status',
      linux: 'git status',
      desc: 'Git 状态'
    },
    gitLog: {
      win: 'git log --oneline -10',
      linux: 'git log --oneline -10',
      desc: 'Git 最近提交'
    },
    gitDiff: {
      win: 'git diff',
      linux: 'git diff',
      desc: 'Git 差异'
    }
  };
}

/**
 * 获取特定命令的平台版本
 */
export function getCommand(cmd: keyof ReturnType<typeof getCommands>): string {
  const sys = getSystemInfo();
  const cmds = getCommands();
  const cmdInfo = cmds[cmd];
  
  if (!cmdInfo) {
    throw new Error(`Unknown command: ${cmd}`);
  }
  
  if (sys.isWindows) {
    return cmdInfo.win;
  }
  return cmdInfo.linux;
}

/**
 * 生成读取文件的命令（支持行范围）
 */
export function readFileCommand(filePath: string, options?: { lines?: number; from?: number; to?: number }): string {
  const sys = getSystemInfo();
  const lines = options?.lines || 100;
  const from = options?.from || 1;
  const to = options?.to || lines;
  
  if (sys.isWindows) {
    if (options?.lines) {
      return `powershell -Command "Get-Content -Path '${filePath}' | Select-Object -First ${lines}"`;
    }
    return `powershell -Command "$lines = Get-Content -Path '${filePath}'; $lines[${from - 1}..${to - 1}]"`;
  }
  
  if (options?.lines) {
    return `head -n ${lines} "${filePath}"`;
  }
  return `sed -n '${from},${to}p' "${filePath}"`;
}

export default {
  getSystemInfo,
  getCommands,
  getCommand,
  readFileCommand
};