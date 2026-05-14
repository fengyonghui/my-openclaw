/**
 * 系统命令服务 - 增强版跨平台兼容
 * 
 * 核心功能：
 * 1. 平台检测与 Shell 选择
 * 2. 命令映射与转换
 * 3. PATH 处理
 * 4. 安全检查
 */

import { platform, homedir, tmpdir } from 'os';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================
// 类型定义
// ============================================

export type Platform = 'win32' | 'linux' | 'darwin' | 'wsl';
export type ShellType = 'pwsh' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'sh';

export interface SystemInfo {
  platform: Platform;
  /** 原生平台（WSL 下仍为 'linux'） */
  nativePlatform: 'win32' | 'linux' | 'darwin';
  platformName: string;
  isWindows: boolean;
  isLinux: boolean;
  isWSL: boolean;
  isMac: boolean;
  shell: ShellType;
  shellPath: string;
  pathSeparator: string;
  lineEnding: string;
  homeDir: string;
  tempDir: string;
  loginShell: string;
  wslDistro: string;  // WSL 发行版名称，无则为 ''
}

export interface CommandMapping {
  name: string;
  description: string;
  windows: string;
  linux: string;
  mac: string;
  examples?: {
    windows: string;
    linux: string;
    mac: string;
  };
}

export interface SystemCommands {
  platform: Platform;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  timestamp: string;
  shell: ShellType;
  // 文件操作
  readFile: string;
  readFileLines: string;
  readFileFromTo: string;
  listDir: string;
  listDirRecursive: string;
  createFile: string;
  deleteFile: string;
  copyFile: string;
  moveFile: string;
  createDir: string;
  deleteDir: string;
  // 文本操作
  searchInFile: string;
  searchRecursive: string;
  findFiles: string;
  findFilesByName: string;
  // 进程管理
  listProcesses: string;
  findProcess: string;
  killProcess: string;
  // 网络
  listPorts: string;
  checkPort: string;
  // Git
  gitStatus: string;
  gitLog: string;
  gitDiff: string;
  gitBranch: string;
  // npm/node
  npmInstall: string;
  npmRun: string;
  nodeVersion: string;
  // 示例
  examples: {
    readFirst100Lines: string;
    listCurrentDir: string;
    searchText: string;
    findProcess: string;
    checkPort3000: string;
  };
  // 重要提示
  important: string;
}

// ============================================
// Shell 检测
// ============================================

/**
 * 检测可用的 PowerShell 版本
 * 优先级: PowerShell 7 (pwsh) > PowerShell 5.1 (powershell)
 */
function detectWindowsShell(): { shell: ShellType; path: string } {
  // 检查 PowerShell 7
  const pwshPaths = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
    process.env.ProgramW6432 ? `${process.env.ProgramW6432}\\PowerShell\\7\\pwsh.exe` : '',
  ].filter(Boolean);

  for (const p of pwshPaths) {
    if (p && existsSync(p)) {
      return { shell: 'pwsh', path: p };
    }
  }

  // 检查 PATH 中的 pwsh
  try {
    const pwshPath = execSync('where pwsh 2>nul', { encoding: 'utf-8' }).trim().split('\n')[0];
    if (pwshPath) {
      return { shell: 'pwsh', path: pwshPath };
    }
  } catch {}

  // Fallback to PowerShell 5.1
  return { shell: 'powershell', path: 'powershell.exe' };
}

/**
 * 检测 Unix 系统的 Shell
 * 优先使用 SHELL 环境变量，但处理特殊情况
 */
function detectUnixShell(): { shell: ShellType; path: string; loginShell: string } {
  const shellEnv = process.env.SHELL || '/bin/bash';
  
  // 如果 SHELL 是 fish，优先使用 bash 以避免语法不兼容
  if (shellEnv.includes('fish')) {
    // 尝试找 bash
    const bashPaths = ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash'];
    for (const p of bashPaths) {
      if (existsSync(p)) {
        return { shell: 'bash', path: p, loginShell: shellEnv };
      }
    }
    // 如果没有 bash，尝试 sh
    if (existsSync('/bin/sh')) {
      return { shell: 'sh', path: '/bin/sh', loginShell: shellEnv };
    }
  }
  
  // 使用 SHELL 环境变量
  const shellName = shellEnv.split('/').pop() || 'bash';
  return { 
    shell: shellName as ShellType, 
    path: shellEnv,
    loginShell: shellEnv 
  };
}

// ============================================
// 系统信息获取
// ============================================

/**
 * 检测是否在 WSL 环境中
 */
function detectWSL(): { isWSL: boolean; distro: string } {
  // 优先检查环境变量（WSL2 会设置）
  const distro = process.env.WSL_DISTRO_NAME || '';
  if (distro) return { isWSL: true, distro };

  // 检查 /proc/version（WSL 特征）
  try {
    const version = require('fs').readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (version.includes('microsoft') || version.includes('wsl')) {
      return { isWSL: true, distro: process.env.WSL_DISTRO_NAME || 'WSL' };
    }
  } catch {}

  return { isWSL: false, distro: '' };
}

// 模块级缓存，避免重复检测和重复日志
let _cachedSysInfo: SystemInfo | null = null;

export function getSystemInfo(): SystemInfo {
  if (_cachedSysInfo) return _cachedSysInfo;

  const p = platform() as 'win32' | 'linux' | 'darwin';
  const wslCheck = detectWSL();

  // 调试信息（可按需开启）
  // console.log(`[getSystemInfo] p=${p}, WSL_DISTRO_NAME=${process.env.WSL_DISTRO_NAME || 'N/A'}, wslCheck=${JSON.stringify(wslCheck)}`);

  // 平台判定：WSL 优先
  const isWin = p === 'win32';
  const isMac = p === 'darwin';
  const isLin = p === 'linux';
  const isWSL = !isWin && !isMac && wslCheck.isWSL;
  const detectedPlatform = !isWin && !isMac && wslCheck.isWSL
    ? 'wsl'
    : (isWin ? 'win32' : isMac ? 'darwin' : 'linux');

  let shell: ShellType;
  let shellPath: string;
  let loginShell = '';

  if (isWin) {
    const detected = detectWindowsShell();
    shell = detected.shell;
    shellPath = detected.path;
    loginShell = detected.path;
  } else {
    // Linux / WSL / macOS
    const detected = detectUnixShell();
    shell = detected.shell;
    shellPath = detected.path;
    loginShell = detected.loginShell;
  }

  const platformName = isWin ? 'Windows' : isMac ? 'macOS' : isWSL ? `WSL (${wslCheck.distro || 'Linux'})` : 'Linux';

  _cachedSysInfo = {
    platform: detectedPlatform as Platform,
    nativePlatform: p,
    platformName,
    isWindows: isWin,
    isLinux: isLin && !isWSL,
    isWSL,
    isMac,
    shell,
    shellPath,
    pathSeparator: isWin ? '\\' : '/',
    lineEnding: isWin ? '\r\n' : '\n',
    homeDir: homedir(),
    tempDir: tmpdir(),
    loginShell,
    wslDistro: wslCheck.distro,
  };
  return _cachedSysInfo;
}

// ============================================
// 命令映射
// ============================================

export const COMMAND_MAPPINGS: CommandMapping[] = [
  // === 文件操作 ===
  {
    name: 'readFile',
    description: '读取文件内容',
    windows: 'type "文件路径"',
    linux: 'cat "文件路径"',
    mac: 'cat "文件路径"'
  },
  {
    name: 'readFileLines',
    description: '读取文件前 N 行',
    windows: 'powershell -Command "Get-Content -Path \\"文件路径\\" | Select-Object -First N"',
    linux: 'head -n N "文件路径"',
    mac: 'head -n N "文件路径"'
  },
  {
    name: 'readFileFromTo',
    description: '读取文件指定行范围',
    windows: 'powershell -Command "$lines = Get-Content -Path \\"文件路径\\"; $lines[FROM-1..TO-1]"',
    linux: 'sed -n \'FROM,TOp\' "文件路径"',
    mac: 'sed -n \'FROM,TOp\' "文件路径"'
  },
  {
    name: 'listDir',
    description: '列出目录内容',
    windows: 'dir',
    linux: 'ls -la',
    mac: 'ls -la'
  },
  {
    name: 'listDirRecursive',
    description: '递归列出目录',
    windows: 'dir /s',
    linux: 'find . -type f',
    mac: 'find . -type f'
  },
  {
    name: 'createFile',
    description: '创建空文件',
    windows: 'echo. > "文件路径"',
    linux: 'touch "文件路径"',
    mac: 'touch "文件路径"'
  },
  {
    name: 'deleteFile',
    description: '删除文件',
    windows: 'del "文件路径"',
    linux: 'rm "文件路径"',
    mac: 'rm "文件路径"'
  },
  {
    name: 'copyFile',
    description: '复制文件',
    windows: 'copy "源" "目标"',
    linux: 'cp "源" "目标"',
    mac: 'cp "源" "目标"'
  },
  {
    name: 'moveFile',
    description: '移动/重命名文件',
    windows: 'move "源" "目标"',
    linux: 'mv "源" "目标"',
    mac: 'mv "源" "目标"'
  },
  {
    name: 'createDir',
    description: '创建目录',
    windows: 'mkdir "目录路径"',
    linux: 'mkdir -p "目录路径"',
    mac: 'mkdir -p "目录路径"'
  },
  {
    name: 'deleteDir',
    description: '删除目录',
    windows: 'rmdir /s /q "目录路径"',
    linux: 'rm -rf "目录路径"',
    mac: 'rm -rf "目录路径"'
  },
  // === 文本搜索 ===
  {
    name: 'searchInFile',
    description: '在文件中搜索文本',
    windows: 'findstr /s /n "搜索内容" *.txt',
    linux: 'grep -rn "搜索内容" .',
    mac: 'grep -rn "搜索内容" .'
  },
  {
    name: 'searchRecursive',
    description: '递归搜索文件内容',
    windows: 'findstr /s /n /i "搜索内容" *.*',
    linux: 'grep -rn "搜索内容" . --include="*.ts"',
    mac: 'grep -rn "搜索内容" . --include="*.ts"'
  },
  {
    name: 'findFiles',
    description: '查找文件',
    windows: 'dir /s /b *关键词*',
    linux: 'find . -name "*关键词*"',
    mac: 'find . -name "*关键词*"'
  },
  {
    name: 'findFilesByName',
    description: '按名称查找文件',
    windows: 'where /r . *关键词*',
    linux: 'find . -name "*关键词*"',
    mac: 'find . -name "*关键词*"'
  },
  // === 进程管理 ===
  {
    name: 'listProcesses',
    description: '列出所有进程',
    windows: 'tasklist',
    linux: 'ps aux',
    mac: 'ps aux'
  },
  {
    name: 'findProcess',
    description: '查找特定进程',
    windows: 'tasklist | findstr "进程名"',
    linux: 'ps aux | grep "进程名"',
    mac: 'ps aux | grep "进程名"'
  },
  {
    name: 'killProcess',
    description: '终止进程',
    windows: 'taskkill /PID 进程ID /F',
    linux: 'kill -9 进程ID',
    mac: 'kill -9 进程ID'
  },
  // === 网络 ===
  {
    name: 'listPorts',
    description: '列出端口占用',
    windows: 'netstat -ano | findstr LISTENING',
    linux: 'netstat -tlnp',
    mac: 'lsof -i -P'
  },
  {
    name: 'checkPort',
    description: '检查端口是否被占用',
    windows: 'netstat -ano | findstr :端口',
    linux: 'lsof -i :端口',
    mac: 'lsof -i :端口'
  },
  // === Git ===
  {
    name: 'gitStatus',
    description: 'Git 状态',
    windows: 'git status',
    linux: 'git status',
    mac: 'git status'
  },
  {
    name: 'gitLog',
    description: 'Git 提交历史',
    windows: 'git log --oneline -10',
    linux: 'git log --oneline -10',
    mac: 'git log --oneline -10'
  },
  {
    name: 'gitDiff',
    description: 'Git 差异',
    windows: 'git diff',
    linux: 'git diff',
    mac: 'git diff'
  },
  {
    name: 'gitBranch',
    description: 'Git 分支',
    windows: 'git branch',
    linux: 'git branch',
    mac: 'git branch'
  },
  // === npm/node ===
  {
    name: 'npmInstall',
    description: '安装依赖',
    windows: 'npm install',
    linux: 'npm install',
    mac: 'npm install'
  },
  {
    name: 'npmRun',
    description: '运行 npm 脚本',
    windows: 'npm run 脚本名',
    linux: 'npm run 脚本名',
    mac: 'npm run 脚本名'
  },
  {
    name: 'nodeVersion',
    description: 'Node.js 版本',
    windows: 'node --version',
    linux: 'node --version',
    mac: 'node --version'
  }
];

// ============================================
// 获取命令
// ============================================

/**
 * 根据平台获取特定命令
 */
export function getCommand(name: string): string {
  const mapping = COMMAND_MAPPINGS.find(m => m.name === name);
  if (!mapping) {
    throw new Error(`Unknown command: ${name}`);
  }
  
  const sys = getSystemInfo();
  if (sys.isWindows) return mapping.windows;
  if (sys.isMac) return mapping.mac;
  return mapping.linux;
}

/**
 * 生成完整的系统命令集
 */
export function getSystemCommands(): SystemCommands {
  const sys = getSystemInfo();
  const p = sys.platform;

  const windowsCommands = {
    readFile: 'type "文件路径"',
    readFileLines: 'powershell -Command "Get-Content -Path \\"文件路径\\" | Select-Object -First N"',
    readFileFromTo: 'powershell -Command "$lines = Get-Content -Path \\"文件路径\\"; $lines[FROM-1..TO-1]"',
    listDir: 'dir',
    listDirRecursive: 'dir /s',
    createFile: 'echo. > "文件路径"',
    deleteFile: 'del "文件路径"',
    copyFile: 'copy "源" "目标"',
    moveFile: 'move "源" "目标"',
    createDir: 'mkdir "目录路径"',
    deleteDir: 'rmdir /s /q "目录路径"',
    searchInFile: 'findstr /s /n "搜索内容" *.txt',
    searchRecursive: 'findstr /s /n /i "搜索内容" *.*',
    findFiles: 'dir /s /b *关键词*',
    findFilesByName: 'where /r . *关键词*',
    listProcesses: 'tasklist',
    findProcess: 'tasklist | findstr "进程名"',
    killProcess: 'taskkill /PID 进程ID /F',
    listPorts: 'netstat -ano | findstr LISTENING',
    checkPort: 'netstat -ano | findstr :端口',
    gitStatus: 'git status',
    gitLog: 'git log --oneline -10',
    gitDiff: 'git diff',
    gitBranch: 'git branch',
    npmInstall: 'npm install',
    npmRun: 'npm run 脚本名',
    nodeVersion: 'node --version'
  };

  const unixCommands = {
    readFile: 'cat "文件路径"',
    readFileLines: 'head -n N "文件路径"',
    readFileFromTo: 'sed -n \'FROM,TOp\' "文件路径"',
    listDir: 'ls -la',
    listDirRecursive: 'find . -type f',
    createFile: 'touch "文件路径"',
    deleteFile: 'rm "文件路径"',
    copyFile: 'cp "源" "目标"',
    moveFile: 'mv "源" "目标"',
    createDir: 'mkdir -p "目录路径"',
    deleteDir: 'rm -rf "目录路径"',
    searchInFile: 'grep -rn "搜索内容" .',
    searchRecursive: 'grep -rn "搜索内容" . --include="*.ts"',
    findFiles: 'find . -name "*关键词*"',
    findFilesByName: 'find . -name "*关键词*"',
    listProcesses: 'ps aux',
    findProcess: 'ps aux | grep "进程名"',
    killProcess: 'kill -9 进程ID',
    listPorts: sys.isMac ? 'lsof -i -P' : 'netstat -tlnp',
    checkPort: 'lsof -i :端口',
    gitStatus: 'git status',
    gitLog: 'git log --oneline -10',
    gitDiff: 'git diff',
    gitBranch: 'git branch',
    npmInstall: 'npm install',
    npmRun: 'npm run 脚本名',
    nodeVersion: 'node --version'
  };

  const commands = sys.isWindows ? windowsCommands : unixCommands;

  return {
    platform: p,
    isWindows: sys.isWindows,
    isLinux: sys.isLinux,
    isMac: sys.isMac,
    timestamp: new Date().toISOString(),
    shell: sys.shell,
    ...commands,
    examples: {
      readFirst100Lines: sys.isWindows 
        ? 'powershell -Command "Get-Content -Path \\"src/App.tsx\\" | Select-Object -First 100"'
        : 'head -n 100 src/App.tsx',
      listCurrentDir: sys.isWindows ? 'dir' : 'ls -la',
      searchText: sys.isWindows 
        ? 'findstr /s /n "search_term" *.ts'
        : 'grep -rn "search_term" *.ts',
      findProcess: sys.isWindows 
        ? 'tasklist | findstr "node"'
        : 'ps aux | grep "node"',
      checkPort3000: sys.isWindows 
        ? 'netstat -ano | findstr :3000'
        : 'lsof -i :3000'
    },
    important: `当前运行在 ${sys.platformName} 系统上，Shell: ${sys.shell}。请使用正确的命令语法。`
  };
}

// ============================================
// PATH 处理
// ============================================

/**
 * 获取最小化 PATH
 * (类似于 OpenClaw 的做法，避免 PATH 注入)
 */
export function getMinimalPath(): string[] {
  const sys = getSystemInfo();
  
  if (sys.isWindows) {
    return [
      'C:\\Windows\\System32',
      'C:\\Windows',
      process.env.ProgramFiles || 'C:\\Program Files',
    ].filter(Boolean);
  }
  
  if (sys.isMac) {
    return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  }
  
  // Linux
  return ['/usr/local/bin', '/usr/bin', '/bin'];
}

/**
 * 合并 login-shell PATH
 */
export function getMergedPath(): string[] {
  const minimalPath = getMinimalPath();
  const sys = getSystemInfo();
  
  // 获取当前环境的 PATH
  const envPath = process.env.PATH || '';
  const envPaths = envPath.split(sys.isWindows ? ';' : ':');
  
  // 合并并去重
  const merged = [...new Set([...minimalPath, ...envPaths])];
  
  return merged.filter(Boolean);
}

// ============================================
// 安全检查
// ============================================

/**
 * 检查命令是否安全
 */
export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  // 危险命令黑名单
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,           // rm -rf /
    /rm\s+-rf\s+~/,            // rm -rf ~
    /:\(\)\{\s*:\|:&\s*\};:/,  // Fork bomb
    />\s*\/dev\/sda/,          // 覆盖磁盘
    /mkfs/,                    // 格式化
    /dd\s+if=/,                // dd 命令
    /chmod\s+-R\s+777\s+\//,   // 危险的权限修改
    /curl.*\|\s*bash/,         // 远程脚本执行
    /wget.*\|\s*bash/,         // 远程脚本执行
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { safe: false, reason: `命令包含危险模式: ${pattern}` };
    }
  }

  return { safe: true };
}

/**
 * 检查 PATH 覆盖是否被允许
 */
export function isPathOverrideAllowed(envVar: string): boolean {
  // PATH 覆盖不允许
  if (envVar === 'PATH') return false;
  
  // LD_* 和 DYLD_* 不允许 (防止二进制劫持)
  if (envVar.startsWith('LD_') || envVar.startsWith('DYLD_')) return false;
  
  return true;
}

// ============================================
// 导出
// ============================================

export default {
  getSystemInfo,
  getSystemCommands,
  getCommand,
  getMinimalPath,
  getMergedPath,
  isCommandSafe,
  isPathOverrideAllowed,
  COMMAND_MAPPINGS
};
