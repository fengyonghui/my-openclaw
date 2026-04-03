/**
 * ModelRequestHandler - 增强的模型请求处理器
 * 
 * 集成 429 错误处理、模型故障转移、智能重试
 */

import { 
  RateLimitInfo, 
  parseApiError, 
  isModelRateLimited, 
  setModelRateLimited,
  calculateBackoff,
  selectAvailableModel,
  fetchWithRateLimitHandling,
  cleanupRateLimitCache
} from './RateLimitHandler.js';

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  priority?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ModelRequestOptions {
  tools?: any[];
  toolChoice?: 'auto' | 'required' | 'none';
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, model: ModelConfig, error: any) => void;
  onModelSwitch?: (fromModel: ModelConfig, toModel: ModelConfig) => void;
  onRateLimit?: (model: ModelConfig, info: RateLimitInfo) => void;
  onToolCall?: (toolCall: any) => void;
  onChunk?: (chunk: string) => void;
}

export interface ModelRequestResult {
  success: boolean;
  content?: string;
  toolCalls?: any[];
  model?: ModelConfig;
  error?: {
    message: string;
    status?: number;
    isRateLimit?: boolean;
    allModelsFailed?: boolean;
  };
  stats?: {
    totalAttempts: number;
    modelsTried: string[];
    rateLimitsHit: number;
    totalWaitTime: number;
  };
}

/**
 * 增强的模型请求处理器
 * 
 * 特性：
 * 1. 自动处理 429 错误
 * 2. 智能模型故障转移
 * 3. 指数退避重试
 * 4. 详细的状态回调
 */
export async function makeModelRequest(
  primaryModel: ModelConfig,
  fallbackModels: ModelConfig[],
  messages: ChatMessage[],
  options: ModelRequestOptions = {}
): Promise<ModelRequestResult> {
  const {
    tools = [],
    toolChoice = 'auto',
    temperature = 0.7,
    maxTokens = 4096,
    signal,
    onRetry,
    onModelSwitch,
    onRateLimit,
    onToolCall,
    onChunk
  } = options;

  // 构建模型队列：主模型 + 备选模型
  const allModels = [primaryModel, ...fallbackModels];
  
  // 已尝试且失败的模型
  const failedModelIds: string[] = [];
  
  // 统计信息
  const stats = {
    totalAttempts: 0,
    modelsTried: [] as string[],
    rateLimitsHit: 0,
    totalWaitTime: 0
  };

  // 遍历模型队列
  for (const currentModel of allModels) {
    // 跳过已失败的模型
    if (failedModelIds.includes(currentModel.id)) continue;
    
    // 跳过处于限流状态的模型
    const rateLimitInfo = isModelRateLimited(currentModel.id);
    if (rateLimitInfo?.isRateLimited) {
      console.log(`[ModelRequest] Skipping ${currentModel.name} - rate limited until ${rateLimitInfo.resetTime}`);
      failedModelIds.push(currentModel.id);
      continue;
    }
    
    stats.modelsTried.push(currentModel.name);
    
    // 构建请求体
    const requestBody: any = {
      model: currentModel.modelId,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
    
    if (tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice;
    }
    
    // 发送请求（带重试）
    const maxRetries = 3;
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      stats.totalAttempts++;
      
      try {
        const apiUrl = `${currentModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        
        console.log(`[ModelRequest] Attempt ${attempt + 1} with ${currentModel.name}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentModel.apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          const error: any = new Error(`HTTP ${response.status}: ${errorText}`);
          error.status = response.status;
          error.provider = currentModel.provider;
          error.modelId = currentModel.modelId;
          throw error;
        }
        
        const data = await response.json();
        const choice = data.choices?.[0];
        const message = choice?.message || {};
        
        // 检查是否有工具调用
        const toolCalls = message.tool_calls || [];
        if (toolCalls.length > 0) {
          return {
            success: true,
            content: message.content || '',
            toolCalls,
            model: currentModel,
            stats
          };
        }
        
        // 返回最终结果
        return {
          success: true,
          content: message.content || '',
          model: currentModel,
          stats
        };
        
      } catch (error: any) {
        lastError = error;
        
        // 检查是否为 429 错误
        const rateLimitInfo = parseApiError(error);
        
        if (rateLimitInfo?.isRateLimited) {
          stats.rateLimitsHit++;
          
          // 记录限流状态
          setModelRateLimited(currentModel.id, rateLimitInfo);
          
          // 通知回调
          onRateLimit?.(currentModel, rateLimitInfo);
          
          console.log(`[ModelRequest] 429 from ${currentModel.name}. Retry-After: ${rateLimitInfo.retryAfter}s`);
          
          // 如果是最后一次重试，跳过这个模型
          if (attempt === maxRetries - 1) {
            console.log(`[ModelRequest] ${currentModel.name} exhausted, switching to next model`);
            failedModelIds.push(currentModel.id);
            
            // 通知模型切换
            const nextModel = selectAvailableModel(allModels, failedModelIds);
            if (nextModel && onModelSwitch) {
              onModelSwitch(currentModel, nextModel);
            }
            break;
          }
          
          // 等待后重试
          const waitTime = rateLimitInfo.retryAfter 
            ? rateLimitInfo.retryAfter * 1000 
            : calculateBackoff(attempt);
          stats.totalWaitTime += waitTime;
          
          console.log(`[ModelRequest] Waiting ${waitTime / 1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          onRetry?.(attempt + 1, currentModel, error);
        } else {
          // 非 429 错误
          console.error(`[ModelRequest] Error from ${currentModel.name}: ${error.message}`);
          
          // 如果是最后一次重试，标记模型失败
          if (attempt === maxRetries - 1) {
            failedModelIds.push(currentModel.id);
            
            // 通知模型切换
            const nextModel = selectAvailableModel(allModels, failedModelIds);
            if (nextModel && onModelSwitch) {
              onModelSwitch(currentModel, nextModel);
            }
            break;
          }
          
          // 指数退避重试
          const backoff = calculateBackoff(attempt);
          stats.totalWaitTime += backoff;
          
          console.log(`[ModelRequest] Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          
          onRetry?.(attempt + 1, currentModel, error);
        }
      }
    }
  }
  
  // 所有模型都失败
  console.error(`[ModelRequest] All models failed. Tried: ${stats.modelsTried.join(', ')}`);
  
  return {
    success: false,
    error: {
      message: lastError?.message || 'All models failed',
      status: lastError?.status,
      isRateLimit: parseApiError(lastError)?.isRateLimited || false,
      allModelsFailed: true
    },
    stats
  };
}

/**
 * SSE 流式请求处理器（支持 429 处理）
 */
export async function makeStreamingModelRequest(
  primaryModel: ModelConfig,
  fallbackModels: ModelConfig[],
  messages: ChatMessage[],
  options: ModelRequestOptions = {}
): Promise<AsyncGenerator<string, void, unknown>> {
  const {
    tools = [],
    toolChoice = 'auto',
    temperature = 0.7,
    maxTokens = 4096,
    signal,
    onRetry,
    onModelSwitch,
    onRateLimit
  } = options;

  const allModels = [primaryModel, ...fallbackModels];
  const failedModelIds: string[] = [];
  
  async function* attemptRequest(model: ModelConfig): AsyncGenerator<string> {
    const requestBody: any = {
      model: model.modelId,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true
    };
    
    if (tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice;
    }
    
    const apiUrl = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });
    
    if (!response.ok) {
      const error: any = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader available');
    
    const decoder = new TextDecoder();
    let partialLine = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = (partialLine + chunk).split('\n');
      partialLine = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') return;
        
        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta?.content || '';
          if (delta) yield delta;
        } catch {}
      }
    }
  }
  
  // 尝试每个模型
  for (const model of allModels) {
    if (failedModelIds.includes(model.id)) continue;
    
    // 检查限流状态
    const rateLimitInfo = isModelRateLimited(model.id);
    if (rateLimitInfo?.isRateLimited) {
      failedModelIds.push(model.id);
      continue;
    }
    
    try {
      yield* attemptRequest(model);
      return; // 成功，退出
    } catch (error: any) {
      const rlInfo = parseApiError(error);
      
      if (rlInfo?.isRateLimited) {
        setModelRateLimited(model.id, rlInfo);
        onRateLimit?.(model, rlInfo);
      }
      
      failedModelIds.push(model.id);
      
      const nextModel = selectAvailableModel(allModels, failedModelIds);
      if (nextModel && onModelSwitch) {
        onModelSwitch(model, nextModel);
      }
    }
  }
  
  throw new Error('All models failed or rate limited');
}

export default {
  makeModelRequest,
  makeStreamingModelRequest,
  parseApiError,
  isModelRateLimited,
  selectAvailableModel,
  cleanupRateLimitCache
};
