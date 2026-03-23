import { Bot, Plus, Trash2, Edit3, Save, X, ShieldCheck, UserCheck } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function AgentsPage({ projectId }: { projectId: string }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<any>(null);

  const fetchAgents = async () => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`);
    setAgents(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchAgents(); }, [projectId]);

  const handleSave = async () => {
    const isNew = !editingAgent.id;
    const url = isNew 
      ? `http://localhost:3001/api/v1/projects/${projectId}/agents` 
      : `http://localhost:3001/api/v1/projects/${projectId}/agents/${editingAgent.id}`;
    
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingAgent)
    });

    if (res.ok) {
      setAgents(await res.json());
      setEditingAgent(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个 Agent 吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/${id}`, {
      method: 'DELETE'
    });
    if (res.ok) setAgents(await res.json());
  };

  if (loading) return <div className="p-8 text-center text-slate-500 font-medium animate-pulse">加载 Agent 列表中...</div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight italic">Project Agents</h1>
          <p className="text-sm text-slate-500 font-medium">配置并管理能够执行具体任务的智能化 Agent</p>
        </div>
        <Button onClick={() => setEditingAgent({ name: '', role: '', description: '', type: 'custom' })} icon={Plus}>配置新 Agent</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} className="p-8 group hover:border-primary-400 transition-all border-slate-100 bg-white shadow-sm rounded-3xl relative overflow-hidden">
            <div className="flex items-start justify-between mb-6">
              <div className="bg-primary-50 p-4 rounded-2xl group-hover:bg-primary-600 group-hover:text-white transition-all shadow-sm"><Bot className="h-6 w-6" /></div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => setEditingAgent(agent)} className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all"><Edit3 className="h-4 w-4" /></button>
                <button onClick={() => handleDelete(agent.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg">{agent.name}</h3>
              <p className="text-[10px] text-primary-600 font-black uppercase tracking-[0.15em] mt-1">{agent.role || 'General Assistant'}</p>
              <p className="mt-4 text-sm text-slate-500 font-medium leading-relaxed line-clamp-3 italic">"{agent.description || '没有填写描述...'}"</p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${agent.status === 'busy' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{agent.status || 'idle'}</span></div>
              <Badge status="default" className="px-3 py-1 text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">Type: {agent.type}</Badge>
            </div>
          </Card>
        ))}
      </div>

      {editingAgent && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-10 shadow-3xl bg-white border-0 animate-in zoom-in-95 rounded-[32px] relative">
            <button onClick={() => setEditingAgent(null)} className="absolute right-6 top-6 p-2 text-slate-400 hover:text-slate-600"><X className="h-6 w-6" /></button>
            <h3 className="text-2xl font-black text-slate-900 mb-8 italic">{editingAgent.id ? '编辑 Agent' : '创建新 Agent'}</h3>
            <div className="space-y-6">
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 名称</label>
                 <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all" value={editingAgent.name} onChange={e => setEditingAgent({...editingAgent, name: e.target.value})} placeholder="例如: Backend Expert" />
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">角色定位</label>
                 <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all" value={editingAgent.role} onChange={e => setEditingAgent({...editingAgent, role: e.target.value})} placeholder="例如: 资深后端工程师" />
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Agent 职责描述</label>
                 <textarea className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-medium text-slate-700 transition-all min-h-[120px]" value={editingAgent.description} onChange={e => setEditingAgent({...editingAgent, description: e.target.value})} placeholder="描述该 Agent 擅长的领域、规则或工作流程..." />
               </div>
            </div>
            <div className="mt-10 flex gap-4 pt-6 border-t border-slate-50">
               <Button variant="outline" className="flex-1 py-4 rounded-2xl font-black" onClick={() => setEditingAgent(null)}>取消</Button>
               <Button className="flex-1 py-4 rounded-2xl font-black shadow-xl shadow-primary-200" onClick={handleSave}>保存配置</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
