import { Bot, Plus, Trash2, Edit3, Save, X, Search, ShieldCheck, UserCheck } from 'lucide-react';
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

  const fetchAgents = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/v1/projects/global/agents');
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAgents(); }, []);

  const filteredAgents = useMemo(() => {
    return agents.filter(a =>
      (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [agents, searchQuery]);

  const handleSubmit = async () => {
    if (!formData.name.trim()) return alert('请填写 Agent 名称');
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
    if (!confirm('确定要删除这个全局 Agent 吗？')) return;
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/global/agents/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) setAgents(await res.json());
    } catch (err) { alert('删除失败'); }
  };

  if (loading) return <div className="p-12 text-center text-slate-500 font-medium animate-pulse">加载全局 Agent 中...</div>;

  return (
    <div className="space-y-10 pb-20 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight italic flex items-center gap-3">
            <Bot className="h-8 w-8 text-primary-600" />
            全局 Agent 管理
          </h1>
          <p className="mt-2 text-sm text-slate-500 font-medium">
            管理系统级别的 Agent，所有项目都可以启用使用
          </p>
        </div>
        <div className="flex gap-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary-500 transition-colors" />
            <input placeholder="搜索 Agent..." className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50 w-64"
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <Button onClick={() => {
            setEditingAgent(null);
            setFormData({ name: '', role: '', description: '', type: 'custom' });
            setShowForm(true);
          }} icon={Plus}>
            添加全局 Agent
          </Button>
        </div>
      </div>

      {/* Agent Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary-50 rounded-xl">
                  <Bot className="h-5 w-5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">
                    {editingAgent ? '编辑全局 Agent' : '添加全局 Agent'}
                  </h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">全局 Agent 可被所有项目启用使用</p>
                </div>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">
                    Agent 名称 <span className="text-rose-400">*</span>
                  </label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold transition-all"
                    placeholder="例如：PM Agent" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">角色定位</label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold transition-all"
                    placeholder="例如：项目经理" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 职责描述</label>
                <textarea className="w-full h-32 p-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-medium transition-all"
                  placeholder="描述该 Agent 擅长的领域、规则或工作流程..."
                  value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
                <Button icon={Save} onClick={handleSubmit} disabled={saving}>
                  {saving ? '保存中...' : (editingAgent ? '保存修改' : '创建 Agent')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredAgents.map((agent) => (
          <Card key={agent.id} className="p-8 group hover:border-primary-400 transition-all border-slate-100 bg-white shadow-sm rounded-3xl relative overflow-hidden">
            <div className="flex items-start justify-between mb-6">
              <div className="bg-primary-50 p-4 rounded-2xl group-hover:bg-primary-600 group-hover:text-white transition-all shadow-sm">
                <Bot className="h-6 w-6" />
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => handleEdit(agent)} className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all">
                  <Edit3 className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(agent.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg">{agent.name}</h3>
              <p className="text-[10px] text-primary-600 font-black uppercase tracking-[0.15em] mt-1">{agent.role || 'General'}</p>
              <p className="mt-4 text-sm text-slate-500 font-medium leading-relaxed line-clamp-3 italic">"{agent.description || '没有填写描述...'}"</p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
              <Badge status="default" className="px-3 py-1 text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">
                Type: {agent.type || 'custom'}
              </Badge>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${agent.status === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{agent.status || 'idle'}</span>
              </div>
            </div>
          </Card>
        ))}
        {filteredAgents.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 py-16 text-center text-slate-400 font-bold italic tracking-widest bg-slate-50/50 rounded-[32px] border border-dashed border-slate-200">
            {searchQuery ? '未找到匹配的 Agent' : '暂无全局 Agent，点击添加按钮创建'}
          </div>
        )}
      </div>
    </div>
  );
}