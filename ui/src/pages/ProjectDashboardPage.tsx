import { Bot, FolderOpen, MessageSquare, Plus, Cpu, Sparkles, Search, Trash2, X, Calendar, Clock, ChevronRight, Zap, Users, Settings, Star } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button } from '../components/ui';
import { useProject } from '../contexts/ProjectContext';

export function ProjectDashboardPage({ projectId, onOpenChat, onProjectUpdated }: { projectId: string; onOpenChat?: (chatId: string) => void; onProjectUpdated?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [projectAgents, setProjectAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'agents'>('chats');

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
    const res = await fetch(`http://localhost:3001/api/v1/chats/${id}`, { method: 'DELETE' });
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse shadow-xl shadow-indigo-200">
            <MessageSquare className="h-8 w-8 text-white" />
          </div>
          <p className="text-slate-500 font-medium">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30">
      {/* 顶部 Hero 区域 */}
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white">
        <div className="max-w-6xl mx-auto px-8 py-10">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-lg">
                  <FolderOpen className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-2xl font-black">{project?.name}</h1>
                  <p className="text-white/70 text-sm">{project?.description || '暂无描述'}</p>
                </div>
              </div>
              
              {/* 快捷信息 */}
              <div className="flex flex-wrap gap-3 mt-6">
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-xl px-4 py-2">
                  <Cpu className="h-4 w-4 text-amber-300" />
                  <span className="text-sm font-medium">{currentModel?.name || '默认模型'}</span>
                </div>
                {coordinatorAgent && (
                  <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-xl px-4 py-2">
                    <Star className="h-4 w-4 text-yellow-300" />
                    <span className="text-sm font-medium">{coordinatorAgent.name}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-xl px-4 py-2">
                  <Users className="h-4 w-4 text-emerald-300" />
                  <span className="text-sm font-medium">{projectAgents.length} 个成员</span>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={handleCreateChat}
              className="bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white border-0 shadow-lg"
              icon={Plus}
            >
              新建对话
            </Button>
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-6xl mx-auto px-8 py-8">
        {/* 标签页 */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setActiveTab('chats')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'chats'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            对话列表
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'chats' ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {filteredChats.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('agents')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
              activeTab === 'agents'
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            <Bot className="h-4 w-4" />
            团队成员
            <span className={`px-2 py-0.5 rounded-full text-xs ${
              activeTab === 'agents' ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {projectAgents.length}
            </span>
          </button>
        </div>

        {/* 对话列表 */}
        {activeTab === 'chats' && (
          <div className="space-y-4">
            {/* 搜索栏 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  placeholder="搜索对话..."
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100 border border-slate-200 transition-all"
                  value={chatSearchQuery}
                  onChange={e => setChatSearchQuery(e.target.value)}
                />
                {chatSearchQuery && (
                  <button 
                    onClick={() => setChatSearchQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-lg"
                  >
                    <X className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </div>
            </div>

            {/* 对话卡片列表 */}
            {filteredChats.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center shadow-sm border border-slate-100">
                <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <MessageSquare className="h-10 w-10 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-2">
                  {chatSearchQuery ? '未找到匹配的对话' : '还没有对话'}
                </h3>
                <p className="text-sm text-slate-500 mb-6">
                  {chatSearchQuery ? '尝试其他关键词' : '点击上方按钮开始第一个对话'}
                </p>
                {!chatSearchQuery && (
                  <Button onClick={handleCreateChat} className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700" icon={Plus}>
                    新建对话
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredChats.map((chat, idx) => (
                  <button
                    key={chat.id}
                    onClick={() => onOpenChat?.(chat.id)}
                    className="group bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:border-indigo-200 hover:shadow-lg transition-all text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center flex-shrink-0">
                          <MessageSquare className="h-5 w-5 text-indigo-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-slate-800 truncate group-hover:text-indigo-600 transition-colors">
                            {chat.title}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Clock className="h-3 w-3" />
                              {new Date(chat.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {chat.messageCount && (
                              <span className="flex items-center gap-1 text-xs text-slate-400">
                                <Zap className="h-3 w-3" />
                                {chat.messageCount} 条消息
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => handleDeleteChat(e, chat.id)}
                          className="p-2.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center group-hover:from-indigo-500 group-hover:to-purple-600 transition-all">
                          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-white transition-all" />
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 团队成员 */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projectAgents.map((agent) => {
                const isCoordinator = String(agent.id) === String(project?.coordinatorAgentId);
                return (
                  <div 
                    key={agent.id}
                    className={`bg-white rounded-2xl p-6 shadow-sm border transition-all ${
                      isCoordinator ? 'border-violet-200 shadow-lg shadow-violet-100' : 'border-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-md ${
                        isCoordinator 
                          ? 'bg-gradient-to-br from-violet-500 to-purple-600' 
                          : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                      }`}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      {isCoordinator && (
                        <span className="px-3 py-1 bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 text-xs font-bold rounded-full flex items-center gap-1">
                          <Star className="h-3 w-3" /> 主协调
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-slate-800 mb-1">{agent.name}</h3>
                    <p className="text-sm text-slate-500 mb-3">{agent.role || '团队成员'}</p>
                    <p className="text-xs text-slate-400 line-clamp-2">{agent.description || '暂无描述'}</p>
                  </div>
                );
              })}
              
              {projectAgents.length === 0 && (
                <div className="col-span-full bg-white rounded-3xl p-16 text-center shadow-sm border border-slate-100">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                    <Users className="h-10 w-10 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">暂无团队成员</h3>
                  <p className="text-sm text-slate-500">在项目设置中添加团队成员</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
