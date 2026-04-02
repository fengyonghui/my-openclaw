/**
 * 流式聊天处理模块
 * 
 * 集成到 chats.ts 的主要聊天流程
 * 支持 stream: true 的真正流式响应
 */

import { streamModelRequest, PartialToolCall } from './StreamingService.js';

// ============================================
// 配置
// ============================================

// 是否启用流式模式（可以通过环境变量或配置文件控制）
const USE_STREAMING = process.env.USE_STREAMING !== 'false'; // 默认启用

// ============================================
// 类型定义
// ============================================

export interface StreamingConfig {
  enabled: boolean;
  maxTokens: number;
  temperature: number;
}

export interface ChatContext {
  project: any;
  allProjectAgents: any[];
  allEnabledSkills: any[];
  reply: any;
  abortController: AbortController;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  name: string;
  maxTokens?: number;
  temperature?: number;
}

// ============================================
// 流式处理函数
// ============================================

/**
 * 处理流式聊天请求
 * 
 * @param apiUrl API URL
 * @param modelCfg 模型配置
 * @param messages 消息列表
 * @param tools 工具列表
 * @param context 聊天上下文
 * @param executeToolCall 工具调用执行函数
 */
export async function processStreamingChat(
  apiUrl: string,
  modelCfg: ModelConfig,
  messages: any[],
  tools: any[],
  context: ChatContext,
  executeToolCall: (project: any, toolCall: any, agents: any[], skills: any[], reply: any) => Promise<any>
): Promise<{ success: boolean; content: string; toolCallsExecuted: number }> {
  const { project, allProjectAgents, allEnabledSkills, reply, abortController } = context;

  let fullContent = '';
  let toolCallsExecuted = 0;
  const finalMessages = [...messages];
  let guard = 0;
  const MAX_GUARDS = 8;

  // 设置 SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  console.log(`[Streaming] Starting streaming chat with model: ${modelCfg.name}`);

  try {
    while (guard++ < MAX_GUARDS) {
      console.log(`[Streaming] Guard iteration ${guard}`);

      // 收集工具调用
      const collectedToolCalls: PartialToolCall[] = [];
      let currentContent = '';

      await streamModelRequest(
        {
          apiUrl,
          apiKey: modelCfg.apiKey,
          modelId: modelCfg.modelId,
          messages: finalMessages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: modelCfg.maxTokens || 8192,
          temperature: modelCfg.temperature || 0.7,
          abortSignal: abortController.signal
        },
        {
          // 处理内容块 - 实时发送到前端
          onChunk: (chunk: string) => {
            currentContent += chunk;
            reply.raw.write(`data: ${JSON.stringify({ chunk, type: 'assistant' })}\n\n`);
          },

          // 处理工具调用增量
          onToolCall: (toolCall: PartialToolCall) => {
            console.log(`[Streaming] Tool call progress: ${toolCall.function.name}`);
          },

          // 流完成
          onComplete: async (content: string, toolCalls: PartialToolCall[]) => {
            fullContent = content;
            if (toolCalls.length > 0) {
              collectedToolCalls.push(...toolCalls);
            }
          },

          // 错误处理
          onError: (error: Error) => {
            console.error(`[Streaming] Error: ${error.message}`);
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          }
        }
      );

      // 如果没有工具调用，退出循环
      if (collectedToolCalls.length === 0) {
        break;
      }

      console.log(`[Streaming] Processing ${collectedToolCalls.length} tool calls`);

      // 发送工具调用信息到前端
      reply.raw.write(`data: ${JSON.stringify({
        type: 'tool_call',
        toolCalls: collectedToolCalls.map(tc => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments
        }))
      })}\n\n`);

      // 添加助手消息（包含工具调用）
      finalMessages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: collectedToolCalls
      });

      // 执行每个工具调用
      for (const toolCall of collectedToolCalls) {
        console.log(`[Streaming] Executing tool: ${toolCall.function.name}`);

        let toolResult: any;
        try {
          // 转换为 executeToolCall 期望的格式
          const formattedToolCall = {
            id: toolCall.id,
            type: toolCall.type,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          };

          toolResult = await executeToolCall(project, formattedToolCall, allProjectAgents, allEnabledSkills, reply);
          toolCallsExecuted++;
        } catch (err: any) {
          toolResult = { error: err.message };
          console.error(`[Streaming] Tool execution error: ${err.message}`);
        }

        // 处理工具结果
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        const cmd = (toolArgs.command || '').toLowerCase();
        const isReadCmd = toolName === 'read_file' || toolName === 'list_files' ||
          (toolName === 'file-io' && (cmd === 'read_file' || cmd === 'read' || cmd === 'list_files' || cmd === 'list'));

        let displayResult: any;
        if (isReadCmd) {
          displayResult = {
            success: true,
            message: toolResult.message || '✅ 操作完成',
            path: toolResult.path,
            totalLines: toolResult.totalLines,
            entriesCount: toolResult.entries?.length,
            preview: toolResult.content ? toolResult.content.split('\n').slice(0, 3).join('\n') + '\n...' : undefined
          };
        } else {
          displayResult = toolResult;
        }

        // 发送工具结果到前端
        reply.raw.write(`data: ${JSON.stringify({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          result: displayResult
        })}\n\n`);

        // 添加工具结果到消息历史
        finalMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(displayResult, null, 2)
        });
      }

      // 继续循环，让模型处理工具结果
    }

    // 发送完成信号
    reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);

    return { success: true, content: fullContent, toolCallsExecuted };

  } catch (err: any) {
    console.error(`[Streaming] Fatal error: ${err.message}`);
    reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    return { success: false, content: fullContent, toolCallsExecuted };
  }
}

// ============================================
// 非流式处理（兼容模式）
// ============================================

/**
 * 处理非流式聊天请求（保持原有逻辑）
 */
export async function processNonStreamingChat(
  apiUrl: string,
  modelCfg: ModelConfig,
  messages: any[],
  tools: any[],
  context: ChatContext,
  executeToolCall: (project: any, toolCall: any, agents: any[], skills: any[], reply: any) => Promise<any>,
  extractToolCalls: (choice: any) => any[]
): Promise<{ success: boolean; content: string; toolCallsExecuted: number }> {
  const { project, allProjectAgents, allEnabledSkills, reply, abortController } = context;

  let fullAssistantContent = '';
  let toolCallsExecuted = 0;
  const finalMessages = [...messages];
  let guard = 0;
  const MAX_GUARDS = 8;

  while (guard++ < MAX_GUARDS) {
    const reqBody: any = {
      model: modelCfg.modelId,
      messages: finalMessages,
      stream: false,
      max_tokens: modelCfg.maxTokens || 8192,
      temperature: modelCfg.temperature || 0.7
    };

    if (tools.length > 0) {
      reqBody.tools = tools;
      console.log(`[DEBUG] Sending ${tools.length} tools: ${tools.map((t: any) => t.function.name).join(', ')}`);
    }

    console.log(`[DEBUG] About to send request with ${finalMessages.length} messages`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelCfg.apiKey}`
      },
      body: JSON.stringify(reqBody),
      signal: abortController.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message || {};
    const toolCalls = extractToolCalls(choice);

    if (toolCalls.length > 0) {
      // 发送助手消息到前端
      if (message.content) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: message.content, type: 'assistant' })}\n\n`);
      }

      reply.raw.write(`data: ${JSON.stringify({
        type: 'tool_call',
        toolCalls: toolCalls.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments
        }))
      })}\n\n`);

      finalMessages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls
      });

      for (const toolCall of toolCalls) {
        let toolResult: any;
        try {
          toolResult = await executeToolCall(project, toolCall, allProjectAgents, allEnabledSkills, reply);
          toolCallsExecuted++;
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        const toolName = toolCall.function?.name;
        const toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
        const cmd = (toolArgs.command || '').toLowerCase();
        const isReadCmd = toolName === 'read_file' || toolName === 'list_files' ||
          (toolName === 'file-io' && (cmd === 'read_file' || cmd === 'read' || cmd === 'list_files' || cmd === 'list'));

        let displayResult: any;
        if (isReadCmd) {
          displayResult = {
            success: true,
            message: toolResult.message || '✅ 操作完成',
            path: toolResult.path,
            totalLines: toolResult.totalLines,
            entriesCount: toolResult.entries?.length,
            preview: toolResult.content ? toolResult.content.split('\n').slice(0, 3).join('\n') + '\n...' : undefined
          };
        } else {
          displayResult = toolResult;
        }

        reply.raw.write(`data: ${JSON.stringify({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.function?.name,
          result: displayResult
        })}\n\n`);

        finalMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(displayResult, null, 2)
        });
      }

      continue; // 继续循环处理工具结果
    }

    fullAssistantContent = message.content || '';
    break;
  }

  return { success: true, content: fullAssistantContent, toolCallsExecuted };
}

// ============================================
// 主入口函数
// ============================================

/**
 * 处理聊天请求（自动选择流式或非流式）
 */
export async function handleChatRequest(
  apiUrl: string,
  modelCfg: ModelConfig,
  messages: any[],
  tools: any[],
  context: ChatContext,
  executeToolCall: (project: any, toolCall: any, agents: any[], skills: any[], reply: any) => Promise<any>,
  extractToolCalls: (choice: any) => any[]
): Promise<{ success: boolean; content: string; toolCallsExecuted: number }> {
  
  // 根据配置选择模式
  if (USE_STREAMING) {
    console.log('[Chat] Using STREAMING mode');
    return processStreamingChat(apiUrl, modelCfg, messages, tools, context, executeToolCall);
  } else {
    console.log('[Chat] Using NON-STREAMING mode');
    return processNonStreamingChat(apiUrl, modelCfg, messages, tools, context, executeToolCall, extractToolCalls);
  }
}

// ============================================
// 导出
// ============================================

export default {
  handleChatRequest,
  processStreamingChat,
  processNonStreamingChat,
  USE_STREAMING
};
