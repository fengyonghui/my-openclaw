import { Bot, Plus, Trash2, Edit3, Save, X, Search, ShieldCheck, UserCheck, Sparkles, Users, ChevronRight, Loader2 } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function GlobalAgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    description: '',
    type: 'custom'
  });
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  const fetchAgents = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/projects/global/agents');
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { 
    fetchAgents();
    setTimeout(() => setMounted(true), 100);
  }, []);

  const filteredAgents = useMemo(() => {
    return agents.filter(a =>
      (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [agents, searchQuery]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) return alert('请填写成员名称');
    setSaving(true);
    try {
      const isEditing = Boolean(editingAgent);
      const url = isEditing
        ? `http://localhost:3001/api/v1/projects/global/agents/${editingAgent.id}`
        : 'http://localhost:3001/api/v1/projects/global/agents';
      
      const res = await fetch(url, {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      if (res.ok) {
        setAgents(await res.json());
        setShowForm(false);
        setEditingAgent(null);
        setFormData({ name: '', role: '', description: '', type: 'custom' });
      }
    } catch (err) { alert('保存失败'); }
    setSaving(false);
  };

  const handleEdit = (agent: any) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      role: agent.role || '',
      description: agent.description || '',
      type: agent.type || 'custom'
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个全局成员吗？')) return;
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/global/agents/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) setAgents(await res.json());
    } catch (err) { alert('删除失败'); }
  };

  if (loading) return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-cyan-50/30" />
      <div className="relative flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 animate-pulse opacity-20" />
            <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-cyan-500/20 flex items-center justify-center">
              <Bot className="w-8 h-8 text-cyan-500 animate-bounce" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 tracking-wide">加载全局成员中...</p>
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
      <div className={`relative pt-8 px-8 pb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-50 text-cyan-600 text-xs font-bold tracking-wide">
                <Users className="w-3.5 h-3.5" />
                全局管理
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-cyan-900 to-slate-900 bg-clip-text">
                  全局成员管理
                </span>
              </h1>
              <p className="text-base text-slate-500 font-medium max-w-xl leading-relaxed">
                管理系统级别的成员，所有项目都可以启用使用，打造统一的 AI 协作能力
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
              <button
                onClick={() => {
                  setEditingAgent(null);
                  setFormData({ name: '', role: '', description: '', type: 'custom' });
                  setShowForm(true);
                }}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-bold text-sm shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Plus className="w-4 h-4 relative" />
                <span className="relative">添加全局成员</span>
              </button>
              
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300" />
                <div className="relative flex items-center bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                  <Search className="w-4 h-4 text-slate-400 ml-4" />
                  <input 
                    placeholder="搜索成员..." 
                    className="w-56 px-4 py-3 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="mr-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Stats Bar */}
          <div className="mt-8 flex flex-wrap gap-4">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-sm font-semibold text-slate-700">{agents.length} 个全局成员</span>
            </div>
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-rose-50 border border-rose-200/60">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-sm font-semibold text-rose-700">{filteredAgents.length} 个匹配</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className={`relative px-8 max-w-7xl mx-auto transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        
        {/* 成员库 */}
        {filteredAgents.length === 0 ? (
          <div className="text-center py-24 rounded-3xl bg-gradient-to-br from-slate-50/80 to-white border border-slate-200/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-cyan-100/30 to-teal-100/20 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
            <div className="relative">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200" />
                <div className="absolute inset-0 rounded-3xl bg-white shadow-lg flex items-center justify-center">
                  <Users className="w-12 h-12 text-slate-300" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-600 mb-2">
                {searchQuery ? '未找到匹配的成员' : '暂无全局成员'}
              </h3>
              <p className="text-slate-500 mb-8 max-w-md mx-auto">
                {searchQuery ? '尝试其他关键词' : '创建一个全局成员，让所有项目都可以使用'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => {
                    setEditingAgent(null);
                    setFormData({ name: '', role: '', description: '', type: 'custom' });
                    setShowForm(true);
                  }}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-bold text-sm shadow-lg shadow-rose-500/25 hover:shadow-xl shadow-rose-500/30 transition-all hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5" />
                  创建第一个全局成员
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredAgents.map((agent, idx) => {
              const gradients = [
                'from-cyan-500 to-blue-600',
                'from-emerald-500 to-teal-600',
                'from-amber-500 to-orange-600',
                'from-rose-500 to-pink-600',
                'from-violet-500 to-purple-600',
              ];
              const gradient = gradients[idx % gradients.length];
              
              return (
                <div 
                  key={agent.id}
                  className="group"
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  <div className="relative p-7 rounded-3xl bg-white/80 backdrop-blur-sm border border-slate-200/50 shadow-sm hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 overflow-hidden">
                    {/* Hover Glow */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />
                    
                    {/* Decorative Orb */}
                    <div className={`absolute -top-8 -right-8 w-28 h-28 bg-gradient-to-br ${gradient} rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500`} />
                    
                    <div className="relative">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-5">
                        <div className="relative">
                          <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${gradient} blur-lg opacity-0 group-hover:opacity-50 transition-opacity`} />
                          <div className={`relative w-14 h-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-black text-xl shadow-lg`}>
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleEdit(agent)} 
                            className="p-2.5 rounded-xl bg-slate-100 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(agent.id)} 
                            className="p-2.5 rounded-xl bg-slate-100 text-slate-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      
                      {/* Content */}
                      <h3 className="text-xl font-black text-slate-900 mb-1 group-hover:text-slate-700 transition-colors">
                        {agent.name}
                      </h3>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                        {agent.role || 'General'}
                      </p>
                      <p className="text-sm text-slate-500 leading-relaxed line-clamp-3 mb-5 min-h-[60px]">
                        {agent.description || '暂无描述'}
                      </p>
                      
                      {/* Footer */}
                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                          {agent.type || 'custom'}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${agent.status === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            {agent.status || 'idle'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit 成员 Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative z-10 w-full max-w-xl max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-rose-50 to-pink-50 border-b border-rose-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-rose-200/30 to-pink-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/25">
                    {editingAgent ? <Edit3 className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {editingAgent ? '编辑全局成员' : '添加全局成员'}
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">全局成员可被所有项目启用使用</p>
                  </div>
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    成员名称 <span className="text-rose-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-50 outline-none transition-all text-sm font-semibold"
                    placeholder="例如：PM 成员"
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    角色定位
                  </label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-50 outline-none transition-all text-sm font-semibold"
                    placeholder="例如：项目经理"
                    value={formData.role} 
                    onChange={e => setFormData({...formData, role: e.target.value})} 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  成员职责描述
                </label>
                <textarea 
                  className="w-full h-32 p-5 rounded-xl bg-slate-50 border border-slate-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-50 outline-none transition-all text-sm font-medium resize-none"
                  placeholder="描述该成员擅长的领域、规则或工作流程..."
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})} 
                />
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-8 py-6 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100">
              <button 
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-rose-500 to-pink-500 shadow-lg shadow-rose-500/25 hover:from-rose-600 hover:to-pink-600 hover:shadow-xl hover:shadow-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <span className="flex items-center gap-2">
                  {saving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />保存中...</>
                  ) : (
                    <><Save className="w-4 h-4" />{editingAgent ? '保存修改' : '创建成员'}</>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Styles */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
