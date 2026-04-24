/**
 * 路径服务 - 处理跨平台路径转换
 */
import * as os from 'os';

// 检测是否在 WSL 环境下
export function isWSL(): boolean {
  // 检查是否是 Linux/WSL 平台
  if (os.platform() === 'linux') {
    return true;
  }
  // 检查是否有 /proc/version (WSL 特征)
  try {
    return require('fs').existsSync('/proc/version') && 
           require('fs').readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

// 获取适合当前平台的项目工作区路径
export function getProjectWorkspacePath(workspace: string): string {
  if (!workspace) return '';
  
  // 如果已经是正确的格式
  if (workspace.startsWith('/mnt/') && os.platform() === 'linux') {
    return workspace.replace(/\\/g, '/');
  }
  
  // Windows 驱动器路径 (d:\xxx 或 d:/xxx)
  const match = workspace.match(/^([a-zA-Z]):[/\\](.*)$/);
  if (match) {
    if (os.platform() === 'win32') {
      // Windows: 返回原始路径，规范化反斜杠
      return workspace.replace(/\\/g, '\\\\');
    } else {
      // Linux/WSL: 转换为 /mnt/d/xxx 格式
      const drive = match[1].toLowerCase();
      const rest = match[2].replace(/\\/g, '/');
      return `/mnt/${drive}/${rest}`;
    }
  }
  
  // 其他格式
  return workspace.replace(/\\/g, '/');
}

// Windows 到 WSL 路径转换（用于需要 WSL 路径的场景）
export function toWSLPath(windowsPath: string): string {
  if (!windowsPath) return '';
  
  // 如果已经是 WSL 路径
  if (windowsPath.startsWith('/mnt/')) {
    return windowsPath.replace(/\\/g, '/');
  }
  
  // Windows 驱动器路径
  const match = windowsPath.match(/^([a-zA-Z]):[/\\](.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  
  return windowsPath.replace(/\\/g, '/');
}

export default { toWSLPath, getProjectWorkspacePath, isWSL };
