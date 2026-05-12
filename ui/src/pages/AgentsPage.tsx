import { Bot, Plus, Trash2, Edit3, Save, X, ShieldCheck, UserCheck, Lock, Unlock, Search, Globe, CheckCircle2, Sparkles, Users, Settings, ChevronRight, Star } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function AgentsPage({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const [allGlobalAgents, setAllGlobalAgents] = useState<any[]>([]);
  const [projectData, setProjectData] = useState<any>(null);
  const [projectPrivateAgents, setProjectPrivateAgents] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPrivate, setShowAddPrivate] = useState(false);
  const [privateAgentForm, setPrivateAgentForm] = useState({ name: '', role: '', description: '', type: 'custom' });
  const [savingPrivate, setSavingPrivate] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [updatingAgentModel, setUpdatingAgentModel] = useState<string | null>(null);
  const [coordinatorAgentId, setCoordinatorAgentId] = useState<string | null>(null);
  const [showCoordinatorModal, setShowCoordinatorModal] = useState(false);

  const fetchData = async () => {
    try {
      const [globalRes, projectRes, privateRes, modelsRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/global`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private`),
        fetch(`http://localhost:3001/api/v1/models`)
      ]);
      const pData = await projectRes.json();
      setAllGlobalAgents(await globalRes.json());
      setProjectData(pData);
      setCoordinatorAgentId(pData.coordinatorAgentId || null);
      setProjectPrivateAgents(await privateRes.json());
      setModels(await modelsRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { 
    fetchData(); 
    setTimeout(() => setMounted(true), 100);
  }, [projectId]);

  const enabledAgentIds = projectData?.enabledAgentIds || [];
  
  const enabledAgents = useMemo(() => {
    const enabled = allGlobalAgents.filter(a => enabledAgentIds.includes(a.id));
    return [...enabled, ...projectPrivateAgents];
  }, [allGlobalAgents, enabledAgentIds, projectPrivateAgents]);

  const filteredGlobalAgents = useMemo(() => {
    return allGlobalAgents.filter(a => 
      (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allGlobalAgents, searchQuery]);

  const toggleGlobalAgent = async (agentId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    if (res.ok) {
      const newEnabledIds = await res.json();
      setProjectData({ ...projectData, enabledAgentIds: newEnabledIds });
      onSaved?.();
    }
  };

  const handleAddPrivateAgent = async () => {
    if (!privateAgentForm.name.trim()) {
      alert('请填写成员名称');
      return;
    }
    setSavingPrivate(true);
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(privateAgentForm)
      });
      if (res.ok) {
        setProjectPrivateAgents(await res.json());
        setShowAddPrivate(false);
        setPrivateAgentForm({ name: '', role: '', description: '', type: 'custom' });
      }
    } catch (err) { alert('添加失败'); }
    setSavingPrivate(false);
  };

  const handleDeletePrivateAgent = async (agentId: string) => {
    if (!confirm('确定要删除此项目私有成员吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private/${agentId}`, {
      method: 'DELETE'
    });
    if (res.ok) setProjectPrivateAgents(await res.json());
  };

  const handleEditPrivateAgent = async () => {
    if (!editingAgent) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private/${editingAgent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingAgent)
    });
    if (res.ok) {
      setProjectPrivateAgents(await res.json());
      setEditingAgent(null);
    }
  };

  const handleAgentModelChange = async (agentId: string, modelId: string) => {
    setUpdatingAgentModel(agentId);
    try {
      const res = await fetch(`http://localhost:3001/api/v1/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModelId: modelId })
      });
      if (res.ok) {
        setAllGlobalAgents(prev => prev.map(a => 
          a.id === agentId ? { ...a, defaultModelId: modelId } : a
        ));
        setProjectPrivateAgents(prev => prev.map(a => 
          a.id === agentId ? { ...a, defaultModelId: modelId } : a
        ));
      }
    } catch (err) {
      console.error('更新模型失败:', err);
    }
    setUpdatingAgentModel(null);
  };

  // 设置主协调成员
  const handleSetCoordinator = async (agentId: string | null) => {
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/coordinator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinatorAgentId: agentId })
      });
      if (res.ok) {
        const updated = await res.json();
        setProjectData(updated);
        setCoordinatorAgentId(updated.coordinatorAgentId || null);
        setShowCoordinatorModal(false);
      }
    } catch (err) { console.error(err); }
  };

  if (loading) return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-cyan-50/30" />
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute h-px bg-gradient-to-r from-transparent via-cyan-200/40 to-transparent"
            style={{ top: `${15 + i * 15}%`, animation: `scanline 3s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </div>
      <div className="relative flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 animate-pulse opacity-20" />
            <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-cyan-500/20 flex items-center justify-center">
              <Bot className="w-8 h-8 text-cyan-500 animate-bounce" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 tracking-wide">加载成员列表中...</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen w-full overflow-hidden pb-20">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-cyan-50/40" />
      <div className="absolute inset-0 opacity-[0.015]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #0f172a 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-cyan-100/50 to-blue-100/30 blur-3xl transform -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-20 right-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-teal-100/40 to-emerald-100/20 blur-3xl transform translate-x-1/2" />
      
      {/* Header */}
      <div className={`relative pt-12 px-8 pb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-50 text-cyan-600 text-xs font-bold tracking-wide">
                <Users className="w-3.5 h-3.5" />
                项目配置
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-cyan-900 to-slate-900 bg-clip-text">
                  成员管理
                </span>
              </h1>
              <p className="text-base text-slate-500 font-medium max-w-xl leading-relaxed">
                团队协作与成员管理：配置项目成员，定义角色职责与工作边界
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
              <button
                onClick={() => setShowAddPrivate(true)}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-bold text-sm shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Lock className="w-4 h-4 relative" />
                <span className="relative">添加私有成员</span>
              </button>
              
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300" />
                <div className="relative flex items-center bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                  <Search className="w-4 h-4 text-slate-400 ml-4" />
                  <input 
                    placeholder="搜索成员..." 
                    className="w-64 px-4 py-3 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Stats Bar */}
          <div className="mt-8 flex flex-wrap gap-4">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">{enabledAgents.length} 个已启用</span>
            </div>
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-sm font-semibold text-slate-700">{allGlobalAgents.length} 个全局成员</span>
            </div>
            {projectPrivateAgents.length > 0 && (
              <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-rose-50 border border-rose-200/60">
                <div className="w-2 h-2 rounded-full bg-rose-500" />
                <span className="text-sm font-semibold text-rose-700">{projectPrivateAgents.length} 个私有成员</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative px-8 max-w-7xl mx-auto">

        {/* 主协调成员 */}
        <section className={`mb-8 transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">主协调成员</h2>
          </div>

          {(() => {
            const allAgents = [...allGlobalAgents, ...projectPrivateAgents];
            const coordinatorAgent = allAgents.find(a => String(a.id) === String(coordinatorAgentId));
            if (coordinatorAgent) {
              return (
                <div className="flex items-center justify-between p-6 bg-gradient-to-r from-violet-50 to-purple-50 rounded-2xl border border-violet-200">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-violet-200">
                      {coordinatorAgent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-lg">{coordinatorAgent.name}</p>
                      <p className="text-sm text-slate-500">{coordinatorAgent.role || coordinatorAgent.description || '主协调者'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCoordinatorModal(true)}
                    className="px-4 py-2 rounded-xl border border-violet-300 text-violet-600 hover:bg-violet-600 hover:text-white text-sm font-bold transition-all"
                  >
                    更换
                  </button>
                </div>
              );
            }
            return (
              <div
                className="flex items-center justify-center p-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 cursor-pointer hover:border-violet-300 hover:bg-violet-50/50 transition-all"
                onClick={() => setShowCoordinatorModal(true)}
              >
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-200 flex items-center justify-center">
                    <Star className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="font-medium text-slate-500">点击设置主协调成员</p>
                  <p className="text-xs text-slate-400 mt-1">协调成员负责接收用户请求并分配任务</p>
                </div>
              </div>
            );
          })()}
        </section>

        {/* 已启用的成员 */}
        {enabledAgents.length > 0 && (
          <section className={`mb-12 transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">已启用的成员</h2>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">{enabledAgents.length}</span>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {enabledAgents.map((agent, idx) => (
                <div 
                  key={agent.id}
                  className="group relative rounded-3xl p-6 bg-gradient-to-br from-emerald-50/80 to-teal-50/40 border border-emerald-200/50 hover:border-emerald-300 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-1"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.isPrivate && (
                        <span className="px-2 py-1 rounded-lg bg-rose-100 text-rose-700 text-[10px] font-bold">私有</span>
                      )}
                      {!agent.isPrivate && (
                        <span className="px-2 py-1 rounded-lg bg-cyan-100 text-cyan-700 text-[10px] font-bold">全局</span>
                      )}
                    </div>
                  </div>
                  
                  <h3 className="text-lg font-bold text-slate-900 mb-1">{agent.name}</h3>
                  <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wider mb-2">{agent.role || 'General'}</p>
                  <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{agent.description}</p>
                  
                  {/* 默认模型选择 */}
                  <div className="mt-4 pt-4 border-t border-emerald-200/50">
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-2">默认模型</label>
                    <select
                      className="w-full px-3 py-2 rounded-xl bg-white border border-emerald-200 text-sm font-medium text-slate-700 outline-none focus:border-emerald-400"
                      value={agent.defaultModelId || ''}
                      onChange={(e) => handleAgentModelChange(agent.id, e.target.value)}
                      disabled={updatingAgentModel === agent.id}
                    >
                      <option value="">跟随项目默认</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                      ))}
                    </select>
                  </div>
                  
                  {agent.isPrivate && (
                    <div className="mt-4 flex items-center gap-2">
                      <button 
                        onClick={() => setEditingAgent(agent)} 
                        className="p-2 rounded-xl text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 transition-colors"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeletePrivateAgent(agent.id)} 
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 全局成员库 */}
        <section className={`transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 shadow-lg shadow-cyan-500/25">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">全局成员库</h2>
            <span className="px-2.5 py-1 rounded-full bg-cyan-100 text-cyan-700 text-xs font-bold">{filteredGlobalAgents.length}</span>
          </div>
          
          {filteredGlobalAgents.length === 0 ? (
            <div className="text-center py-16 rounded-3xl bg-slate-50/50 border border-slate-200/50">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">没有找到匹配的成员</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredGlobalAgents.map((agent, idx) => {
                const isEnabled = enabledAgentIds.includes(agent.id);
                return (
                  <div 
                    key={agent.id}
                    className={`group relative rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 ${
                      isEnabled 
                        ? 'bg-gradient-to-br from-cyan-50/80 to-teal-50/40 border-2 border-cyan-400/50 shadow-lg shadow-cyan-500/10' 
                        : 'bg-white border border-slate-200/60 hover:border-cyan-300 hover:shadow-lg hover:shadow-cyan-500/5'
                    }`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    {/* 状态指示 */}
                    {isEnabled && (
                      <div className="absolute top-4 right-4">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          ACTIVE
                        </div>
                      </div>
                    )}
                    
                    {/* 图标 */}
                    <div className={`p-3 rounded-2xl mb-4 transition-all duration-300 ${
                      isEnabled 
                        ? 'bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-lg shadow-cyan-500/30' 
                        : 'bg-slate-100 text-slate-500 group-hover:bg-cyan-100 group-hover:text-cyan-600'
                    }`}>
                      <Bot className="w-6 h-6" />
                    </div>
                    
                    {/* 内容 */}
                    <h3 className="text-xl font-bold text-slate-900 mb-1 pr-16">{agent.name}</h3>
                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">{agent.role || 'General'}</p>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4 min-h-[48px] line-clamp-2">{agent.description}</p>
                    
                    {/* 默认模型选择 */}
                    <div className="mb-4">
                      <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-2">默认模型</label>
                      <select
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-cyan-400"
                        value={agent.defaultModelId || ''}
                        onChange={(e) => handleAgentModelChange(agent.id, e.target.value)}
                        disabled={updatingAgentModel === agent.id}
                      >
                        <option value="">跟随项目默认</option>
                        {models.map(m => (
                          <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                        ))}
                      </select>
                    </div>
                    
                    {/* 操作区域 */}
                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => toggleGlobalAgent(agent.id)}
                        className={`px-5 py-2 rounded-xl font-bold text-sm transition-all duration-200 ${
                          isEnabled 
                            ? 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-600 border border-slate-200' 
                            : 'bg-gradient-to-r from-cyan-500 to-teal-600 text-white hover:from-cyan-600 hover:to-teal-700 shadow-lg shadow-cyan-500/25'
                        }`}
                      >
                        {isEnabled ? '禁用' : '启用'}
                      </button>
                      {isEnabled && (
                        <button 
                          onClick={() => toggleGlobalAgent(agent.id)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Unlock className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 添加私有成员 弹窗 */}
      {showAddPrivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddPrivate(false)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* 弹窗头部 */}
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-rose-50 to-pink-50 border-b border-rose-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-rose-200/30 to-pink-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25">
                    <Lock className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">添加项目私有成员</h2>
                    <p className="text-sm text-slate-500 mt-0.5">仅当前项目可用，不会影响其他项目</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAddPrivate(false)} 
                  className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* 表单 */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  成员名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-rose-400 focus:bg-white transition"
                  placeholder="例如：Coder"
                  value={privateAgentForm.name}
                  onChange={e => setPrivateAgentForm({ ...privateAgentForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">职责角色</label>
                <input
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-rose-400 focus:bg-white transition"
                  placeholder="例如：代码编写者"
                  value={privateAgentForm.role}
                  onChange={e => setPrivateAgentForm({ ...privateAgentForm, role: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">职责描述</label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-rose-400 focus:bg-white transition resize-none"
                  rows={3}
                  placeholder="描述该成员的主要职责..."
                  value={privateAgentForm.description}
                  onChange={e => setPrivateAgentForm({ ...privateAgentForm, description: e.target.value })}
                />
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="px-8 pb-8 flex items-center justify-end gap-3">
              <button 
                onClick={() => setShowAddPrivate(false)}
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition"
              >
                取消
              </button>
              <button 
                onClick={handleAddPrivateAgent}
                disabled={savingPrivate}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-bold shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/30 transition disabled:opacity-50"
              >
                {savingPrivate ? '添加中...' : '添加成员'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑私有成员 弹窗 */}
      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setEditingAgent(null)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-cyan-50 to-teal-50 border-b border-cyan-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-cyan-200/30 to-teal-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 shadow-lg shadow-cyan-500/25">
                    <Edit3 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">编辑项目私有成员</h2>
                    <p className="text-sm text-slate-500 mt-0.5">{editingAgent.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingAgent(null)} 
                  className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">成员名称 <span className="text-rose-500">*</span></label>
                <input
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-cyan-400 focus:bg-white transition"
                  value={editingAgent.name}
                  onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">职责角色</label>
                <input
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-cyan-400 focus:bg-white transition"
                  value={editingAgent.role || ''}
                  onChange={e => setEditingAgent({ ...editingAgent, role: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">职责描述</label>
                <textarea
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-cyan-400 focus:bg-white transition resize-none"
                  rows={3}
                  value={editingAgent.description || ''}
                  onChange={e => setEditingAgent({ ...editingAgent, description: e.target.value })}
                />
              </div>
            </div>
            <div className="px-8 pb-8 flex items-center justify-end gap-3">
              <button 
                onClick={() => setEditingAgent(null)}
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition"
              >
                取消
              </button>
              <button 
                onClick={handleEditPrivateAgent}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white text-sm font-bold shadow-lg shadow-cyan-500/25 hover:shadow-xl hover:shadow-cyan-500/30 transition"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 设置主协调成员 弹窗 */}
      {showCoordinatorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCoordinatorModal(false)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-violet-50 to-purple-50 border-b border-violet-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-violet-200/30 to-purple-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 shadow-lg shadow-violet-500/25">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">设置主协调成员</h2>
                    <p className="text-sm text-slate-500 mt-0.5">选择负责协调任务的成员</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCoordinatorModal(false)} 
                  className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto space-y-3">
              <button
                onClick={() => handleSetCoordinator(null)}
                className="w-full text-left p-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <X className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="font-bold text-slate-600">不使用主协调成员</p>
                  <p className="text-xs text-slate-400">关闭主协调功能</p>
                </div>
              </button>
              {[...allGlobalAgents, ...projectPrivateAgents].map((agent: any) => (
                <button
                  key={agent.id}
                  onClick={() => handleSetCoordinator(agent.id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${
                    String(agent.id) === String(coordinatorAgentId)
                      ? 'border-violet-400 bg-violet-50'
                      : 'border-slate-200 hover:border-violet-300 hover:bg-violet-50/50'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-lg ${
                    String(agent.id) === String(coordinatorAgentId)
                      ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                      : 'bg-gradient-to-br from-slate-400 to-slate-500'
                  }`}>
                    {agent.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{agent.name}</p>
                    <p className="text-xs text-slate-400">{agent.role || agent.description || '团队成员'}</p>
                  </div>
                  {String(agent.id) === String(coordinatorAgentId) && (
                    <div className="ml-auto">
                      <CheckCircle2 className="w-5 h-5 text-violet-500" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
