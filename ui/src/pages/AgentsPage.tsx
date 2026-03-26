import { Bot, Plus, Trash2, Edit3, Save, X, ShieldCheck, UserCheck, Lock, Unlock, Search, Globe, CheckCircle2 } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function AgentsPage({ projectId }: { projectId: string }) {
  const [allGlobalAgents, setAllGlobalAgents] = useState<any[]>([]);
  const [projectData, setProjectData] = useState<any>(null);
  const [projectPrivateAgents, setProjectPrivateAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  
  // 搜索过滤
  const [searchQuery, setSearchQuery] = useState('');
  
  // 添加私有 Agent 相关状态
  const [showAddPrivate, setShowAddPrivate] = useState(false);
  const [privateAgentForm, setPrivateAgentForm] = useState({ name: '', role: '', description: '', type: 'custom' });
  const [savingPrivate, setSavingPrivate] = useState(false);

  const fetchData = async () => {
    try {
      const [globalRes, projectRes, privateRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/global`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private`)
      ]);
      setAllGlobalAgents(await globalRes.json());
      setProjectData(await projectRes.json());
      setProjectPrivateAgents(await privateRes.json());
    } catch (err) { console.error(err); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [projectId]);

  // 已启用的全局 Agent ID 列表
  const enabledAgentIds = projectData?.enabledAgentIds || [];
  
  // 合并显示：启用的全局 Agent + 项目私有 Agent
  const enabledAgents = useMemo(() => {
    const enabled = allGlobalAgents.filter(a => enabledAgentIds.includes(a.id));
    return [...enabled, ...projectPrivateAgents];
  }, [allGlobalAgents, enabledAgentIds, projectPrivateAgents]);

  // 过滤后的全局 Agent 列表
  const filteredGlobalAgents = useMemo(() => {
    return allGlobalAgents.filter(a => 
      (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allGlobalAgents, searchQuery]);

  // 切换全局 Agent
  const toggleGlobalAgent = async (agentId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    if (res.ok) {
      const newEnabledIds = await res.json();
      setProjectData({ ...projectData, enabledAgentIds: newEnabledIds });
    }
  };

  // 添加私有 Agent
  const handleAddPrivateAgent = async () => {
    if (!privateAgentForm.name.trim()) {
      alert('请填写 Agent 名称');
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

  // 删除私有 Agent
  const handleDeletePrivateAgent = async (agentId: string) => {
    if (!confirm('确定要删除此项目私有 Agent 吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private/${agentId}`, {
      method: 'DELETE'
    });
    if (res.ok) setProjectPrivateAgents(await res.json());
  };

  // 编辑私有 Agent
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

  if (loading) return <div className="p-8 text-center text-slate-500 font-medium animate-pulse">加载 Agent 列表中...</div>;

  return (
    <div className="space-y-10 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight italic flex items-center gap-3">
            <Bot className="h-7 w-7 text-primary-600" />
            Agent 管理
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            已启用 {enabledAgents.length} 个 Agent（全局 + 私有）
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" icon={Lock} onClick={() => setShowAddPrivate(true)}
            className="rounded-2xl font-black text-[10px] tracking-widest uppercase bg-amber-50 border-amber-200 text-amber-700">
            添加私有 Agent
          </Button>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input placeholder="搜索 Agent..." className="pl-9 pr-4 py-2.5 bg-white border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-primary-400 w-56"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 私有 Agent 弹窗 */}
      {showAddPrivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddPrivate(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 rounded-xl"><Lock className="h-5 w-5 text-amber-600" /></div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">添加项目私有 Agent</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">仅当前项目可用，不会影响其他项目</p>
                </div>
              </div>
              <button onClick={() => setShowAddPrivate(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 名称 <span className="text-rose-400">*</span></label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    placeholder="例如：我的专属助手" value={privateAgentForm.name} onChange={e => setPrivateAgentForm({...privateAgentForm, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">角色定位</label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    placeholder="例如：资深前端工程师" value={privateAgentForm.role} onChange={e => setPrivateAgentForm({...privateAgentForm, role: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 职责描述</label>
                <textarea className="w-full h-32 p-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-medium transition-all" 
                  placeholder="描述该 Agent 擅长的领域、规则或工作流程..." value={privateAgentForm.description} onChange={e => setPrivateAgentForm({...privateAgentForm, description: e.target.value})} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowAddPrivate(false)}>取消</Button>
                <Button icon={Save} onClick={handleAddPrivateAgent} disabled={savingPrivate}>{savingPrivate ? '保存中...' : '保存私有 Agent'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 已启用的 Agent 列表 */}
      {enabledAgents.length > 0 && (
        <Card className="p-8 border-primary-100 bg-gradient-to-r from-primary-50/30 to-white shadow-sm rounded-[32px]">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle2 className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">已启用的 Agent</h3>
            <Badge status="success" className="font-black px-3 py-1 scale-90">{enabledAgents.length}</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {enabledAgents.map((agent) => (
              <Card key={agent.id} className="p-6 group border-primary-100 bg-white hover:border-primary-300 transition-all rounded-3xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-primary-50 text-primary-600"><Bot className="h-5 w-5" /></div>
                  <div className="flex items-center gap-2">
                    {agent.isPrivate && <Badge status="warning" className="font-black px-2 py-0.5 text-[8px]">私有</Badge>}
                    {agent.isPrivate ? (
                      <>
                        <button onClick={() => setEditingAgent(agent)} className="p-2 text-slate-300 hover:text-primary-600 hover:bg-primary-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDeletePrivateAgent(agent.id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <Badge status="default" className="font-black px-2 py-0.5 text-[8px] bg-emerald-50 text-emerald-600">全局</Badge>
                    )}
                  </div>
                </div>
                <h4 className="text-base font-black text-slate-900 mb-1">{agent.name}</h4>
                <p className="text-[10px] text-primary-600 font-black uppercase tracking-wider mb-2">{agent.role || 'General'}</p>
                <p className="text-xs text-slate-500 font-medium line-clamp-2">{agent.description}</p>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {/* 全局 Agent 列表 */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-slate-400" />
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">全局 Agent 库</h3>
          <Badge status="default" className="font-black px-3 py-1 scale-90">{allGlobalAgents.length}</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGlobalAgents.map((agent) => {
            const isEnabled = enabledAgentIds.includes(agent.id);
            return (
              <Card key={agent.id} className={`p-6 group transition-all rounded-3xl border ${isEnabled ? 'border-primary-500 bg-primary-50/20 shadow-md' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-xl transition-all ${isEnabled ? 'bg-primary-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600'}`}>
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    {isEnabled && <Badge status="success" className="font-black px-2 py-0.5 text-[8px]">已启用</Badge>}
                  </div>
                </div>
                <h4 className="text-base font-black text-slate-900 mb-1">{agent.name}</h4>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-wider mb-2">{agent.role || 'General'}</p>
                <p className="text-xs text-slate-500 font-medium line-clamp-2">{agent.description}</p>
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <Button 
                    variant={isEnabled ? 'outline' : 'primary'} 
                    size="sm" 
                    onClick={() => toggleGlobalAgent(agent.id)} 
                    className={`w-full rounded-xl font-black ${isEnabled ? 'border-primary-200 text-primary-600' : ''}`}
                    icon={isEnabled ? Unlock : Lock}
                  >
                    {isEnabled ? '禁用' : '启用'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 编辑私有 Agent 弹窗 */}
      {editingAgent && editingAgent.isPrivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingAgent(null)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 rounded-xl"><Lock className="h-5 w-5 text-amber-600" /></div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">编辑私有 Agent</h2>
              </div>
              <button onClick={() => setEditingAgent(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 名称</label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    value={editingAgent.name} onChange={e => setEditingAgent({...editingAgent, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">角色定位</label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    value={editingAgent.role} onChange={e => setEditingAgent({...editingAgent, role: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 职责描述</label>
                <textarea className="w-full h-32 p-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-medium transition-all" 
                  value={editingAgent.description} onChange={e => setEditingAgent({...editingAgent, description: e.target.value})} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditingAgent(null)}>取消</Button>
                <Button icon={Save} onClick={handleEditPrivateAgent}>保存修改</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}