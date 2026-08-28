export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  file?: File;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  status?: 'streaming' | 'error' | string;
  attachments?: Attachment[];
  mentions?: string[];
  // 临时装饰事件（不持久化到 DB，回显时不显示）
  // 用于在流式时显示 agent 进度，不污染 content
  agentEvents?: Array<{ type: 'start' | 'end'; agentName: string; task?: string }>;
  // 临时通知（不持久化到 DB，回显时不显示）
  // 例如模型切换通知 "已自动切换至备用模型: xxx"
  notifications?: string[];
  // 工具调用相关字段（仅 role: 'tool' 消息用）
  toolName?: string;
  toolCallId?: string;
  arguments?: any;
};
