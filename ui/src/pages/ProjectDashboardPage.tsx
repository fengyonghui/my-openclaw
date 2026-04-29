import { Bot, FolderOpen, MessageSquare, Plus, Cpu, Sparkles, Search, Trash2, X, Calendar, Clock, ChevronRight, Zap, Users, Settings, Star, GitBranch, ArrowRight, Activity, Layers } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button } from '../components/ui';
import { useProject } from '../contexts/ProjectContext';
import { RuntimeStatusPanel } from '../components/runtime/RuntimeStatusPanel';

export function ProjectDashboardPage({ projectId, onOpenChat, onProjectUpdated }: { projectId: string; onOpenChat?: (chatId: string) => void; onProjectUpdated?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [projectAgents, setProjectAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  const { agents } = useProject();

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [projRes, chatRes, modelRes, agentRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/chats`),
          fetch(`http://localhost:3001/api/v1/models`),
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`)
        ]);
        setProject(await projRes.json());
        setChats(await chatRes.json());
        setModels(await modelRes.json());
        setProjectAgents(await agentRes.json());
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchData();
    setTimeout(() => setMounted(true), 100);
  }, [projectId]);

  const currentModel = useMemo(() => {
    return models.find(m => m.id === project?.defaultModel);
  }, [models, project]);

  const coordinatorAgent = useMemo(() => {
    return projectAgents.find(a => String(a.id) === String(project?.coordinatorAgentId));
  }, [projectAgents, project]);

  const filteredChats = useMemo(() => {
    return chats.filter(chat => 
      chat.title.toLowerCase().includes(chatSearchQuery.toLowerCase())
    );
  }, [chats, chatSearchQuery]);

  const recentChats = useMemo(() => {
    return [...filteredChats].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [filteredChats]);

  const handleSwitchModel = async (modelId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: modelId })
    });
    if (res.ok) {
      setProject(await res.json());
      onProjectUpdated?.();
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除该会话吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/chats/${id}?projectId=${projectId}`, { method: 'DELETE' });
    if (res.ok) {
      setChats(prev => prev.filter(c => String(c.id) !== String(id)));
    }
  };

  const handleCreateChat = async () => {
    const res = await fetch('http://localhost:3001/api/v1/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title: '新对话' })
    });
    const newChat = await res.json();
    onOpenChat?.(newChat.id);
  };

  if (loading) {
    return (
      <div className="relative min-h-screen w-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />
        <div className="absolute inset-0">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute h-px bg-gradient-to-r from-transparent via-indigo-200/40 to-transparent"
              style={{ top: `${15 + i * 15}%`, animation: `scanline 3s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
        <div className="relative flex items-center justify-center h-[70vh]">
          <div className="text-center space-y-4">
            <div className="relative w-20 h-20 mx-auto">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse opacity-20" />
              <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-indigo-500/20 flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-indigo-500 animate-bounce" />
              </div>
            </div>
            <p className="text-sm font-medium text-slate-500 tracking-wide">加载项目数据中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden pb-20">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40" />
      <div className="absolute inset-0 opacity-[0.015]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #1e1b4b 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-gradient-to-br from-indigo-100/60 via-purple-100/40 to-pink-100/30 blur-3xl transform -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-cyan-100/40 to-blue-100/20 blur-3xl transform translate-x-1/3 translate-y-1/3" />
      <div className="absolute top-1/3 left-0 w-[300px] h-[300px] rounded-full bg-gradient-to-br from-amber-100/30 to-orange-100/20 blur-3xl transform -translate-x-1/2" />

      {/* Hero Section */}
      <div className={`relative pt-12 px-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          {/* Project Header */}
          <div className="relative mb-10">
            {/* Decorative Element */}
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br from-indigo-200/30 to-purple-200/20 rounded-full blur-2xl" />
            
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-5">
                <div className="relative">
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 blur-lg opacity-30 animate-pulse" />
                  <div className="relative w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                    <FolderOpen className="h-8 w-8 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-4xl font-black text-slate-900 tracking-tight">
                    {project?.name}
                  </h1>
                  <p className="text-base text-slate-500 mt-1 max-w-lg">
                    {project?.description || '一个智能协作项目空间'}
                  </p>
                </div>
              </div>
              
              <button
                onClick={handleCreateChat}
                className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_100%] text-white font-bold text-sm shadow-xl shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/40 transition-all duration-500 hover:-translate-y-1 active:translate-y-0 animate-gradient"
              >
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-700 via-purple-700 to-indigo-700 opacity-0 group-hover:opacity-100 transition-opacity bg-[length:200%_100%]" />
                <div className="relative flex items-center gap-3">
                  <Plus className="w-5 h-5" />
                  新建对话
                  <ArrowRight className="w-4 h-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </div>
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <div className="group relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
              <div className="relative p-5 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-900">{chats.length}</p>
                    <p className="text-xs font-medium text-slate-500">对话总数</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="group relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
              <div className="relative p-5 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-black text-slate-900">{projectAgents.length}</p>
                    <p className="text-xs font-medium text-slate-500">团队成员</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="group relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
              <div className="relative p-5 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-900 truncate max-w-[120px]">{currentModel?.name || '默认'}</p>
                    <p className="text-xs font-medium text-slate-500">当前模型</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="group relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500" />
              <div className="relative p-5 rounded-2xl bg-white/80 backdrop-blur-sm border border-white/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-lg">
                    <Star className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-900 truncate max-w-[120px]">{coordinatorAgent?.name || '未设置'}</p>
                    <p className="text-xs font-medium text-slate-500">主协调</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity Banner */}
          {recentChats.length > 0 && (
            <div className="relative mb-10 overflow-hidden rounded-2xl">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_100%] animate-gradient" />
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/90 to-purple-600/90" />
              <div className="relative px-8 py-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm">
                    <Activity className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-bold text-lg">最近对话</p>
                    <p className="text-white/70 text-sm">
                      {recentChats[0]?.title} · {new Date(recentChats[0]?.updatedAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onOpenChat?.(recentChats[0]?.id)}
                  className="px-6 py-3 rounded-xl bg-white/20 backdrop-blur-sm text-white font-bold text-sm hover:bg-white/30 transition-all flex items-center gap-2"
                >
                  继续对话
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Phase 4: Runtime Status Panel */}
          <div className="mb-10">
            <RuntimeStatusPanel projectId={projectId} projectName={project?.name} />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`relative px-8 max-w-7xl mx-auto transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        
        {/* Search Section */}
        <div className="relative mb-8">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-500 blur-xl" />
          <div className="relative flex items-center bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/50 shadow-lg">
            <Search className="w-5 h-5 text-slate-400 ml-5" />
            <input
              placeholder="搜索对话..."
              className="flex-1 px-5 py-4 bg-transparent text-base font-medium text-slate-700 outline-none placeholder:text-slate-400"
              value={chatSearchQuery}
              onChange={e => setChatSearchQuery(e.target.value)}
            />
            {chatSearchQuery && (
              <button 
                onClick={() => setChatSearchQuery('')}
                className="mr-4 p-2 hover:bg-slate-100 rounded-xl transition"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            )}
          </div>
        </div>

        {/* Chat List */}
        {recentChats.length === 0 ? (
          <div className="text-center py-24 rounded-3xl bg-gradient-to-br from-slate-50/80 to-white border border-slate-200/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-100/30 to-purple-100/20 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
            <div className="relative">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100" />
                <div className="absolute inset-0 rounded-3xl bg-white shadow-lg flex items-center justify-center">
                  <MessageSquare className="w-12 h-12 text-slate-300" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-600 mb-2">
                {chatSearchQuery ? '未找到匹配的对话' : '还没有对话'}
              </h3>
              <p className="text-slate-500 mb-8 max-w-md mx-auto">
                {chatSearchQuery ? '尝试其他关键词' : '开始你的第一次智能对话之旅'}
              </p>
              {!chatSearchQuery && (
                <button
                  onClick={handleCreateChat}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5" />
                  创建第一个对话
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {recentChats.map((chat, idx) => (
              <div
                key={chat.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenChat?.(chat.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChat?.(chat.id); } }}
                className="group w-full text-left cursor-pointer"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="relative p-6 rounded-2xl bg-white/80 backdrop-blur-sm border border-slate-200/50 shadow-sm hover:shadow-xl hover:border-indigo-200/50 transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                  {/* Hover Glow */}
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-5 flex-1 min-w-0">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 blur-lg opacity-0 group-hover:opacity-50 transition-opacity" />
                        <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center group-hover:from-indigo-500 group-hover:to-purple-600 group-hover:shadow-lg transition-all duration-300">
                          <MessageSquare className="h-6 w-6 text-indigo-600 group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-slate-800 group-hover:text-indigo-600 transition-colors truncate">
                          {chat.title}
                        </h3>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="flex items-center gap-1.5 text-sm text-slate-400">
                            <Clock className="h-4 w-4" />
                            {new Date(chat.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {chat.messageCount && (
                            <span className="flex items-center gap-1.5 text-sm text-slate-400">
                              <Zap className="h-4 w-4" />
                              {chat.messageCount} 条消息
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => handleDeleteChat(e, chat.id)}
                        className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center group-hover:from-indigo-500 group-hover:to-purple-600 transition-all duration-300">
                        <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white transition-colors" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agent Team Section */}
        {projectAgents.length > 0 && (
          <div className="mt-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
                <Users className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">团队成员</h2>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold">{projectAgents.length}</span>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projectAgents.map((agent, idx) => {
                const isCoordinator = String(agent.id) === String(project?.coordinatorAgentId);
                const gradient = isCoordinator 
                  ? 'from-violet-500 to-purple-600' 
                  : idx % 3 === 0 
                    ? 'from-cyan-500 to-blue-600'
                    : idx % 3 === 1
                      ? 'from-emerald-500 to-teal-600'
                      : 'from-amber-500 to-orange-600';
                
                return (
                  <div 
                    key={agent.id}
                    className="group relative"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
                    <div className={`relative p-6 rounded-3xl bg-white/80 backdrop-blur-sm border transition-all duration-300 hover:-translate-y-1 overflow-hidden ${
                      isCoordinator ? 'border-violet-200/50 shadow-lg shadow-violet-500/10' : 'border-slate-200/50 shadow-sm'
                    }`}>
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-black text-xl shadow-lg`}>
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        {isCoordinator && (
                          <span className="px-3 py-1.5 rounded-full bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 text-xs font-bold flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5" />
                            主协调
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 mb-1">{agent.name}</h3>
                      <p className="text-sm font-semibold text-slate-500 mb-3">{agent.role || '团队成员'}</p>
                      <p className="text-sm text-slate-400 leading-relaxed line-clamp-2">
                        {agent.description || '暂无描述'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Global Styles */}
      <style>{`
        @keyframes scanline {
          0%, 100% { opacity: 0.3; transform: translateX(-100%); }
          50% { opacity: 0.6; transform: translateX(100%); }
        }
        
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        
        .animate-gradient {
          animation: gradient 8s ease infinite;
        }
      `}</style>
    </div>
  );
}
