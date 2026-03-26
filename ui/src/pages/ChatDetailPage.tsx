import { Bot, SendHorizonal, Sparkles, ChevronDown, Check, User, Cpu, Edit3, Settings, Search, X, Copy, CheckCircle2, Minus, Square, XCircle, GripHorizontal, Mic, MicOff, Paperclip, X as XIcon, Download, FileText, Users, MessageSquare } from 'lucide-react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Card, Button, Badge } from '../components/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProject } from '../contexts/ProjectContext';

type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  file?: File;
};

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'streaming' | 'error';
  attachments?: Attachment[];
  mentions?: string[];
};

// 代码块渲染器
function PreBlock({ children }: any) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.innerText || '';
    navigator.clipboard.writeText(text.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="my-4 rounded-2xl border border-slate-700/50 bg-slate-900 shadow-xl overflow-hidden">
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            copied ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          {copied ? <><CheckCircle2 className="h-3.5 w-3.5" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
        </button>
      </div>
      <pre ref={preRef} className="p-4 pt-2 text-sm leading-relaxed whitespace-pre-wrap break-words max-w-full font-mono">
        <code className="whitespace-pre-wrap break-words text-slate-100">{children}</code>
      </pre>
    </div>
  );
}

// 附件预览项
function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove: (id: string) => void }) {
  const isImage = att.type.startsWith('image/');
  return (
    <div className="group relative inline-flex items-center gap-2 bg-gradient-to-r from-slate-100 to-slate-50 rounded-full pl-3 pr-2 py-1.5 animate-in fade-in slide-in-from-left-1">
      {isImage && att.dataUrl ? (
        <img src={att.dataUrl} alt={att.name} className="h-6 w-6 rounded-full object-cover border border-slate-200" />
      ) : (
        <FileText className="h-3.5 w-3.5 text-indigo-500" />
      )}
      <span className="text-xs font-medium text-slate-600 max-w-[100px] truncate">{att.name}</span>
      <button 
        onClick={() => onRemove(att.id)} 
        className="ml-1 rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-all"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ChatDetailPage({ projectId, chatId, onMinimize }: { projectId: string; chatId: string; onMinimize?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [chat, setChat] = useState<any>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [windowState, setWindowState] = useState<'normal' | 'minimized' | 'maximized'>('normal');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [voiceInput, setVoiceInput] = useState('');

  const { agents: projectAgents } = useProject();

  // 初始化语音识别
  useEffect(() => {
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
        setVoiceInput(transcript);
      };
      rec.onend = () => {
        setIsRecording(false);
        setVoiceInput((prevVoice: string) => {
          const text = prevVoice.trim();
          if (text) {
            setInput((prevInput: string) => {
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

  // 粘贴监听
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) addFileAsAttachment(file);
          return;
        }
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          addFileAsAttachment(file);
        }
      }
    };
    document.addEventListener('paste', handlePaste as any);
    return () => document.removeEventListener('paste', handlePaste as any);
  }, []);

  const addFileAsAttachment = (file: File) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const att: Attachment = { id, name: file.name, type: file.type, size: file.size, file };
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachments(prev => prev.map(a => a.id === id ? { ...a, dataUrl: e.target?.result as string } : a));
      };
      reader.readAsDataURL(file);
    }
    setAttachments(prev => [...prev, att]);
    textareaRef.current?.focus();
  };

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  const toggleVoice = () => {
    if (!recognition) {
      alert('当前浏览器不支持语音输入，建议使用 Chrome');
      return;
    }
    if (isRecording) {
      recognition.stop();
    } else {
      setVoiceInput('');
      recognition.start();
      setIsRecording(true);
    }
  };

  const downloadChat = () => {
    const title = chat?.title || '对话记录';
    let md = `# ${title}\n\n> 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;
    for (const m of messages) {
      md += `## ${m.role === 'user' ? '👤 用户' : '🤖 助手'}\n\n${m.content}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    async function init() {
      try {
        const [pRes, mRes, cRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/models`),
          fetch(`http://localhost:3001/api/v1/chats/${chatId}`),
        ]);
        const pData = await pRes.json();
        const mData = await mRes.json();
        const cData = await cRes.json();
        setProject(pData);
        setModels(mData);
        setChat(cData);
        setNewTitle(cData.title);
        setMessages(cData.messages || []);
      } catch (err) { console.error(err); }
    }
    init();
  }, [projectId, chatId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const filteredModels = useMemo(() => {
    return models.filter(m =>
      m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
      m.modelId.toLowerCase().includes(modelSearchQuery.toLowerCase())
    );
  }, [models, modelSearchQuery]);

  const handleUpdateChat = async (updates: any) => {
    try {
      const res = await fetch(`http://localhost:3001/api/v1/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) setChat(await res.json());
    } catch (err) {}
  };

  const handleUpdateTitle = () => {
    if (!newTitle.trim()) return setIsEditingTitle(false);
    handleUpdateChat({ title: newTitle.trim() });
    setIsEditingTitle(false);
  };

  const handleSwitchModel = (modelId: string) => {
    handleUpdateChat({ modelId });
    setShowModelPicker(false);
    setModelSearchQuery('');
  };

  const buildUserContent = () => {
    let text = input.trim();
    const voiceText = voiceInput.trim();
    if (voiceText) text = text ? `${text} ${voiceText}` : voiceText;
    if (attachments.length > 0) {
      const attNames = attachments.map(a => `📎 ${a.name}`).join('\n');
      text = text ? `${text}\n\n${attNames}` : attNames;
    }
    return text;
  };

  const handleSend = async () => {
    const text = buildUserContent();
    if (!text && attachments.length === 0) return;
    if (isTyping) return;

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    const userAttachments = [...attachments];
    const userMsg: Message = { id: userMsgId, role: 'user', content: text, attachments: userAttachments };
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', status: 'streaming' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setAttachments([]);
    setVoiceInput('');
    setIsTyping(true);

    try {
      const attachmentData = userAttachments.map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        size: att.size,
        dataUrl: att.dataUrl
      }));

      const response = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, attachments: attachmentData }),
      });

      if (!response.body) throw new Error('网络连接异常');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let partialLine = '';
      let fullContent = '';

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
              fullContent += data.chunk;
              setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: fullContent } : m));
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `错误: ${err.message}`, status: 'error' } : m));
    } finally {
      setIsTyping(false);
      setMessages(prev => prev.map(m => m.id === assistantMsgId && m.status !== 'error' ? { ...m, status: undefined } : m));
    }
  };

  const currentAgent = projectAgents.find((a: any) => a.id === chat?.agentId) || projectAgents[0];
  const activeModelId = chat?.modelId || project?.defaultModel;
  const currentModel = models.find(m => m.id === activeModelId) || models[0];

  const windowClasses = useMemo(() => {
    switch (windowState) {
      case 'maximized': return 'fixed inset-0 z-[9999] rounded-none shadow-none';
      case 'minimized': return 'fixed bottom-6 right-6 z-[9999] h-16 w-80 rounded-2xl shadow-2xl';
      default: return 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[85vw] max-w-5xl h-[85vh] rounded-3xl shadow-2xl';
    }
  }, [windowState]);

  const canSend = !isTyping && (input.trim() || attachments.length > 0 || voiceInput.trim());

  const renderContent = () => (
    <div className={`flex flex-col bg-gradient-to-b from-white to-slate-50 overflow-hidden transition-all duration-300 ${windowClasses}`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between flex-shrink-0 bg-white border-b border-slate-100">
        <div className="flex items-center gap-4 flex-1 px-6 py-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <input 
                autoFocus 
                className="text-base font-bold text-slate-800 bg-white border border-indigo-300 rounded-xl px-3 py-1.5 outline-none shadow-sm w-full max-w-xs"
                value={newTitle} 
                onChange={e => setNewTitle(e.target.value)} 
                onBlur={handleUpdateTitle} 
                onKeyDown={e => e.key === 'Enter' && handleUpdateTitle()} 
              />
            ) : (
              <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingTitle(true)}>
                <h1 className="text-base font-bold text-slate-800 truncate">{chat?.title || '新对话'}</h1>
                <Edit3 className="h-3.5 w-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
              </div>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full">{project?.name}</span>
              <button 
                onClick={() => { setShowModelPicker(!showModelPicker); setShowAgentPicker(false); }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-400 transition-all"
              >
                <Cpu className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-bold text-amber-600">{currentModel?.name || '模型'}</span>
              </button>
              <button 
                onClick={() => { setShowAgentPicker(!showAgentPicker); setShowModelPicker(false); }}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 hover:border-indigo-400 transition-all"
              >
                <Bot className="h-3 w-3 text-indigo-500" />
                <span className="text-[10px] font-bold text-indigo-600">{currentAgent?.name || 'Agent'}</span>
                <ChevronDown className="h-3 w-3 text-indigo-400" />
              </button>
            </div>
          </div>
        </div>

        {/* 右侧按钮 */}
        <div className="flex items-center gap-2 px-4">
          <button onClick={downloadChat} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors" title="导出对话">
            <Download className="h-5 w-5 text-slate-400" />
          </button>
          <button onClick={() => setWindowState('minimized')} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
            <Minus className="h-5 w-5 text-slate-400" />
          </button>
          {windowState === 'normal' ? (
            <button onClick={() => setWindowState('maximized')} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
              <Square className="h-4 w-4 text-slate-400" />
            </button>
          ) : (
            <button onClick={() => setWindowState('normal')} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="4" width="6" height="6" rx="0.5" />
                <path d="M4 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9" />
              </svg>
            </button>
          )}
          <button onClick={() => { setWindowState('minimized'); onMinimize?.(); }} className="p-2.5 rounded-xl hover:bg-red-50 transition-colors">
            <XCircle className="h-5 w-5 text-slate-400 hover:text-red-500" />
          </button>
        </div>
      </div>

      {/* 最小化状态 */}
      {windowState !== 'minimized' && (
        <>
          {/* Agent 选择器 - 美化版 */}
          {showAgentPicker && (
            <div className="absolute top-24 right-6 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
                {/* 标题栏 */}
                <div className="px-6 py-4 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                        <Bot className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-white font-bold">选择 Agent</p>
                        <p className="text-white/70 text-xs">切换对话助手</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowAgentPicker(false)} 
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>
                </div>
                
                {/* Agent 列表 */}
                <div className="p-3 max-h-80 overflow-y-auto">
                  {projectAgents.map((agent: any, idx: number) => (
                    <button 
                      key={agent.id} 
                      onClick={() => { handleUpdateChat({ agentId: agent.id }); setShowAgentPicker(false); }}
                      className={`w-full text-left p-4 rounded-2xl flex items-center gap-4 transition-all mb-2 ${
                        chat?.agentId === agent.id 
                          ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 shadow-sm' 
                          : 'hover:bg-slate-50 border-2 border-transparent'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                        chat?.agentId === agent.id 
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600' 
                          : 'bg-gradient-to-br from-slate-400 to-slate-500'
                      }`}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800">{agent.name}</p>
                        <p className="text-xs text-slate-500 truncate">{agent.role || agent.description || '团队成员'}</p>
                      </div>
                      {chat?.agentId === agent.id && (
                        <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center shadow-sm">
                          <Check className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                  
                  {projectAgents.length === 0 && (
                    <div className="text-center py-8">
                      <Bot className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                      <p className="text-sm text-slate-400">暂无可用 Agent</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 模型选择器 - 美化版 */}
          {showModelPicker && (
            <div className="absolute top-24 right-6 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
                {/* 标题栏 */}
                <div className="px-6 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                        <Cpu className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-white font-bold">选择模型</p>
                        <p className="text-white/70 text-xs">切换 AI 模型</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setShowModelPicker(false)} 
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>
                  
                  {/* 搜索框 */}
                  <div className="relative mt-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-200" />
                    <input 
                      placeholder="搜索模型名称..."
                      className="w-full pl-10 pr-4 py-3 bg-white/90 backdrop-blur rounded-xl text-sm outline-none border-0 focus:ring-2 focus:ring-white/50 transition-all"
                      value={modelSearchQuery} 
                      onChange={e => setModelSearchQuery(e.target.value)} 
                    />
                  </div>
                </div>
                
                {/* 模型列表 */}
                <div className="p-3 max-h-72 overflow-y-auto">
                  {filteredModels.map(m => (
                    <button 
                      key={m.id} 
                      onClick={() => handleSwitchModel(m.id)}
                      className={`w-full text-left p-4 rounded-2xl flex items-center gap-4 transition-all mb-2 ${
                        activeModelId === m.id 
                          ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 shadow-sm' 
                          : 'hover:bg-slate-50 border-2 border-transparent'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                        activeModelId === m.id 
                          ? 'bg-gradient-to-br from-amber-400 to-orange-500' 
                          : 'bg-gradient-to-br from-slate-200 to-slate-300'
                      }`}>
                        <Cpu className={`h-5 w-5 ${activeModelId === m.id ? 'text-white' : 'text-slate-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-700 truncate">{m.name}</p>
                        <p className="text-[10px] text-slate-400 truncate font-mono">{m.modelId}</p>
                      </div>
                      {activeModelId === m.id && (
                        <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center shadow-sm">
                          <Check className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                  
                  {filteredModels.length === 0 && (
                    <div className="text-center py-8">
                      <Search className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                      <p className="text-sm text-slate-400">未找到匹配的模型</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 消息区域 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-8">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-6 shadow-lg">
                  <MessageSquare className="h-10 w-10 text-indigo-500" />
                </div>
                <h2 className="text-xl font-bold text-slate-700 mb-2">开始新对话</h2>
                <p className="text-sm text-slate-400 text-center max-w-md">
                  支持粘贴图片、拖拽文件、语音输入
                </p>
              </div>
            ) : (
              <div className="space-y-6 max-w-4xl mx-auto">
                {messages.map((m) => (
                  <div key={m.id} className={`flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex gap-4 max-w-[80%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      {/* 头像 */}
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${
                        m.role === 'user' 
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white' 
                          : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500'
                      }`}>
                        {m.role === 'user' ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                      </div>
                      
                      <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                        {/* 用户附件 */}
                        {m.role === 'user' && m.attachments && m.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {m.attachments.map(att => {
                              const isImage = att.type.startsWith('image/');
                              return (
                                <div key={att.id} className="relative">
                                  {isImage ? (
                                    <img src={att.dataUrl || ''} alt={att.name} className="h-20 w-20 rounded-xl object-cover border border-slate-200 shadow-sm" />
                                  ) : (
                                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                                      <FileText className="h-4 w-4 text-indigo-500" />
                                      <span className="text-xs font-medium text-slate-600">{att.name}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {/* 消息气泡 */}
                        <div className={`px-5 py-4 rounded-2xl shadow-sm ${
                          m.role === 'user' 
                            ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-sm' 
                            : m.status === 'error'
                              ? 'bg-red-50 border border-red-100 text-red-700'
                              : 'bg-white border border-slate-100 text-slate-700 rounded-tl-sm'
                        }`}>
                          {m.role === 'assistant' ? (
                            <div className="prose prose-sm max-w-none">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  pre: PreBlock,
                                  code: ({ inline, className, children: codeChildren, ...props }: any) => {
                                    if (className || !inline) return <code className={className} {...props}>{codeChildren}</code>;
                                    return <code className="bg-slate-100 text-indigo-600 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{codeChildren}</code>;
                                  }
                                }}
                              >
                                {m.content || ''}
                              </ReactMarkdown>
                              {m.status === 'streaming' && (
                                <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle rounded-sm" />
                              )}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                          )}
                        </div>
                        
                        {/* 发送者标签 */}
                        <span className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                          {m.role === 'user' ? '你' : (currentAgent?.name || '助手')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 输入区域 */}
          <div className="flex-shrink-0 p-6 bg-white border-t border-slate-100">
            {/* 附件预览 */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4 max-w-4xl mx-auto">
                {attachments.map(att => (
                  <AttachmentChip key={att.id} att={att} onRemove={removeAttachment} />
                ))}
              </div>
            )}
            
            {/* 录音提示 */}
            {isRecording && voiceInput && (
              <div className="mb-4 max-w-4xl mx-auto flex items-center gap-3 bg-gradient-to-r from-red-50 to-rose-50 border border-red-100 rounded-2xl px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                <span className="text-sm text-red-600 font-medium italic flex-1">{voiceInput}</span>
                <button onClick={() => { recognition.stop(); setIsRecording(false); }} className="text-xs text-red-400 hover:text-red-600 font-bold">停止</button>
              </div>
            )}

            <div className="relative max-w-4xl mx-auto">
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    Array.from(e.target.files).forEach(f => addFileAsAttachment(f));
                    e.target.value = '';
                  }
                }} />

              <textarea
                ref={textareaRef}
                value={isRecording ? (input + voiceInput) : input}
                onChange={(e) => {
                  if (isRecording) {
                    setVoiceInput(prev => prev + e.target.value.slice(input.length + voiceInput.length));
                  } else {
                    setInput(e.target.value);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = e.dataTransfer.files;
                  if (files) Array.from(files).forEach(f => addFileAsAttachment(f));
                }}
                onDragOver={(e) => e.preventDefault()}
                placeholder={isTyping ? '正在思考...' : '输入消息，支持图片/文件/语音输入...'}
                disabled={isTyping}
                className="w-full bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200 rounded-3xl px-6 py-5 text-sm shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-50/50 transition-all resize-none disabled:opacity-50"
              />

              {/* 工具栏 */}
              <div className="absolute right-4 bottom-4 flex items-center gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-all">
                  <Paperclip className="h-5 w-5 text-slate-500" />
                </button>
                <button 
                  onClick={toggleVoice}
                  className={`p-2.5 rounded-xl transition-all ${
                    isRecording 
                      ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-200' 
                      : 'bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-500'
                  }`}
                >
                  {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className={`p-3 rounded-2xl shadow-lg transition-all ${
                    canSend 
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 hover:scale-105 active:scale-95 shadow-indigo-200' 
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <SendHorizonal className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (windowState === 'maximized') {
    return createPortal(renderContent(), document.body);
  }
  return renderContent();
}
