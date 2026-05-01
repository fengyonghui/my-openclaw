/**
 * Chat Routes 模块导出
 * 
 * 将聊天路由功能模块化
 */

export { 
  setAbortController, 
  clearAbortController, 
  stopChat, 
  getActiveChats, 
  isChatActive 
} from './ChatAbortController.js';

export {
  saveToMemoryFile,
  loadMemoryFile,
  isMemoryTrigger,
  extractMemoryContent,
  type SaveResult
} from './MemoryFileHandler.js';

export {
  executeToolCall,
  executeShellCommand,
  executePythonCommand,
  executeFileIO,
  executeAgentDelegation,
  type ToolCall,
  type ToolResult
} from './ToolExecutor.js';

export {
  buildSystemMessage,
  transformMessage,
  buildHistoryMessages,
  normalizeToolCallId,
  cleanMentions,
  type Message,
  type ChatContext
} from './ChatMessageBuilder.js';

export {
  makeModelRequest,
  extractToolCalls,
  type ModelConfig,
  type ModelRequestOptions,
  type ModelRequestResult
} from './ModelRequestor.js';
