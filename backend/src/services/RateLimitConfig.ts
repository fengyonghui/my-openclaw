/**
 * RateLimitConfig - 429 错误处理配置
 * 
 * 可以在项目配置中自定义这些选项
 */

export interface RateLimitConfig {
  /** 最大重试次数 */
  maxRetries: number;
  
  /** 基础延迟时间（毫秒） */
  baseDelayMs: number;
  
  /** 最大延迟时间（毫秒） */
  maxDelayMs: number;
  
  /** 限流状态缓存 TTL（毫秒） */
  cacheTTL: number;
  
  /** 是否启用前端通知 */
  enableNotifications: boolean;
  
  /** 是否自动切换模型 */
  autoSwitchModel: boolean;
  
  /** 切换模型前的重试次数 */
  switchAfterRetries: number;
  
  /** 退避策略 */
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  
  /** 是否添加随机抖动 */
  enableJitter: boolean;
  
  /** 抖动范围（百分比） */
  jitterRange: number;
}

/**
 * 默认配置
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  cacheTTL: 300000, // 5 分钟
  enableNotifications: true,
  autoSwitchModel: true,
  switchAfterRetries: 3,
  backoffStrategy: 'exponential',
  enableJitter: true,
  jitterRange: 0.2 // ±20%
};

/**
 * 配置管理器
 */
class ConfigManager {
  private config: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
  
  /**
   * 获取当前配置
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }
  
  /**
   * 更新配置
   */
  updateConfig(updates: Partial<RateLimitConfig>): void {
    this.config = {
      ...this.config,
      ...updates
    };
  }
  
  /**
   * 重置为默认配置
   */
  resetToDefault(): void {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG };
  }
  
  /**
   * 从 JSON 文件加载配置
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(content);
      this.updateConfig(config);
      console.log(`[Config] Loaded rate limit config from ${filePath}`);
    } catch (error: any) {
      console.warn(`[Config] Could not load config from ${filePath}: ${error.message}`);
    }
  }
  
  /**
   * 保存配置到 JSON 文件
   */
  async saveToFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(filePath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log(`[Config] Saved rate limit config to ${filePath}`);
    } catch (error: any) {
      console.error(`[Config] Could not save config to ${filePath}: ${error.message}`);
    }
  }
}

// 单例导出
export const rateLimitConfigManager = new ConfigManager();

/**
 * 获取当前配置（快捷函数）
 */
export function getRateLimitConfig(): RateLimitConfig {
  return rateLimitConfigManager.getConfig();
}

/**
 * 更新配置（快捷函数）
 */
export function updateRateLimitConfig(updates: Partial<RateLimitConfig>): void {
  rateLimitConfigManager.updateConfig(updates);
}

/**
 * 根据配置计算退避时间
 */
export function calculateConfiguredBackoff(attempt: number): number {
  const config = getRateLimitConfig();
  
  let delay: number;
  
  switch (config.backoffStrategy) {
    case 'exponential':
      delay = config.baseDelayMs * Math.pow(2, attempt);
      break;
    case 'linear':
      delay = config.baseDelayMs * (attempt + 1);
      break;
    case 'fixed':
    default:
      delay = config.baseDelayMs;
  }
  
  // 应用最大延迟限制
  delay = Math.min(delay, config.maxDelayMs);
  
  // 添加抖动
  if (config.enableJitter) {
    const jitter = delay * config.jitterRange * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }
  
  return Math.floor(delay);
}

/**
 * 验证配置
 */
export function validateRateLimitConfig(config: Partial<RateLimitConfig>): string[] {
  const errors: string[] = [];
  
  if (config.maxRetries !== undefined && (config.maxRetries < 1 || config.maxRetries > 10)) {
    errors.push('maxRetries must be between 1 and 10');
  }
  
  if (config.baseDelayMs !== undefined && config.baseDelayMs < 100) {
    errors.push('baseDelayMs must be at least 100ms');
  }
  
  if (config.maxDelayMs !== undefined && config.maxDelayMs < config.baseDelayMs) {
    errors.push('maxDelayMs must be greater than or equal to baseDelayMs');
  }
  
  if (config.cacheTTL !== undefined && config.cacheTTL < 60000) {
    errors.push('cacheTTL must be at least 60000ms (1 minute)');
  }
  
  if (config.jitterRange !== undefined && (config.jitterRange < 0 || config.jitterRange > 0.5)) {
    errors.push('jitterRange must be between 0 and 0.5');
  }
  
  return errors;
}

export default {
  DEFAULT_RATE_LIMIT_CONFIG,
  rateLimitConfigManager,
  getRateLimitConfig,
  updateRateLimitConfig,
  calculateConfiguredBackoff,
  validateRateLimitConfig
};
