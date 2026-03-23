import { Bot, SendHorizonal, Sparkles, ChevronDown, Check, User, Cpu, Edit3, Settings, Search, X } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'streaming' | 'error';
};

export function ChatDetailPage({ projectId, chatId }: { projectId: string, chatId: string }) {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [chat, setChat] = useState<any>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      try {
        const [pRes, aRes, mRes, cRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`),
          fetch(`http://localhost:3001/api/v1/models`),
          fetch(`http://localhost:3001/api/v1/chats/${chatId}`)
        ]);
        const pData = await pRes.json();
        const aData = await aRes.json();
        const mData = await mRes.json();
        const cData = await cRes.json();

        setProject(pData);
        setAgents(aData);
        setModels(mData);
        setChat(cData);
        setNewTitle(cData.title);
        setMessages(cData.messages || []);
      } catch (err) { console.error("Failed to load chat context", err); }
    }
    init();
  }, [projectId, chatId]);

  useEffect(() => {
    if (scrollRef.current) { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }
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
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setChat(updated);
      }
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    const userMsg: Message = { id: userMsgId, role: 'user', content: text };
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', status: 'streaming' };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const response = await fetch(`http://localhost:3001/api/v1/chats/${chatId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });

      if (!response.body) throw new Error('网络连接异常');

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
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

  const currentAgent = agents.find(a => a.id === chat?.agentId) || agents[0];
  const activeModelId = chat?.modelId || project?.defaultModel;
  const currentModel = models.find(m => m.id === activeModelId) || models[0];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] relative bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between py-4 px-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-primary-600 p-3 shadow-lg shadow-primary-100"><Bot className="h-6 w-6 text-white" /></div>
          <div className="group relative">
            {isEditingTitle ? (
              <input autoFocus className="text-lg font-black text-slate-900 leading-none bg-white border border-primary-300 rounded-lg px-2 py-1 outline-none shadow-sm shadow-primary-50" value={newTitle} onChange={e => setNewTitle(e.target.value)} onBlur={handleUpdateTitle} onKeyDown={e => e.key === 'Enter' && handleUpdateTitle()} />
            ) : (
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsEditingTitle(true)}>
                <h1 className="text-lg font-black text-slate-900 leading-none group-hover:text-primary-700 transition-colors">{chat?.title || '正在加载...'}</h1>
                <Edit3 className="h-3.5 w-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Badge status="info" className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">{project?.name || 'Project'}</Badge>
              <div 
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white border border-slate-100 shadow-sm cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-all group/model"
                onClick={() => { setShowModelPicker(!showModelPicker); setShowAgentPicker(false); }}
              >
                <Cpu className="h-3 w-3 text-amber-500" /><span className="text-[9px] font-black text-slate-600 uppercase tracking-wider">{currentModel?.name || 'Default Model'}</span>
              </div>
              <Badge status="success" className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider cursor-pointer hover:opacity-80" onClick={() => { setShowAgentPicker(!showAgentPicker); setShowModelPicker(false); }}>{currentAgent?.name}</Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" size="sm" onClick={() => { setShowModelPicker(!showModelPicker); setShowAgentPicker(false); }} icon={Settings}>切换模型</Button>
           <Button variant="outline" size="sm" onClick={() => { setShowAgentPicker(!showAgentPicker); setShowModelPicker(false); }} icon={ChevronDown}>{currentAgent?.name}</Button>
        </div>
      </div>

      {showAgentPicker && (
        <Card className="absolute top-20 right-6 z-50 w-64 shadow-3xl border-primary-100 p-2 animate-in fade-in slide-in-from-top-2 rounded-2xl">
           <div className="space-y-1">
             {agents.map(agent => (
               <button key={agent.id} onClick={() => { handleUpdateChat({ agentId: agent.id }); setShowAgentPicker(false); }} className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all ${chat?.agentId === agent.id ? 'bg-primary-50 text-primary-700 font-bold' : 'hover:bg-slate-50 text-slate-500 font-bold'}`}><span className="text-xs uppercase tracking-widest">{agent.name}</span>{chat?.agentId === agent.id && <Check className="h-4 w-4" />}</button>
             ))}
           </div>
        </Card>
      )}

      {showModelPicker && (
        <Card className="absolute top-20 right-48 z-50 w-72 shadow-3xl border-amber-100 p-2 animate-in fade-in slide-in-from-top-2 rounded-2xl">
          <div className="p-3 mb-2 border-b border-slate-50 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">会话模型切换</p>
              <button onClick={() => setShowModelPicker(false)} className="text-slate-400 hover:text-slate-600"><X className="h-3 w-3" /></button>
            </div>
            <div className="relative group/search">
              <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 transition-colors ${modelSearchQuery ? 'text-amber-500' : 'text-slate-400'}`} />
              <input 
                autoFocus
                placeholder="搜索模型名称或 ID..." 
                className="pl-8 pr-3 py-2 w-full bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-black uppercase outline-none focus:border-amber-400 focus:bg-white transition-all shadow-inner"
                value={modelSearchQuery}
                onChange={e => setModelSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {filteredModels.map(m => (
               <button key={m.id} onClick={() => handleSwitchModel(m.id)} className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all ${activeModelId === m.id ? 'bg-amber-50 text-amber-700 font-bold border border-amber-100 shadow-sm' : 'hover:bg-slate-50 text-slate-500 font-bold border border-transparent'}`}>
                 <div className="min-w-0 flex-1"><p className="text-xs uppercase tracking-widest truncate">{m.name}</p><p className="text-[9px] opacity-40 truncate font-mono mt-0.5">{m.modelId}</p></div>
                 {activeModelId === m.id && <Check className="h-4 w-4 flex-shrink-0" />}
               </button>
            ))}
            {filteredModels.length === 0 && <div className="p-10 text-center text-slate-300 text-[10px] font-black uppercase italic tracking-widest">无匹配模型</div>}
          </div>
        </Card>
      )}

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-8 px-8 py-10 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 italic"><Sparkles className="h-16 w-16 mb-6 opacity-20" /><p className="text-xs font-black uppercase tracking-[0.2em] opacity-50 text-slate-400">准备就绪，请发送你的指令</p></div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              <div className={`flex gap-4 max-w-[85%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm border ${m.role === 'user' ? 'bg-white border-slate-100 text-slate-400' : 'bg-primary-50 border-primary-100 text-primary-600'}`}>{m.role === 'user' ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}</div>
                <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-5 py-4 rounded-3xl text-sm leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-primary-600 text-white rounded-tr-none shadow-primary-200' : (m.status === 'error' ? 'bg-rose-50 border border-rose-100 text-rose-700 font-medium' : 'bg-white border border-slate-100 text-slate-700 font-medium rounded-tl-none')}`}><div className="whitespace-pre-wrap">{m.content}{m.status === 'streaming' && <span className="inline-block w-1.5 h-4 ml-1 bg-primary-400 animate-pulse align-middle" />}</div></div>
                  <span className="mt-2 text-[9px] font-black text-slate-400 uppercase tracking-widest px-2">{m.role === 'user' ? 'You' : (currentAgent?.name || 'Assistant')}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-slate-50/50 border-t border-slate-100">
        <div className="relative group max-w-4xl mx-auto">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())} placeholder={isTyping ? "正在等待 AI 回应..." : "描述你的任务，按 Enter 键提交..."} disabled={isTyping} className="w-full bg-white border border-slate-200 rounded-3xl px-6 py-5 text-sm font-medium min-h-[120px] shadow-sm outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50 transition-all resize-none disabled:bg-slate-50" />
          <div className="absolute right-4 bottom-4"><Button onClick={handleSend} disabled={isTyping || !input.trim()} className={`h-12 w-12 p-0 rounded-2xl shadow-xl transition-all ${isTyping ? 'opacity-50' : 'hover:scale-105 active:scale-95 shadow-primary-200'}`} icon={SendHorizonal} /></div>
        </div>
      </div>
    </div>
  );
}
