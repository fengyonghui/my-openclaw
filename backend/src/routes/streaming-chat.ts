/**
 * 流式聊天处理函数
 * 
 * 这个文件包含支持 stream: true 的聊天处理逻辑
 * 可以与现有的非流式逻辑共存
 */

import { FastifyInstance } from 'fastify';
import { streamModelRequest, nonStreamModelRequest, PartialToolCall } from '../services/StreamingService.js';

// ============================================
// 流式聊天处理
// ============================================

/**
 * 处理流式聊天请求
 * 
 * @param options 配置选项
 * @param reply Fastify reply 对象
 */
export async function handleStreamingChat(
  options: {
    apiUrl: string;
    apiKey: string;
    modelId: string;
    messages: any[];
    tools?: any[];
    maxTokens?: number;
    temperature?: number;
    abortSignal?: AbortSignal;
    reply: any;
    project: any;
    allProjectAgents: any[];
    allEnabledSkills: any[];
    onToolCall?: (toolCall: any, result: any) => void;
  }
): Promise<{ success: boolean; content: string; toolCallsExecuted: number }> {
  const {
    apiUrl,
    apiKey,
    modelId,
    messages,
    tools,
    maxTokens = 8192,
    temperature = 0.7,
    abortSignal,
    reply,
    project,
    allProjectAgents,
    allEnabledSkills,
    onToolCall
  } = options;

  let fullContent = '';
  let toolCallsExecuted = 0;
  const finalMessages = [...messages];

  // 设置 SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  try {
    await streamModelRequest(
      {
        apiUrl,
        apiKey,
        modelId,
        messages: finalMessages,
        tools,
        maxTokens,
        temperature,
        abortSignal
      },
      {
        // 处理内容块
        onChunk: (chunk: string) => {
          fullContent += chunk;
          reply.raw.write(`data: ${JSON.stringify({ chunk, type: 'assistant' })}\n\n`);
        },
        
        // 处理工具调用（增量）
        onToolCall: (toolCall: PartialToolCall) => {
          console.log(`[Stream] Tool call progress: ${toolCall.function.name}`);
        },
        
        // 流完成
        onComplete: async (content: string, toolCalls: PartialToolCall[]) => {
          fullContent = content;
          
          if (toolCalls.length > 0) {
            console.log(`[Stream] Processing ${toolCalls.length} tool calls`);
            
            // 发送工具调用信息
            reply.raw.write(`data: ${JSON.stringify({
              type: 'tool_call',
              toolCalls: toolCalls.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments
              }))
            })}\n\n`);
            
            // 添加助手消息
            finalMessages.push({
              role: 'assistant',
              content: fullContent,
              tool_calls: toolCalls
            });
            
            // 执行工具调用
            for (const toolCall of toolCalls) {
              try {
                const result = await executeToolCallFromStream(
                  project,
                  toolCall,
                  allProjectAgents,
                  allEnabledSkills,
                  reply
                );
                
                toolCallsExecuted++;
                
                // 发送工具结果
                reply.raw.write(`data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  result
                })}\n\n`);
                
                // 添加工具结果到消息
                finalMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result, null, 2)
                });
                
                if (onToolCall) {
                  onToolCall(toolCall, result);
                }
              } catch (err: any) {
                console.error(`[Stream] Tool call error: ${err.message}`);
                reply.raw.write(`data: ${JSON.stringify({
                  type: 'tool_result',
                  toolCallId: toolCall.id,
                  toolName: toolCall.function.name,
                  result: { error: err.message }
                })}\n\n`);
              }
            }
          }
        },
        
        // 错误处理
        onError: (error: Error) => {
          console.error(`[Stream] Error: ${error.message}`);
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        }
      }
    );

    // 发送完成信号
    reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    
    return { success: true, content: fullContent, toolCallsExecuted };
  } catch (err: any) {
    console.error(`[Stream] Fatal error: ${err.message}`);
    reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    return { success: false, content: fullContent, toolCallsExecuted };
  }
}

// ============================================
// 工具调用执行（从流式处理）
// ============================================

async function executeToolCallFromStream(
  project: any,
  toolCall: PartialToolCall,
  allProjectAgents: any[],
  allEnabledSkills: any[],
  reply: any
): Promise<any> {
  const fn = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments || '{}');
  
  // 这里需要引入 executeToolCall 函数
  // 由于模块依赖问题，我们返回一个占位符
  // 实际使用时需要在 chats.ts 中导入并调用
  
  console.log(`[Stream] Executing tool: ${fn}`);
  
  // 简单的文件操作处理
  switch (fn) {
    case 'list_files':
    case 'list':
      const { FileToolService } = await import('../services/FileToolService.js');
      return await FileToolService.listFiles(project.workspace, args.path || '.', Number(args.depth) || 3);
    
    case 'read_file':
    case 'read':
      const { FileToolService: FTS } = await import('../services/FileToolService.js');
      return await FTS.readFile(project.workspace, args.path, Number(args.offset) || 1, Number(args.limit) || 200);
    
    case 'write_file':
    case 'write':
      const { FileToolService: FTS2 } = await import('../services/FileToolService.js');
      return await FTS2.writeFile(project.workspace, args.path, args.content || '');
    
    case 'edit_file':
    case 'edit':
      const { FileToolService: FTS3 } = await import('../services/FileToolService.js');
      return await FTS3.editFile(project.workspace, args.path, args.oldText || '', args.newText || '');
    
    default:
      return { error: `Unknown tool: ${fn}` };
  }
}

// ============================================
// 导出
// ============================================

export default {
  handleStreamingChat
};
