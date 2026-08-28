import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Attachment, Message } from './types';

export interface ChatHooksReturn {
  // State
  project: any;
  models: any[];
  chat: any;
  input: string;
  messages: Message[];
  isTyping: boolean;
  showAgentPicker: boolean;
  showModelPicker: boolean;
  modelSearchQuery: string;
  isEditingTitle: boolean;
  newTitle: string;
  windowState: 'normal' | 'minimized' | 'maximized';
  attachments: Attachment[];
  isRecording: boolean;
  recognition: any;
  voiceInput: string;
  scrollRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;

  // Setters
  setProject: React.Dispatch<React.SetStateAction<any>>;
  setModels: React.Dispatch<React.SetStateAction<any[]>>;
  setChat: React.Dispatch<React.SetStateAction<any>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAgentPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowModelPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setModelSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setIsEditingTitle: React.Dispatch<React.SetStateAction<boolean>>;
  setNewTitle: React.Dispatch<React.SetStateAction<string>>;
  setWindowState: React.Dispatch<React.SetStateAction<'normal' | 'minimized' | 'maximized'>>;
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  setIsRecording: React.Dispatch<React.SetStateAction<boolean>>;
  setRecognition: React.Dispatch<React.SetStateAction<any>>;
  setVoiceInput: React.Dispatch<React.SetStateAction<string>>;
  setVoiceInputLocal: React.Dispatch<React.SetStateAction<string>>;
  // Derived
  filteredModels: any[];
  currentAgent: any;
  activeModelId: string | undefined;
  currentModel: any;
  canSend: boolean;
  windowClasses: string;

  // Callbacks
  initVoiceRecognition: () => void;
  initPasteListener: () => void;
  initData: () => Promise<void>;
  addFileAsAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  toggleVoice: () => void;
  handleUpdateTitle: () => void;
  handleSwitchModel: (modelId: string) => void;
  buildUserContent: () => string;
}

export function useChatHooks(
  chatId: string,
  projectId: string,
  projectAgents: Array<{ id: string; name: string; role?: string; description?: string }>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>,
  setInput: React.Dispatch<React.SetStateAction<string>>,
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  setVoiceInput: React.Dispatch<React.SetStateAction<string>>,
): ChatHooksReturn {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [chat, setChat] = useState<any>(null);
  const [input, setInputLocal] = useState('');
  const [messages, setMessagesLocal] = useState<Message[]>([]);
  const [isTyping, setIsTypingLocal] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [windowState, setWindowState] = useState<'normal' | 'minimized' | 'maximized'>('normal');
  const [attachments, setAttachmentsLocal] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [voiceInput, setVoiceInputLocal] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Expose setters with correct dispatcher types
  const setInputWrapped = useCallback((val: string | ((prev: string) => string)) => {
    setInputLocal(val as any);
    setInput(val as any);
  }, [setInput]);

  const setAttachmentsWrapped = useCallback((val: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
    setAttachmentsLocal(val as any);
    setAttachments(val as any);
  }, [setAttachments]);

  const setVoiceInputWrapped = useCallback((val: string | ((prev: string) => string)) => {
    setVoiceInputLocal(val as any);
    setVoiceInput(val as any);
  }, [setVoiceInput]);

  // 语音识别初始化
  const initVoiceRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'zh-CN';
      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setVoiceInputLocal(transcript);
      };
      rec.onend = () => {
        setIsRecording(false);
        setVoiceInputLocal((prevVoice: string) => {
          const text = prevVoice.trim();
          if (text) {
            setInputLocal((prevInput: string) => {
              const cleaned = prevInput.trim();
              return cleaned ? `${cleaned} ${text}` : text;
            });
          }
          return '';
        });
      };
      setRecognition(rec);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initVoiceRecognition();
  }, [initVoiceRecognition]);

  // 粘贴监听
  const initPasteListener = useCallback(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) addFileAsAttachmentInternal(file);
          return;
        }
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          addFileAsAttachmentInternal(file);
        }
      }
    };
    document.addEventListener('paste', handlePaste as any);
    return () => document.removeEventListener('paste', handlePaste as any);
  }, []);

  useEffect(() => {
    return initPasteListener();
  }, [initPasteListener]);

  const addFileAsAttachmentInternal = useCallback((file: File) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setAttachmentsLocal(prev => [...prev, {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
        file,
      }]);
    };
    reader.readAsDataURL(file);
    textareaRef.current?.focus();
  }, []);

  const addFileAsAttachment = useCallback((file: File) => {
    addFileAsAttachmentInternal(file);
  }, [addFileAsAttachmentInternal]);

  const removeAttachment = useCallback((id: string) => {
    setAttachmentsLocal(prev => prev.filter(a => a.id !== id));
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, [setAttachments]);

  const toggleVoice = useCallback(() => {
    if (!recognition) {
      alert('当前浏览器不支持语音输入，建议使用 Chrome');
      return;
    }
    if (isRecording) {
      recognition.stop();
    } else {
      setVoiceInputLocal('');
      recognition.start();
      setIsRecording(true);
    }
  }, [recognition, isRecording]);

  // 数据初始化
  const initData = useCallback(async () => {
    try {
      const [pRes, mRes, cRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/models`),
        fetch(`http://localhost:3001/api/v1/chats/${chatId}?projectId=${projectId}`),
      ]);
      const pData = await pRes.json();
      const mData = await mRes.json();
      const cData = await cRes.json();
      setProject(pData);
      setModels(mData);
      setChat(cData);
      setNewTitle(cData.title);
      setMessagesLocal((cData.messages || []).map((m: any) => {
        let content = m.content;
        if (m.role === 'tool' && typeof content === 'string' && content.startsWith('{')) {
          try {
            const parsed = JSON.parse(content);
            const lines: string[] = [];
            if (parsed.error) lines.push(`❌ 错误: ${parsed.error}`);
            if (parsed.message) lines.push(parsed.message);
            if (parsed.stdout) lines.push('```\n' + String(parsed.stdout).trim() + '\n```');
            if (parsed.stderr && parsed.stderr.trim()) lines.push('```\n' + String(parsed.stderr).trim() + '\n```');
            if (parsed.path) lines.push(`📁 ${parsed.path}`);
            if (lines.length > 0) content = lines.join('\n');
          } catch {}
        }
        if (m.role === 'tool' && m.tool_call_id && !m.toolName) {
          const idx = (cData.messages || []).indexOf(m);
          for (let i = idx - 1; i >= 0; i--) {
            const prev = cData.messages[i];
            if (prev.role === 'assistant' && prev.tool_calls) {
              const tc = prev.tool_calls.find((t: any) => t.id === m.tool_call_id);
              if (tc) {
                return { ...m, content, toolName: tc.function?.name, toolCallId: m.tool_call_id };
              }
            }
          }
          return { ...m, content, toolCallId: m.tool_call_id };
        }
        return { ...m, content };
      }).filter((m: any) => !(m.role === 'assistant' && !m.content?.trim() && m.tool_calls?.length)));
    } catch (err) { console.error(err); }
  }, [projectId, chatId]);

  useEffect(() => {
    initData();
  }, [initData]);

  // 修复：检测正在进行的流式响应（2026-07-17）
  // 当用户关闭对话框后重新打开，如果后端流还在跑，
  // 需要设置 isTyping=true 让 stop 按钮可用，并轮询获取新消息
  //
  // 🛡️ Stale 兜底（2026-07-20）：仅靠 `data.streaming === false` 停止不可靠 ——
  // 后端 SSE 控制器可能卡在 await（模型 429 反复重试等）导致 session.status
  // 永远停在 'streaming'，前端会无限轮询。这里同时用 lastActivity 兜底：
  // 流式状态超过 STREAMING_STALE_MS 无活动，视为卡死并停止轮询。
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    let stopped = false; // 标记是否已停止轮询

    // 与后端 /status 的 STREAMING_STALE_MS 保持一致（5 分钟）
    const STREAMING_STALE_MS = 5 * 60 * 1000;

    async function checkStreaming() {
      if (cancelled || stopped) return;
      try {
        const res = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/status`);
        const data = await res.json();
        if (cancelled || stopped) return;

        // 会话不存在 = 后端没有正在进行的流式生成（重启清空内存 / 用户从未发消息 /
        // 或后端 stale 自愈已清理 session）。无需继续轮询，直接停止。
        // 注意：之前这里只 `return` 跳过本轮但不设 stopped，导致 setInterval 永不停止、
        // 对话框打开时持续每 3 秒空轮询 /status。
        if (!data.exists) {
          stopped = true;
          return;
        }

        // 后端已识别 stale（sself-heal）或前端基于 lastActivity 判断卡死 —— 停止轮询
        const lastActivity = Number(data.lastActivity) || 0;
        const stale = data.stale === true ||
          (data.streaming === true && lastActivity > 0 &&
           Date.now() - lastActivity > STREAMING_STALE_MS);

        if (stale) {
          console.warn('[ChatHooks] streaming session stale, stop polling');
          setIsTypingLocal(false);
          stopped = true;
        } else if (data.streaming) {
          // 后端流还在跑 — 设置 isTyping=true，stop 按钮可用
          setIsTypingLocal(true);
          // 重新拉取最新数据库消息（可能已有新 chunk 落地）
          await initData();
          // 继续轮询
        } else {
          // 流已结束，停止轮询
          stopped = true;
        }
      } catch (err) {
        console.warn('[ChatHooks] streaming check failed:', err);
      }
    }

    checkStreaming();
    // 每 3 秒轮询一次，直到流结束或组件卸载
    const timer = setInterval(checkStreaming, 3000);

    return () => {
      cancelled = true;
      stopped = true;
      clearInterval(timer);
    };
  }, [chatId, initData]);

  // 模型过滤
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery) return models;
    const query = modelSearchQuery.toLowerCase();
    return models.filter(m =>
      (m.name || '').toLowerCase().includes(query) ||
      (m.modelId || '').toLowerCase().includes(query)
    );
  }, [models, modelSearchQuery]);

  // 当前 agent / model
  const currentAgent = useMemo(() => {
    return projectAgents.find((a: any) => a.id === chat?.agentId) || projectAgents[0];
  }, [projectAgents, chat?.agentId]);

  const activeModelId = chat?.modelId || project?.defaultModel;
  const currentModel = useMemo(() => {
    return models.find(m => m.id === activeModelId) || models[0];
  }, [models, activeModelId]);

  // 窗口样式
  const windowClasses = useMemo(() => {
    switch (windowState) {
      case 'maximized': return 'fixed inset-0 z-[9999] rounded-none shadow-none';
      case 'minimized': return 'fixed bottom-6 right-6 z-[9999] h-16 w-80 rounded-2xl shadow-2xl';
      default: return 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[85vw] max-w-5xl h-[85vh] rounded-3xl shadow-2xl';
    }
  }, [windowState]);

  const canSend: boolean = !isTyping && (Boolean(input.trim()) || attachments.length > 0 || Boolean(voiceInput.trim()));

  // 标题更新
  const handleUpdateTitle = useCallback(() => {
    if (!newTitle.trim()) return setIsEditingTitle(false);
    // Caller handles the actual update via handleUpdateChat (passed separately)
    setIsEditingTitle(false);
  }, [newTitle]);

  // 模型切换
  const handleSwitchModel = useCallback((modelId: string) => {
    // Caller handles the actual update via handleUpdateChat (passed separately)
    setShowModelPicker(false);
    setModelSearchQuery('');
  }, []);

  // buildUserContent 也在这里暴露出来
  const buildUserContent = useCallback((): string => {
    let text = input.trim();
    const voiceText = voiceInput.trim();
    if (voiceText) text = text ? `${text} ${voiceText}` : voiceText;
    if (attachments.length > 0) {
      const attNames = attachments.map(a => `📎 ${a.name}`).join('\n');
      text = text ? `${text}\n\n${attNames}` : attNames;
    }
    return text;
  }, [input, voiceInput, attachments]);

  return {
    project, models, chat, input, messages, isTyping,
    showAgentPicker, showModelPicker, modelSearchQuery,
    isEditingTitle, newTitle, windowState, attachments,
    isRecording, recognition, voiceInput,
    scrollRef, fileInputRef, textareaRef,
    setProject, setModels, setChat, setInput: setInputLocal,
    setMessages: setMessagesLocal, setIsTyping: setIsTypingLocal,
    setShowAgentPicker, setShowModelPicker, setModelSearchQuery,
    setIsEditingTitle, setNewTitle, setWindowState,
    setAttachments: setAttachmentsLocal, setIsRecording,
    setRecognition, setVoiceInput: setVoiceInputLocal, setVoiceInputLocal,
    filteredModels, currentAgent, activeModelId, currentModel,
    canSend, windowClasses,
    initVoiceRecognition, initPasteListener, initData,
    addFileAsAttachment, removeAttachment, toggleVoice,
    handleUpdateTitle, handleSwitchModel, buildUserContent,
  };
}
