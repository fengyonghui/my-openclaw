import type { Message, Attachment } from "./types";

// SSE 事件处理器（供 handleSend / handleResend 复用）
interface SSEHandlers {
  onChunk: (content: string, assistantId: string) => void;
  onInfo: (info: string, assistantId: string) => void;
  onStatus: (status: string, assistantId: string) => void;
  onAgentStart: (agentName: string, task: string | undefined, assistantId: string) => void;
  onAgentEnd: (agentName: string, assistantId: string) => void;
  onAgentError: (agentName: string, error: string, assistantId: string) => void;
  onToolResult: (data: any, assistantId: string) => Promise<void>;
  onError: (err: any, assistantId: string) => void;
  onDone: () => void;
}


// SSE 流处理（解析 data: 行并回调）
async function processSSEStream(
  response: Response,
  assistantId: string,
  handlers: SSEHandlers,
): Promise<void> {
  if (!response.body) throw new Error('网络连接异常');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
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
      if (dataStr === '[DONE]') break;

      try {
        const data = JSON.parse(dataStr);
        if (data.chunk) {
          handlers.onChunk(data.chunk, assistantId);
        }
        if (data.info) handlers.onInfo(data.info, assistantId);
        if (data.status) handlers.onStatus(data.status, assistantId);
        if (data.type === 'agent_start') handlers.onAgentStart(data.agentName, data.task, assistantId);
        if (data.type === 'agent_end' || data.type === 'agent_result') handlers.onAgentEnd(data.agentName, assistantId);
        if (data.type === 'agent_error') handlers.onAgentError(data.agentName, data.error, assistantId);
        if (data.type === 'tool_result') await handlers.onToolResult(data, assistantId);
      } catch (e) { /* ignore parse errors */ }
    }
  }
  handlers.onDone();
}


// 清理 tool 执行期间的 LLM 中间状态文字
const TOOL_PROGRESS_PATTERNS = [
  /^.*(?:执行中|正在|处理中|working|fixing|running)[^\n]*/gim,
  /^.*(?:working on|fixing|running|executing|calling)[^\n]*/gim,
  /^.*[☀-⛿][^\n]*/gm,
  /\s*(?:中\.{3}|ing\.{3}|\.{3})[^\n]*$/gm,
];

function cleanToolProgress(content: string): string {
  let cleaned = content;
  for (const pattern of TOOL_PROGRESS_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function buildToolResultContent(data: any): string {
  const tr = data.result;
  if (typeof tr === "string") return tr;
  if (tr?.error) return `❌ 工具执行失败: ${tr.error}`;
  const lines: string[] = [];
  if (tr?.message) lines.push(tr.message);
  if (tr?.stdout) lines.push("```\n" + tr.stdout.trim() + "\n```");
  if (tr?.path) lines.push(`📁 ${tr.path}`);
  return lines.length > 0 ? lines.join("\n") : "✅ 执行完成";
}

export interface ChatActionsDeps {
  chatId: string;
  projectId: string;
  messages: Message[];
  isTyping: boolean;
  chat: any;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  setVoiceInput: React.Dispatch<React.SetStateAction<string>>;
  setNewTitle: React.Dispatch<React.SetStateAction<string>>;
  setChat: React.Dispatch<React.SetStateAction<any>>;
  currentAgentName?: string;
  // SSE 完成后用 DB 重新同步消息，作为"界面以 DB 为准"的最终真相来源。
  // 修复场景：SSE 增量拼接到错误占位 / 通道中途断开 / stale 自愈提前清理 session
  // 时，前端 messages 状态里最终回复可能缺失，但 DB 已经完整持久化。
  initData: () => Promise<void>;
}

export function useChatActions(deps: ChatActionsDeps) {
  const { chatId, projectId, messages, isTyping, chat, setMessages, setIsTyping, setInput, setAttachments, setVoiceInput, setNewTitle, setChat, initData } = deps;

  // 处理 tool_result 事件
  const handleToolResult = async (
    data: any,
    assistantId: string,
    setMessagesLocal: typeof setMessages,
    setIsTypingLocal: typeof setIsTyping,
  ): Promise<void> => {
    // 从消息列表中读取 assistant 消息的完整内容（不再依赖 __fullContentCache）
    setMessagesLocal(prev => {
      const assistantMsg = prev.find(m => m.id === assistantId);
      const fullContent = assistantMsg?.content || "";
      const cleanedContent = cleanToolProgress(fullContent);
      // 清理掉 assistant 消息中的中间状态文字
      const updated = prev.map(m => m.id === assistantId ? { ...m, content: cleanedContent, status: undefined } : m);
      // 然后附加工具结果消息
      const toolResultContent = buildToolResultContent(data);
      const toolMsg: Message = {
        id: `tool_${data.toolCallId}_${Date.now()}`,
        role: "tool",
        content: toolResultContent,
        toolName: data.toolName,
        toolCallId: data.toolCallId,
        arguments: data.arguments,
      };
      return [...updated, toolMsg];
    });
  };

  // 发送消息
  const handleSend = async (
    text: string,
    attachments: Attachment[],
    setMessagesLocal: typeof setMessages,
    setIsTypingLocal: typeof setIsTyping,
    setInputLocal: typeof setInput,
    setAttachmentsLocal: typeof setAttachments,
    setVoiceInputLocal: typeof setVoiceInput,
  ): Promise<void> => {
    setIsTypingLocal(true);
    const userMsgId = Date.now().toString();
    let currentAssistantId = (Date.now() + 1).toString();
    let toolSegIdx = 0;
    const userAttachments = [...attachments];
    const userMsg: Message = { id: userMsgId, role: "user", content: text, attachments: userAttachments };
    const assistantMsg: Message = { id: currentAssistantId, role: "assistant", content: "", status: "streaming" };
    setMessagesLocal(prev => [...prev, userMsg, assistantMsg]);
    setInputLocal("");
    setAttachmentsLocal([]);
    setVoiceInputLocal("");
    try {
      const attachmentData = userAttachments.map(att => ({
        id: att.id, name: att.name, type: att.type, size: att.size, dataUrl: att.dataUrl,
      }));
      const response = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, attachments: attachmentData }),
      });
      await processSSEStream(response, currentAssistantId, {
        onChunk: (content, aid) => {
          setMessagesLocal(prev => prev.map(m =>
            m.id === aid ? { ...m, content: m.content + content } : m
          ));
        },
        onInfo: (info, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, notifications: [...(m.notifications || []), info] } : m));
        },
        onStatus: (status, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, status } : m));
        },
        onAgentStart: (agentName, task, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "start", agentName, task }],
          } : m));
        },
        onAgentEnd: (agentName, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "end", agentName }],
          } : m));
        },
        onAgentError: (agentName, error, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "end", agentName, task: `❌ 执行失败: ${error}` }],
          } : m));
        },
        onToolResult: async (data, aid) => {
          await handleToolResult(data, aid, setMessagesLocal, setIsTypingLocal);
          toolSegIdx++;
          currentAssistantId = `asst_${Date.now()}_seg${toolSegIdx}`;
          setMessagesLocal(prev => [...prev, { id: currentAssistantId, role: "assistant", content: "", status: "streaming" }]);
        },
        onError: (err, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, content: `错误: ${err.message}`, status: "error" } : m));
        },
        onDone: () => {
          // 🛡️ 流结束后用 DB 重新同步，确保界面以 DB 为准。
          // SSE 增量可能因 onChunk 固定 assistantId 与 onToolResult 新建占位不同步，
          // 或中途断流，导致最终回复没拼到正确槽位；DB 永远是完整真相。
          initData().catch((e: any) => console.warn('[onDone] resync failed', e?.message));
        },
      });
    } catch (err: any) {
      setMessagesLocal(prev => prev.map(m => m.id === currentAssistantId ? { ...m, content: `错误: ${err.message}`, status: "error" } : m));
    } finally {
      setIsTypingLocal(false);
      setMessagesLocal(prev => {
        const filtered = prev.filter(m => m.id === currentAssistantId ? m.content.trim() !== "" || m.status === "error" : true);
        return filtered.map(m => m.id === currentAssistantId && m.status !== "error" ? { ...m, status: undefined } : m);
      });
      // 🛡️ 兜底：catch 路径也用 DB 重新对齐，防止 DB 已落最终回复而界面仍空。
      initData().catch((e: any) => console.warn('[finally] resync failed', e?.message));
    }
  };

  // 重发消息
  const handleResend = async (
    userMsg: Message,
    setMessagesLocal: typeof setMessages,
    setIsTypingLocal: typeof setIsTyping,
  ): Promise<void> => {
    if (isTyping) return;
    const text = userMsg.content;
    if (!text && (!userMsg.attachments || userMsg.attachments.length === 0)) return;
    const msgIndex = messages.findIndex(m => m.id === userMsg.id);
    if (msgIndex === -1) return;
    let currentAssistantId = (Date.now() + 1).toString();
    let toolSegIdx = 0;
    const assistantMsg: Message = { id: currentAssistantId, role: "assistant", content: "", status: "streaming" };
    setMessagesLocal(prev => {
      const beforeUser = prev.slice(0, msgIndex + 1);
      return [...beforeUser, assistantMsg];
    });
    setIsTypingLocal(true);
    try {
      const attachmentData = (userMsg.attachments || []).map(att => ({
        id: att.id, name: att.name, type: att.type, size: att.size, dataUrl: att.dataUrl,
      }));
      const response = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: userMsg.id, content: text, attachments: attachmentData }),
      });
      await processSSEStream(response, currentAssistantId, {
        onChunk: (content, aid) => {
          setMessagesLocal(prev => prev.map(m =>
            m.id === aid ? { ...m, content: m.content + content } : m
          ));
        },
        onInfo: (info, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, notifications: [...(m.notifications || []), info] } : m));
        },
        onStatus: (status, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, status } : m));
        },
        onAgentStart: (agentName, task, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "start", agentName, task }],
          } : m));
        },
        onAgentEnd: (agentName, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "end", agentName }],
          } : m));
        },
        onAgentError: (agentName, error, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? {
            ...m, agentEvents: [...(m.agentEvents || []), { type: "end", agentName, task: `❌ 执行失败: ${error}` }],
          } : m));
        },
        onToolResult: async (data, aid) => {
          await handleToolResult(data, aid, setMessagesLocal, setIsTypingLocal);
          toolSegIdx++;
          currentAssistantId = `asst_${Date.now()}_seg${toolSegIdx}`;
          setMessagesLocal(prev => [...prev, { id: currentAssistantId, role: "assistant", content: "", status: "streaming" }]);
        },
        onError: (err, aid) => {
          setMessagesLocal(prev => prev.map(m => m.id === aid ? { ...m, content: `错误: ${err.message}`, status: "error" } : m));
        },
        onDone: () => {
          // 🛡️ 流结束后用 DB 重新同步，确保界面以 DB 为准。
          // SSE 增量可能因 onChunk 固定 assistantId 与 onToolResult 新建占位不同步，
          // 或中途断流，导致最终回复没拼到正确槽位；DB 永远是完整真相。
          initData().catch((e: any) => console.warn('[onDone] resync failed', e?.message));
        },
      });
    } catch (err: any) {
      setMessagesLocal(prev => prev.map(m => m.id === currentAssistantId ? { ...m, content: `错误: ${err.message}`, status: "error" } : m));
    } finally {
      setIsTypingLocal(false);
      setMessagesLocal(prev => {
        const filtered = prev.filter(m => m.id === currentAssistantId ? m.content.trim() !== "" || m.status === "error" : true);
        return filtered.map(m => m.id === currentAssistantId && m.status !== "error" ? { ...m, status: undefined } : m);
      });
      // 🛡️ 兜底：catch 路径也用 DB 重新对齐，防止 DB 已落最终回复而界面仍空。
      initData().catch((e: any) => console.warn('[finally] resync failed', e?.message));
    }
  };

  // 删除消息
  const handleDelete = async (msg: Message, setMessagesLocal: typeof setMessages): Promise<void> => {
    const msgIndex = messages.findIndex(m => m.id === msg.id);
    if (msgIndex === -1) return;
    setMessagesLocal(prev => prev.slice(0, msgIndex));
    try {
      await fetch(`http://localhost:3001/api/v1/chats/${chatId}/messages?projectId=${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMessageId: msg.id }),
      });
    } catch (err) {
      console.error("[Delete] 持久化失败", err);
    }
  };

  // 停止生成
  const handleStop = async (): Promise<void> => {
    if (!chatId) return;
    try {
      await fetch(`http://localhost:3001/api/v1/chats/${chatId}/stop`, { method: "POST" });
      setIsTyping(false);
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  // 导出对话
  const downloadChat = (): void => {
    const title = chat?.title || "对话记录";
    let md = `# ${title}\n\n> 导出时间: ${new Date().toLocaleString("zh-CN")}\n\n---\n\n`;
    for (const m of messages) {
      if (m.role === "tool") {
        md += `### 🔧 [${m.toolName || "工具"}] 执行结果\n\n${m.content}\n\n---\n\n`;
      } else {
        md += `## ${m.role === "user" ? "👤 用户" : "🤖 助手"}\n\n${m.content}\n\n---\n\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9一-龥]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 清空历史
  const handleClearHistory = async (setMessagesLocal: typeof setMessages): Promise<void> => {
    if (!window.confirm("确定要清空所有对话历史吗？此操作不可恢复。")) return;
    setMessagesLocal([]);
    try {
      await fetch(`http://localhost:3001/api/v1/chats/${chatId}?projectId=${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      });
    } catch (err) {
      console.error("[ClearHistory] 失败", err);
    }
  };

  // 更新聊天
  const handleUpdateChat = async (updates: any): Promise<void> => {
    try {
      const res = await fetch(`http://localhost:3001/api/v1/chats/${chatId}?projectId=${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) setChat(await res.json());
    } catch (err) {}
  };

  return {
    handleSend,
    handleResend,
    handleDelete,
    handleStop,
    downloadChat,
    handleClearHistory,
    handleUpdateChat,
  };
}
