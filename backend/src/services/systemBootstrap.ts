/**
 * 系统引导服务 - 启动时输出当前系统的正确命令集
 * 供 AI 上下文使用
 */

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
 * 检测当前系统信息并输出到控制台
 */
export function bootstrapSystemCommands(): CommandSet {
  // 调一次 getSystemInfo()，getSystemCommands() 内部不会再重复调用
  const sysInfo = getSystemInfo();
  const commands = getSystemCommands();

  // 输出启动信息
  console.log('');
  console.log('═'.repeat(60));
  console.log('🚀 System Commands Bootstrap');
  console.log('═'.repeat(60));
  console.log(`   Platform: ${sysInfo.platformName} (${sysInfo.platform})`);
  console.log(`   Shell: ${sysInfo.shell} (${sysInfo.shellPath})`);
  console.log(`   Login Shell: ${sysInfo.loginShell || 'N/A'}`);
  console.log(`   API: GET http://localhost:3001/api/tools/commands`);
  console.log('═'.repeat(60));
  console.log('');

  return commands as CommandSet;
}

export default {
  getCommandSet,
  bootstrapSystemCommands
};
