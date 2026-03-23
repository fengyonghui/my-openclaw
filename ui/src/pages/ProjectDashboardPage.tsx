import { Activity, Bot, FolderOpen, MessageSquare, Plus, Cpu, Sparkles, Check, Search, ArrowRight, Trash2, X } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function ProjectDashboardPage({ projectId, onOpenChat, onProjectUpdated }: { projectId: string, onOpenChat?: (chatId: string) => void, onProjectUpdated?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModels, setShowModels] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [projRes, chatRes, modelRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/chats`),
          fetch(`http://localhost:3001/api/v1/models`)
        ]);
        setProject(await projRes.json());
        setChats(await chatRes.json());
        setModels(await modelRes.json());
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchData();
  }, [projectId]);

  const currentModelName = useMemo(() => {
    const m = models.find(m => m.id === project?.defaultModel);
    return m ? m.name : (project?.defaultModel || 'None');
  }, [models, project]);

  const filteredModels = useMemo(() => {
    return models.filter(m => 
      (m.name || m.modelId).toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
      m.modelId.toLowerCase().includes(modelSearchQuery.toLowerCase())
    );
  }, [models, modelSearchQuery]);

  const filteredChats = useMemo(() => {
    return chats.filter(chat => 
      chat.title.toLowerCase().includes(chatSearchQuery.toLowerCase())
    );
  }, [chats, chatSearchQuery]);

  const handleSwitchModel = async (modelId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: modelId })
    });
    if (res.ok) {
      const updated = await res.json();
      setProject(updated);
      setShowModels(false);
      onProjectUpdated?.(); // 触发全局状态刷新
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除该会话吗？历史记录将永久丢失。')) return;
    const res = await fetch(`http://localhost:3001/api/v1/chats/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setChats(prev => prev.filter(c => String(c.id) !== String(id)));
    }
  };

  const handleCreateChat = async () => {
    const res = await fetch('http://localhost:3001/api/v1/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        projectId, 
        title: '新开发任务', 
        agentId: project?.defaultAgentId || '1' 
      })
    });
    const newChat = await res.json();
    onOpenChat?.(newChat.id);
  };

  if (loading) return <div className="p-8 text-center text-slate-500 font-medium animate-pulse">加载项目数据中...</div>;

  return (
    <div className="space-y-6">
      <Card hover={false} className="p-8 border-primary-100 bg-gradient-to-br from-white to-primary-50/20 shadow-sm rounded-3xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <Badge status="info" className="px-3 py-1 font-black text-[10px] uppercase tracking-wider">Project Overview</Badge>
            <h1 className="mt-4 text-3xl font-black text-slate-900 tracking-tight">{project?.name}</h1>
            <p className="mt-3 max-w-2xl text-slate-600 leading-7 font-medium">{project?.description}</p>
            <div className="mt-6 flex flex-wrap gap-4">
               <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-100 shadow-sm">
                 <Cpu className="h-3.5 w-3.5 text-amber-500" />
                 <span className="text-xs font-black text-slate-700 uppercase tracking-widest">模型: {currentModelName}</span>
               </div>
               <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-100 shadow-sm">
                 <Bot className="h-3.5 w-3.5 text-primary-600" />
                 <span className="text-xs font-black text-slate-700 uppercase tracking-widest">默认 Agent: PM Agent</span>
               </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleCreateChat} icon={Plus} className="shadow-lg shadow-primary-200 px-6 py-4 rounded-2xl font-black">新建 Chat</Button>
            <Button variant="outline" onClick={() => setShowModels(!showModels)} icon={Sparkles} className="px-6 py-4 rounded-2xl font-black">{showModels ? '收起模型' : '管理模型'}</Button>
          </div>
        </div>
      </Card>

      {showModels && (
        <Card className="p-8 border-primary-100 bg-primary-50/10 shadow-sm rounded-3xl animate-in fade-in slide-in-from-top-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">切换项目默认模型</h2>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><input placeholder="搜索可用模型..." className="pl-9 pr-4 py-2 bg-white border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-primary-400 transition-all w-64 shadow-sm" value={modelSearchQuery} onChange={e => setModelSearchQuery(e.target.value)} /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 max-h-[300px] overflow-y-auto pr-1">
            {filteredModels.map((m) => {
                const isActive = project?.defaultModel === m.id;
                return (
                  <button key={m.id} onClick={() => handleSwitchModel(m.id)} className={`flex flex-col p-5 rounded-3xl border transition-all text-left ${isActive ? 'bg-white border-primary-500 shadow-lg ring-2 ring-primary-100' : 'bg-white border-slate-100 hover:border-primary-200 shadow-sm'}`}>
                    <div className="flex items-center justify-between mb-3"><Badge status={isActive ? 'success' : 'default'} className="scale-75 origin-left">{m.provider}</Badge>{isActive && <Check className="h-4 w-4 text-primary-600" />}</div>
                    <span className="text-sm font-black text-slate-900 truncate">{m.name}</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase mt-1 truncate">{m.modelId}</span>
                  </button>
                );
              })}
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-0 overflow-hidden rounded-3xl border-slate-100 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3"><MessageSquare className="h-4 w-4 text-primary-600" /><h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">最近 Chats</h2></div>
            <div className="flex items-center gap-3">
              <div className="relative group">
                <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 transition-colors ${chatSearchQuery ? 'text-primary-500' : 'text-slate-400'}`} />
                <input 
                   placeholder="搜索会话..." 
                   className="pl-8 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-50 transition-all w-40"
                   value={chatSearchQuery}
                   onChange={e => setChatSearchQuery(e.target.value)}
                />
                {chatSearchQuery && <button onClick={() => setChatSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3 w-3" /></button>}
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white px-2 py-1 rounded-lg border border-slate-100 whitespace-nowrap">{filteredChats.length} 个结果</span>
            </div>
          </div>
          <div className="p-4 space-y-2 max-h-[400px] overflow-y-auto">
            {filteredChats.length === 0 ? <div className="p-12 text-center text-slate-400 text-sm font-bold uppercase italic tracking-widest">无匹配会话</div> : filteredChats.map((chat) => (
                <button key={chat.id} onClick={() => onOpenChat?.(chat.id)} className="w-full text-left p-5 rounded-2xl border border-transparent hover:border-primary-100 hover:bg-primary-50/30 transition-all group flex items-center justify-between relative overflow-hidden">
                    <div className="flex-1 min-w-0 pr-8">
                      <h3 className="text-sm font-black text-slate-900 group-hover:text-primary-700 truncate">{chat.title}</h3>
                      <p className="mt-1 text-[10px] text-slate-400 font-black uppercase tracking-widest">{new Date(chat.updatedAt).toLocaleTimeString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={(e) => handleDeleteChat(e, chat.id)} 
                         className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                       >
                         <Trash2 className="h-4 w-4" />
                       </button>
                       <ArrowRight className="h-4 w-4 text-slate-200 group-hover:text-primary-400 transition-all translate-x-0 group-hover:translate-x-1 flex-shrink-0" />
                    </div>
                </button>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
