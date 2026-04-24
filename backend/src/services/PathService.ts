/**
 * 路径服务 - 处理跨平台路径转换
 */

// Windows 到 WSL 路径转换
export function toWSLPath(windowsPath: string): string {
  if (!windowsPath) return '';
  
  // 如果已经是 WSL 路径，直接返回
  if (windowsPath.startsWith('/mnt/')) {
    return windowsPath.replace(/\\/g, '/');
  }
  
  // Windows 驱动器路径 (d:\xxx 或 D:\xxx)
  const match = windowsPath.match(/^([a-zA-Z]):[/\\](.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  
  // 其他格式，直接规范化
  return windowsPath.replace(/\\/g, '/');
}

export default { toWSLPath };
