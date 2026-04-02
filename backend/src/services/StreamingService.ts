/**
 * 流式响应服务 - 真正的 SSE 流式处理
 * 
 * 功能：
 * 1. 支持 stream: true 的流式模型调用
 * 2. 正确处理 SSE 数据流
 * 3. 支持工具调用的流式处理
 */

import { Transform } from 'stream';

// ============================================
// 类型定义
// ============================================

export interface StreamOptions {
  apiUrl: string;
  apiKey: string;
  modelId: string;
  messages: any[];
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onToolCall?: (toolCall: PartialToolCall) => void;
  onComplete: (fullContent: string, toolCalls: PartialToolCall[]) => void;
  onError: (error: Error) => void;
}

export interface PartialToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================
// 流式解析器
// ============================================

/**
 * 解析 SSE 数据流
 */
export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamCallbacks
): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';
  const toolCalls: Map<number, PartialToolCall> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的行

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            // 流结束
            const finalToolCalls = Array.from(toolCalls.values());
            callbacks.onComplete(fullContent, finalToolCalls);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            
            if (delta) {
              // 处理内容增量
              if (delta.content) {
                fullContent += delta.content;
                callbacks.onChunk(delta.content);
              }
              
              // 处理工具调用增量
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index;
                  
                  if (!toolCalls.has(index)) {
                    toolCalls.set(index, {
                      id: tc.id || '',
                      type: tc.type || 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: ''
                      }
                    });
                  }
                  
                  const existing = toolCalls.get(index)!;
                  if (tc.function?.name) {
                    existing.function.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    existing.function.arguments += tc.function.arguments;
                  }
                  
                  if (callbacks.onToolCall) {
                    callbacks.onToolCall(existing);
                  }
                }
              }
            }
          } catch (parseErr) {
            // 忽略解析错误，继续处理
            console.warn('[SSE] Parse error:', parseErr);
          }
        }
      }
    }
    
    // 处理剩余缓冲区
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data && data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            callbacks.onChunk(delta.content);
          }
        } catch {}
      }
    }
    
    callbacks.onComplete(fullContent, Array.from(toolCalls.values()));
  } catch (err) {
    callbacks.onError(err as Error);
  }
}

// ============================================
// 流式请求函数
// ============================================

/**
 * 发起流式模型请求
 */
export async function streamModelRequest(
  options: StreamOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const {
    apiUrl,
    apiKey,
    modelId,
    messages,
    tools,
    maxTokens = 8192,
    temperature = 0.7,
    abortSignal
  } = options;

  const reqBody: any = {
    model: modelId,
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature
  };

  if (tools && tools.length > 0) {
    reqBody.tools = tools;
  }

  console.log(`[Streaming] Starting stream for model: ${modelId}`);
  console.log(`[Streaming] Tools: ${tools?.length || 0}`);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(reqBody),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    await parseSSEStream(reader, callbacks);
  } catch (err) {
    callbacks.onError(err as Error);
  }
}

// ============================================
// 非流式请求（兼容模式）
// ============================================

/**
 * 发起非流式模型请求（兼容旧版）
 */
export async function nonStreamModelRequest(
  options: StreamOptions
): Promise<{ content: string; toolCalls: PartialToolCall[] }> {
  const {
    apiUrl,
    apiKey,
    modelId,
    messages,
    tools,
    maxTokens = 8192,
    temperature = 0.7,
    abortSignal
  } = options;

  const reqBody: any = {
    model: modelId,
    messages,
    stream: false,
    max_tokens: maxTokens,
    temperature
  };

  if (tools && tools.length > 0) {
    reqBody.tools = tools;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(reqBody),
    signal: abortSignal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data: any = await response.json();
  const choice = data.choices?.[0];
  const message = choice?.message || {};

  const toolCalls: PartialToolCall[] = [];
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      toolCalls.push({
        id: tc.id,
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || ''
        }
      });
    }
  }

  return {
    content: message.content || '',
    toolCalls
  };
}

// ============================================
// 导出
// ============================================

export default {
  streamModelRequest,
  nonStreamModelRequest,
  parseSSEStream
};
