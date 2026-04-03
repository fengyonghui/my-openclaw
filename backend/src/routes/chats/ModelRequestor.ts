/**
 * ModelRequestor - 模型请求器
 * 
 * 处理与模型 API 的通信，包括重试和故障转移
 */

import { parseApiError, isModelRateLimited, setModelRateLimited, calculateBackoff } from '../../services/RateLimitHandler.js';

export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelRequestOptions {
  messages: any[];
  tools?: any[];
  toolChoice?: 'auto' | 'required' | 'none';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, model: ModelConfig, error: any) => void;
  onModelSwitch?: (fromModel: ModelConfig, toModel: ModelConfig) => void;
  onRateLimit?: (model: ModelConfig, info: any) => void;
}

export interface ModelRequestResult {
  success: boolean;
  data?: any;
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
 * 提取工具调用
 */
export function extractToolCalls(choice: any): any[] {
  // 标准方式
  if (Array.isArray(choice?.message?.tool_calls)) {
    return choice.message.tool_calls;
  }
  if (Array.isArray(choice?.delta?.tool_calls)) {
    return choice.delta.tool_calls;
  }
  
  // MiniMax 推理模型：工具调用可能在 content 的 <think> 标签中
  const content = choice?.message?.content || '';
  return extractToolCallsFromContent(content);
}

/**
 * 从内容中提取工具调用（MiniMax XML 格式）
 */
function extractToolCallsFromContent(content: string): any[] {
  const toolCalls: any[] = [];
  
  // 1. 匹配 MiniMax XML 格式: <invoke name="tool_name">...</invoke>
  const invokePattern = /<invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi;
  let match;
  
  while ((match = invokePattern.exec(content)) !== null) {
    const toolName = match[1].trim();
    const invokeContent = match[2].trim();
    
    let args: any = {};
    try {
      args = JSON.parse(invokeContent);
    } catch {
      const paramMatch = invokeContent.match(/<parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/i);
      if (paramMatch) {
        args = { [paramMatch[1].trim()]: paramMatch[2].trim() };
      } else {
        args = { command: invokeContent };
      }
    }
    
    toolCalls.push(createToolCall(toolName, args));
  }
  
  // 2. 匹配 JavaScript 函数调用格式: tool_name({...}) 或 tool_name({...})
  const jsFuncPattern = /(delegate_to_agent|list_files|read_file|write_file|edit_file|shell_exec|shell-cmd|file-io)\s*\(\s*([\s\S]*?)\s*\)/gi;
  while ((match = jsFuncPattern.exec(content)) !== null) {
    const toolName = match[1];
    const argsStr = match[2].trim();
    
    if (argsStr && !toolCalls.some(tc => tc.function.name === toolName)) {
      let args: any = {};
      try {
        // 尝试解析 JSON
        args = JSON.parse(argsStr);
      } catch {
        // 尝试解析 JavaScript 对象格式: { key: "value", key2: "value2" }
        args = parseJsObject(argsStr);
      }
      
      if (Object.keys(args).length > 0) {
        toolCalls.push(createToolCall(toolName, args));
      }
    }
  }
  
  // 3. 匹配 Markdown 代码块中的工具调用
  const codeBlockPattern = /```(?:javascript|json|js)?\s*([\s\S]*?)```/gi;
  while ((match = codeBlockPattern.exec(content)) !== null) {
    const codeContent = match[1].trim();
    
    // 在代码块中查找工具调用
    const innerMatch = codeContent.match(/(delegate_to_agent|list_files|read_file|write_file|edit_file|shell_exec)\s*\(\s*([\s\S]*?)\s*\)/);
    if (innerMatch) {
      const toolName = innerMatch[1];
      const argsStr = innerMatch[2].trim();
      
      if (!toolCalls.some(tc => tc.function.name === toolName)) {
        let args: any = {};
        try {
          args = JSON.parse(argsStr);
        } catch {
          args = parseJsObject(argsStr);
        }
        
        if (Object.keys(args).length > 0) {
          toolCalls.push(createToolCall(toolName, args));
        }
      }
    }
  }
  
  console.log(`[extractToolCalls] Found ${toolCalls.length} tool calls from content`);
  return toolCalls;
}

/**
 * 创建工具调用对象
 */
function createToolCall(name: string, args: any): any {
  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'function',
    function: {
      name: name,
      arguments: JSON.stringify(args)
    }
  };
}

/**
 * 解析 JavaScript 对象格式的参数
 * 例如: { agent_name: "UX", task: "添加分页功能" }
 */
function parseJsObject(str: string): any {
  const result: any = {};
  
  // 匹配 key: "value" 或 key: 'value' 或 key: value 格式
  const propPattern = /(?:[\w_]+)\s*:\s*(["'])([^"']*?)\1|([\w_]+)\s*:\s*(\w+)/g;
  let match;
  
  while ((match = propPattern.exec(str)) !== null) {
    const keyMatch = str.slice(0, match.index).match(/([\w_]+)\s*:\s*$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = match[2] || match[4] || '';
      result[key] = value.trim();
    }
  }
  
  // 更简单的匹配方式
  const simplePattern = /([\w_]+)\s*:\s*["']([^"']*?)["']/g;
  while ((match = simplePattern.exec(str)) !== null) {
    result[match[1]] = match[2].trim();
  }
  
  return result;
}

/**
 * 发送模型请求（带重试和故障转移）
 */
export async function makeModelRequest(
  primaryModel: ModelConfig,
  fallbackModels: ModelConfig[],
  options: ModelRequestOptions
): Promise<ModelRequestResult> {
  const {
    messages,
    tools = [],
    toolChoice = 'auto',
    maxTokens = 8192,
    temperature = 0.7,
    signal,
    onRetry,
    onModelSwitch,
    onRateLimit
  } = options;
  
  // 构建模型队列
  const allModels = [primaryModel, ...fallbackModels];
  const failedModelIds: string[] = [];
  
  // 统计信息
  const stats = {
    totalAttempts: 0,
    modelsTried: [] as string[],
    rateLimitsHit: 0,
    totalWaitTime: 0
  };
  
  const MAX_RETRIES = 3;
  
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
    
    let modelRetryCount = 0;
    let lastError: any = null;
    
    // 重试循环
    while (modelRetryCount < MAX_RETRIES) {
      stats.totalAttempts++;
      
      try {
        const apiUrl = `${currentModel.baseUrl.replace(/\/+$/, '')}/chat/completions`;
        
        const reqBody: any = {
          model: currentModel.modelId,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false
        };
        
        if (tools.length > 0) {
          reqBody.tools = tools;
          reqBody.tool_choice = toolChoice;
        }
        
        console.log(`[ModelRequest] Attempt ${modelRetryCount + 1} with ${currentModel.name}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentModel.apiKey}`
          },
          body: JSON.stringify(reqBody),
          signal
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          const error: any = new Error(`HTTP ${response.status}: ${errorText.slice(0, 100)}`);
          error.status = response.status;
          error.provider = currentModel.baseUrl;
          error.modelId = currentModel.modelId;
          throw error;
        }
        
        const data = await response.json();
        
        return {
          success: true,
          data,
          model: currentModel,
          stats
        };
        
      } catch (error: any) {
        lastError = error;
        
        // 检查是否为 429 错误
        const rateLimitInfo = parseApiError(error);
        
        if (rateLimitInfo?.isRateLimited) {
          stats.rateLimitsHit++;
          setModelRateLimited(currentModel.id, rateLimitInfo);
          onRateLimit?.(currentModel, rateLimitInfo);
          
          console.log(`[ModelRequest] 429 from ${currentModel.name}. Reset at: ${rateLimitInfo.resetTime?.toISOString()}`);
          
          // 如果是最后一次重试，跳过这个模型
          if (modelRetryCount === MAX_RETRIES - 1) {
            console.log(`[ModelRequest] ${currentModel.name} exhausted, switching to next model`);
            failedModelIds.push(currentModel.id);
            
            const nextModel = allModels.find(m => !failedModelIds.includes(m.id));
            if (nextModel && onModelSwitch) {
              onModelSwitch(currentModel, nextModel);
            }
            break;
          }
          
          // 等待后重试
          const waitTime = rateLimitInfo.retryAfter 
            ? rateLimitInfo.retryAfter * 1000 
            : calculateBackoff(modelRetryCount);
          stats.totalWaitTime += waitTime;
          
          console.log(`[ModelRequest] Waiting ${waitTime / 1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 30000)));
          
          onRetry?.(modelRetryCount + 1, currentModel, error);
        } else {
          // 非 429 错误
          console.error(`[ModelRequest] Error from ${currentModel.name}: ${error.message}`);
          
          if (modelRetryCount === MAX_RETRIES - 1) {
            failedModelIds.push(currentModel.id);
            
            const nextModel = allModels.find(m => !failedModelIds.includes(m.id));
            if (nextModel && onModelSwitch) {
              onModelSwitch(currentModel, nextModel);
            }
            break;
          }
          
          // 指数退避重试
          const backoff = calculateBackoff(modelRetryCount);
          stats.totalWaitTime += backoff;
          
          console.log(`[ModelRequest] Retrying in ${backoff}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          
          onRetry?.(modelRetryCount + 1, currentModel, error);
        }
        
        modelRetryCount++;
      }
    }
  }
  
  // 所有模型都失败
  console.error(`[ModelRequest] All models failed. Tried: ${stats.modelsTried.join(', ')}`);
  
  return {
    success: false,
    error: {
      message: 'All models failed',
      allModelsFailed: true
    },
    stats
  };
}

export default {
  makeModelRequest,
  extractToolCalls,
  extractToolCallsFromContent
};
