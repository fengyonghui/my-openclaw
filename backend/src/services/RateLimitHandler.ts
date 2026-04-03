/**
 * RateLimitHandler - 429 错误处理服务
 * 
 * 功能：
 * 1. 检测 429 错误并提取 Retry-After 信息
 * 2. 智能退避重试策略
 * 3. 自动切换到备用模型
 * 4. 记录限流状态，避免频繁触发
 */

export interface RateLimitInfo {
  isRateLimited: boolean;
  retryAfter?: number;  // 秒
  resetTime?: Date;
  provider?: string;
  modelId?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  priority?: number;  // 优先级，数字越小优先级越高
  rateLimitInfo?: RateLimitInfo;
}

// 限流状态缓存（内存缓存，5分钟后自动清理）
const rateLimitCache = new Map<string, { info: RateLimitInfo; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

/**
 * 解析 API 错误响应，检测是否为 429 错误
 */
export function parseApiError(error: any): RateLimitInfo | null {
  // 检查 HTTP 状态码
  const status = error?.status || error?.response?.status;
  
  if (status === 429) {
    const headers = error?.response?.headers || {};
    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    
    let retrySeconds = 60; // 默认等待 60 秒
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      if (!isNaN(parsed)) {
        retrySeconds = parsed;
      }
    }
    
    return {
      isRateLimited: true,
      retryAfter: retrySeconds,
      resetTime: new Date(Date.now() + retrySeconds * 1000),
      provider: error?.provider,
      modelId: error?.modelId
    };
  }
  
  // 检查错误消息中的 429 标识
  const errorMsg = error?.message || '';
  if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests') || errorMsg.includes('rate limit')) {
    return {
      isRateLimited: true,
      retryAfter: 60,
      resetTime: new Date(Date.now() + 60000),
      provider: error?.provider,
      modelId: error?.modelId
    };
  }
  
  return null;
}

/**
 * 检查模型是否处于限流状态
 */
export function isModelRateLimited(modelId: string): RateLimitInfo | null {
  const cached = rateLimitCache.get(modelId);
  if (!cached) return null;
  
  // 检查缓存是否过期
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    rateLimitCache.delete(modelId);
    return null;
  }
  
  // 检查限流是否已重置
  if (cached.info.resetTime && new Date() > cached.info.resetTime) {
    rateLimitCache.delete(modelId);
    return null;
  }
  
  return cached.info;
}

/**
 * 记录模型的限流状态
 */
export function setModelRateLimited(modelId: string, info: RateLimitInfo): void {
  rateLimitCache.set(modelId, {
    info,
    timestamp: Date.now()
  });
  console.log(`[RateLimit] Model ${modelId} rate limited. Reset at: ${info.resetTime?.toISOString()}`);
}

/**
 * 计算指数退避等待时间
 */
export function calculateBackoff(attempt: number, baseDelay: number = 1000): number {
  // 指数退避：1s, 2s, 4s, 8s... 最大 30s
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // 添加随机抖动（±20%），避免同时重试
  const jitter = delay * 0.2 * Math.random();
  return Math.floor(delay + jitter);
}

/**
 * 智能模型选择：跳过当前限流的模型
 */
export function selectAvailableModel(
  models: ModelConfig[],
  excludeModelIds: string[] = []
): ModelConfig | null {
  // 按优先级排序
  const sortedModels = [...models].sort((a, b) => (a.priority || 0) - (b.priority || 0));
  
  for (const model of sortedModels) {
    // 跳过已排除的模型
    if (excludeModelIds.includes(model.id)) continue;
    
    // 检查是否处于限流状态
    const rateLimitInfo = isModelRateLimited(model.id);
    if (rateLimitInfo?.isRateLimited) {
      console.log(`[RateLimit] Skipping model ${model.name} - rate limited until ${rateLimitInfo.resetTime}`);
      continue;
    }
    
    return model;
  }
  
  return null;
}

/**
 * 带限流处理的 API 请求包装器
 */
export async function fetchWithRateLimitHandling(
  model: ModelConfig,
  requestBody: any,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    onRetry?: (attempt: number, error: any) => void;
    onRateLimit?: (info: RateLimitInfo) => void;
    onModelSwitch?: (newModel: ModelConfig) => void;
  } = {}
): Promise<{ success: boolean; data?: any; error?: any; switchedModel?: ModelConfig }> {
  const { maxRetries = 3, retryDelay = 2000, onRetry, onRateLimit, onModelSwitch } = options;
  
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const apiUrl = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        const error: any = new Error(`HTTP ${response.status}: ${errorText}`);
        error.status = response.status;
        error.provider = model.provider;
        error.modelId = model.modelId;
        throw error;
      }
      
      const data = await response.json();
      return { success: true, data };
      
    } catch (error: any) {
      lastError = error;
      
      // 检查是否为 429 错误
      const rateLimitInfo = parseApiError(error);
      
      if (rateLimitInfo?.isRateLimited) {
        // 记录限流状态
        setModelRateLimited(model.id, rateLimitInfo);
        
        // 通知调用方
        onRateLimit?.(rateLimitInfo);
        
        console.log(`[RateLimit] Model ${model.name} returned 429. Retry-After: ${rateLimitInfo.retryAfter}s`);
        
        // 如果有限流等待时间，使用该时间；否则使用指数退避
        const waitTime = rateLimitInfo.retryAfter 
          ? rateLimitInfo.retryAfter * 1000 
          : calculateBackoff(attempt);
        
        if (attempt < maxRetries - 1) {
          console.log(`[RateLimit] Waiting ${waitTime / 1000}s before retry ${attempt + 2}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          onRetry?.(attempt + 1, error);
        }
      } else {
        // 非 429 错误，使用普通重试
        if (attempt < maxRetries - 1) {
          const backoff = calculateBackoff(attempt);
          console.log(`[Error] Model ${model.name} failed: ${error.message}. Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          onRetry?.(attempt + 1, error);
        }
      }
    }
  }
  
  return { 
    success: false, 
    error: {
      message: lastError?.message || 'Unknown error',
      status: lastError?.status,
      isRateLimit: parseApiError(lastError)?.isRateLimited || false
    }
  };
}

/**
 * 清理过期的限流缓存
 */
export function cleanupRateLimitCache(): void {
  const now = Date.now();
  for (const [modelId, cached] of rateLimitCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL) {
      rateLimitCache.delete(modelId);
    }
  }
}

// 定期清理缓存（每分钟）
setInterval(cleanupRateLimitCache, 60000);
