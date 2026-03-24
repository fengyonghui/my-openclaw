import { Settings, Shield, Cpu, Bell, Save, Trash2, Layout, Bot, Info, Globe } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function SettingsPage({ projectId, onSaved }: { projectId: string, onSaved?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 临时编辑状态
  const [editState, setEditState] = useState({
    name: '',
    description: '',
    defaultModel: '',
    defaultAgentId: ''
  });

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [pRes, mRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/models`)
        ]);
        const pData = await pRes.json();
        const mData = await mRes.json();
        
        setProject(pData);
        setModels(mData);
        setEditState({
          name: pData.name,
          description: pData.description,
          defaultModel: pData.defaultModel,
          defaultAgentId: pData.defaultAgentId || '1'
        });
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    init();
  }, [projectId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editState)
      });
      if (res.ok) {
        setProject(await res.json());
        alert('配置已成功保存');
        onSaved?.();
      }
    } catch (err) { alert('保存失败'); } finally { setSaving(false); }
  };

  if (loading) return <div className="p-12 text-center text-slate-400 font-bold animate-pulse">加载设置中...</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-2xl shadow-xl"><Settings className="h-6 w-6 text-white" /></div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight italic">Project Settings</h1>
            <p className="text-sm text-slate-500 font-medium">配置项目的核心参数、工作空间及 Agent 偏好</p>
          </div>
        </div>
        <Button icon={Save} onClick={handleSave} disabled={saving}>{saving ? '正在保存...' : '保存修改'}</Button>
      </div>

      <div className="grid gap-8">
        <Card className="p-8 border-slate-100 bg-white shadow-sm rounded-3xl">
          <div className="flex items-center gap-3 mb-8">
             <div className="p-2.5 bg-blue-50 rounded-xl"><Layout className="h-5 w-5 text-blue-600" /></div>
             <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">项目基础元数据</h3>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">项目名称</label>
              <input 
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all" 
                value={editState.name} 
                onChange={e => setEditState({...editState, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">项目 ID (不可修改)</label>
              <input className="w-full px-5 py-4 rounded-2xl bg-slate-100 border-0 text-slate-400 text-sm font-mono font-bold" value={project?.id} readOnly />
            </div>
            <div className="md:col-span-2 space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">项目描述</label>
              <textarea 
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-medium text-slate-700 transition-all min-h-[100px]" 
                value={editState.description}
                onChange={e => setEditState({...editState, description: e.target.value})}
              />
            </div>
          </div>
        </Card>

        <Card className="p-8 border-slate-100 bg-white shadow-sm rounded-3xl">
          <div className="flex items-center gap-3 mb-8">
             <div className="p-2.5 bg-amber-50 rounded-xl"><Cpu className="h-5 w-5 text-amber-600" /></div>
             <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">默认模型与 Agent</h3>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">默认模型</label>
              <select 
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                value={editState.defaultModel}
                onChange={e => setEditState({...editState, defaultModel: e.target.value})}
              >
                {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">默认 Agent</label>
              <select 
                className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                value={editState.defaultAgentId}
                onChange={e => setEditState({...editState, defaultAgentId: e.target.value})}
              >
                <option value="1">PM Agent</option>
                <option value="2">Backend Agent</option>
                <option value="3">UX Agent</option>
              </select>
            </div>
          </div>
        </Card>

        <Card className="p-8 border-slate-100 bg-white shadow-sm rounded-3xl">
           <div className="flex items-center gap-3 mb-8">
             <div className="p-2.5 bg-indigo-50 rounded-xl"><Globe className="h-5 w-5 text-indigo-600" /></div>
             <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">工作空间物理路径</h3>
          </div>
          <div className="p-5 bg-slate-50 border border-slate-100 rounded-2xl">
             <code className="text-xs font-mono font-bold text-slate-500 break-all">{project?.workspace}</code>
          </div>
          <p className="mt-3 text-[10px] font-black text-slate-400 uppercase tracking-widest italic ml-1">该路径由系统自动维护，映射自项目名称。</p>
        </Card>

        <Card className="p-8 border-rose-100 bg-rose-50/20 shadow-sm rounded-3xl ring-1 ring-rose-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="rounded-xl bg-rose-600 p-2 shadow-lg shadow-rose-100"><Shield className="h-5 w-5 text-white" /></div>
            <h3 className="text-sm font-black text-rose-900 uppercase tracking-widest">危险操作：项目归档/删除</h3>
          </div>
          <p className="text-xs text-rose-700 font-medium mb-8 leading-relaxed italic">删除项目将永久销毁所有 Chat 历史、物理文件索引以及已同步的 Agent 记忆。此操作不可逆，请务必确认后执行。</p>
          <Button variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-600 hover:text-white transition-all px-8 py-3 rounded-xl font-black" icon={Trash2}>删除当前项目</Button>
        </Card>
      </div>
    </div>
  );
}
