/**
 * 系统引导服务 - 启动时自动写入当前系统的正确命令集
 * 供 AI 上下文使用
 */

import { platform } from 'os';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface CommandSet {
  platform: string;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  timestamp: string;
  
  // 文件操作
  readFile: string;
  readFileLines: string;  // 读取指定行数
  listDir: string;
  createFile: string;
  deleteFile: string;
  copyFile: string;
  moveFile: string;
  createDir: string;
  deleteDir: string;
  
  // 文本搜索
  searchInFile: string;
  findFiles: string;
  
  // Git
  gitStatus: string;
  gitLog: string;
  gitDiff: string;
  
  // 示例
  examples: {
    readFirst100Lines: string;
    listCurrentDir: string;
    searchText: string;
  };
}

function getWindowsCommands(): CommandSet {
  return {
    platform: 'win32',
    isWindows: true,
    isLinux: false,
    isMac: false,
    timestamp: new Date().toISOString(),
    
    readFile: 'type "文件路径"',
    readFileLines: 'powershell -Command "Get-Content -Path \\"文件路径\\" | Select-Object -First N"',
    listDir: 'dir',
    createFile: 'echo. > "文件路径"',
    deleteFile: 'del "文件路径"',
    copyFile: 'copy "源" "目标"',
    moveFile: 'move "源" "目标"',
    createDir: 'mkdir "目录路径"',
    deleteDir: 'rmdir /s /q "目录路径"',
    
    searchInFile: 'findstr /s /n "搜索内容" *.txt',
    findFiles: 'dir /s /b *关键词*',
    
    gitStatus: 'git status',
    gitLog: 'git log --oneline -10',
    gitDiff: 'git diff',
    
    examples: {
      readFirst100Lines: 'powershell -Command "Get-Content -Path \\"src/App.tsx\\" | Select-Object -First 100"',
      listCurrentDir: 'dir',
      searchText: 'findstr /s /n \\"search_term\\" *.ts'
    }
  };
}

function getLinuxCommands(): CommandSet {
  return {
    platform: 'linux',
    isWindows: false,
    isLinux: true,
    isMac: false,
    timestamp: new Date().toISOString(),
    
    readFile: 'cat "文件路径"',
    readFileLines: 'head -n N "文件路径"',
    listDir: 'ls -la',
    createFile: 'touch "文件路径"',
    deleteFile: 'rm "文件路径"',
    copyFile: 'cp "源" "目标"',
    moveFile: 'mv "源" "目标"',
    createDir: 'mkdir -p "目录路径"',
    deleteDir: 'rm -rf "目录路径"',
    
    searchInFile: 'grep -rn "搜索内容" .',
    findFiles: 'find . -name "*关键词*"',
    
    gitStatus: 'git status',
    gitLog: 'git log --oneline -10',
    gitDiff: 'git diff',
    
    examples: {
      readFirst100Lines: 'head -n 100 src/App.tsx',
      listCurrentDir: 'ls -la',
      searchText: 'grep -rn "search_term" *.ts'
    }
  };
}

function getMacCommands(): CommandSet {
  return {
    platform: 'darwin',
    isWindows: false,
    isLinux: false,
    isMac: true,
    timestamp: new Date().toISOString(),
    
    readFile: 'cat "文件路径"',
    readFileLines: 'head -n N "文件路径"',
    listDir: 'ls -la',
    createFile: 'touch "文件路径"',
    deleteFile: 'rm "文件路径"',
    copyFile: 'cp "源" "目标"',
    moveFile: 'mv "源" "目标"',
    createDir: 'mkdir -p "目录路径"',
    deleteDir: 'rm -rf "目录路径"',
    
    searchInFile: 'grep -rn "搜索内容" .',
    findFiles: 'find . -name "*关键词*"',
    
    gitStatus: 'git status',
    gitLog: 'git log --oneline -10',
    gitDiff: 'git diff',
    
    examples: {
      readFirst100Lines: 'head -n 100 src/App.tsx',
      listCurrentDir: 'ls -la',
      searchText: 'grep -rn "search_term" *.ts'
    }
  };
}

export function getCommandSet(): CommandSet {
  const p = platform();
  switch (p) {
    case 'win32':
      return getWindowsCommands();
    case 'darwin':
      return getMacCommands();
    case 'linux':
    default:
      return getLinuxCommands();
  }
}

export function bootstrapSystemCommands(): CommandSet {
  const commands = getCommandSet();
  
  // 写入到项目的数据目录
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  const outputPath = join(dataDir, 'system-commands.json');
  writeFileSync(outputPath, JSON.stringify(commands, null, 2));
  
  // AI 通过 API 获取命令，所以这里只写 JSON 文件
  console.log(`✅ System commands written to AI workspace: D:\\workspace\\my-openclaw\\backend\\data\\system-commands.json`);
  console.log(`   AI can fetch via: GET http://localhost:3001/api/tools/commands`);
  
  console.log(`✅ System commands written to: ${outputPath}`);
  console.log(`   Platform: ${commands.platform}`);
  console.log(`   Commands available for AI context`);
  
  return commands;
}

export default { getCommandSet, bootstrapSystemCommands };
