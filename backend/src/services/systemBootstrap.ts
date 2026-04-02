/**
 * 系统引导服务 - 启动时自动写入当前系统的正确命令集
 * 供 AI 上下文使用
 * 
 * 增强版：使用 SystemCommands 服务生成更完整的命令集
 */

import { platform } from 'os';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getSystemCommands, getSystemInfo } from './SystemCommands.js';

interface CommandSet {
  platform: string;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  timestamp: string;
  [key: string]: any;
}

/**
 * 获取命令集（兼容旧版）
 */
export function getCommandSet(): CommandSet {
  const commands = getSystemCommands();
  return commands as CommandSet;
}

/**
 * 启动时引导
 * 生成系统命令配置文件
 */
export function bootstrapSystemCommands(): CommandSet {
  // 使用增强版 SystemCommands 服务
  const commands = getSystemCommands();
  const sysInfo = getSystemInfo();

  // 写入到项目的数据目录
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = join(dataDir, 'system-commands.json');
  writeFileSync(outputPath, JSON.stringify(commands, null, 2));

  // 输出启动信息
  console.log('');
  console.log('═'.repeat(60));
  console.log('🚀 System Commands Bootstrap');
  console.log('═'.repeat(60));
  console.log(`   Platform: ${sysInfo.platformName} (${sysInfo.platform})`);
  console.log(`   Shell: ${sysInfo.shell} (${sysInfo.shellPath})`);
  console.log(`   Login Shell: ${sysInfo.loginShell || 'N/A'}`);
  console.log(`   Config: ${outputPath}`);
  console.log(`   API: GET http://localhost:3001/api/tools/commands`);
  console.log('═'.repeat(60));
  console.log('');

  return commands as CommandSet;
}

export default {
  getCommandSet,
  bootstrapSystemCommands
};
