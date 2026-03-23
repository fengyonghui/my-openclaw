import { FolderPlus, FolderOpen, ArrowRight, Settings, Plus, Trash2, Cpu, Save, Search, Check, Square, CheckSquare, X, Globe } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function ProjectListPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [globalModels, setGlobalModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGlobalModels, setShowGlobalModels] = useState(false);
  const [editingModel, setEditingModel] = useState<any>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scannedModels, setScannedModels] = useState<any[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3001/api/v1/projects'),
      fetch('http://localhost:3001/api/v1/models')
    ]).then(async ([pRes, mRes]) => {
      setProjects(await pRes.json());
      setGlobalModels(await mRes.json());
      setLoading(false);
    });
  }, []);

  const getModelName = (id: string) => {
    const model = globalModels.find(m => m.id === id);
    return model ? model.name : id;
  };

  const filteredProjects = useMemo(() => {
    return projects.filter(p => 
      p.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(projectSearchQuery.toLowerCase()))
    );
  }, [projects, projectSearchQuery]);

  const filteredGlobalModels = useMemo(() => {
    return globalModels.filter(m => 
      m.name.toLowerCase().includes(modelSearchQuery.toLowerCase()) || 
      m.modelId.toLowerCase().includes(modelSearchQuery.toLowerCase()) ||
      (m.baseUrl && m.baseUrl.toLowerCase().includes(modelSearchQuery.toLowerCase()))
    );
  }, [globalModels, modelSearchQuery]);

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要永久删除该项目及其所有会话记录吗？此操作无法恢复。')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${id}`, { method: 'DELETE' });
    if (res.ok) setProjects(await res.json());
  };

  const handleFetchRemote = async () => {
    if (!editingModel.baseUrl || !editingModel.apiKey) return alert('请先填写 Base URL 和 API Key');
    setScanning(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/models/fetch-remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: editingModel.baseUrl, apiKey: editingModel.apiKey })
      });
      if (res.ok) {
        setScannedModels(await res.json());
      } else {
        const err = await res.json();
        alert(`扫描失败: ${err.error || '未知错误'}`);
      }
    } catch (e) {
      alert('无法连接到后端，请确认服务已启动');
    }
    setScanning(false);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedModelIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedModelIds(next);
  };

  const handleBatchSave = async () => {
    const selected = scannedModels.filter(m => selectedModelIds.has(m.id)).map(m => ({
      id: `${editingModel.provider || 'custom'}-${m.id}-${Date.now()}`,
      name: m.id,
      provider: editingModel.provider || 'Custom',
      baseUrl: editingModel.baseUrl,
      apiKey: editingModel.apiKey,
      modelId: m.id
    }));
    const res = await fetch('http://localhost:3001/api/v1/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selected)
    });
    setGlobalModels(await res.json());
    setEditingModel(null);
    setScannedModels([]);
    setSelectedModelIds(new Set());
  };

  if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">加载中...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-12 py-12 px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight italic">OPENCLAW</h1>
          <p className="mt-2 text-slate-500 font-bold uppercase tracking-widest text-[10px]">Project Management System</p>
        </div>
        <div className="flex gap-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary-500 transition-colors" />
            <input 
              placeholder="搜索项目..." 
              className="pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50 transition-all w-64 shadow-sm" 
              value={projectSearchQuery} 
              onChange={e => setProjectSearchQuery(e.target.value)} 
            />
          </div>
          <Button variant="outline" onClick={() => setShowGlobalModels(!showGlobalModels)} icon={Settings}>全局模型管理</Button>
          <Button onClick={() => window.location.reload()} icon={Plus}>创建新项目</Button>
        </div>
      </div>

      {showGlobalModels && (
        <Card className="p-10 border-primary-100 bg-white shadow-2xl relative animate-in zoom-in-95 duration-200 rounded-[32px]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-black text-slate-900">全局模型池配置</h2>
            <div className="flex items-center gap-3">
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><input placeholder="搜索模型名称..." className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-primary-400 transition-all w-64" value={modelSearchQuery} onChange={e => setModelSearchQuery(e.target.value)} /></div>
              <Button variant="secondary" onClick={() => setEditingModel({ name: '', provider: '', baseUrl: '', apiKey: '', modelId: '' })} icon={Plus}>添加模型</Button>
            </div>
          </div>
          <div className="grid gap-3 max-h-[500px] overflow-y-auto pr-2">
            {filteredGlobalModels.length === 0 ? <div className="p-12 text-center text-slate-400 text-sm font-bold uppercase italic tracking-widest bg-slate-50 rounded-3xl border border-dashed">无匹配模型</div> : filteredGlobalModels.map(m => (
                <div key={m.id} className="p-5 rounded-3xl border border-slate-100 bg-slate-50/30 flex items-center justify-between group hover:border-primary-200 hover:bg-white transition-all">
                  <div className="flex items-center gap-5 flex-1 min-w-0">
                    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 group-hover:bg-primary-50 transition-colors flex-shrink-0"><Cpu className="h-5 w-5 text-primary-600" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3"><h3 className="text-sm font-black text-slate-900 truncate">{m.name}</h3><Badge status="default" className="scale-75 origin-left font-mono">{m.modelId}</Badge></div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 font-mono truncate"><Globe className="h-3 w-3 flex-shrink-0" /><span className="truncate">{m.baseUrl}</span></div>
                    </div>
                  </div>
                  <button onClick={() => fetch(`http://localhost:3001/api/v1/models/${m.id}`, { method: 'DELETE' }).then(res => res.json()).then(setGlobalModels)} className="ml-4 text-rose-400 hover:text-rose-600 p-2 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
          </div>
          {editingModel && (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
              <Card className="max-w-4xl w-full p-10 shadow-3xl bg-white border-0 max-h-[90vh] flex flex-col relative animate-in zoom-in-95 rounded-[32px]">
                <button onClick={() => { setEditingModel(null); setScannedModels([]); }} className="absolute right-6 top-6 p-2 text-slate-400 hover:text-slate-600"><X className="h-6 w-6" /></button>
                <h3 className="text-2xl font-black text-slate-900 mb-8">批量导入模型</h3>
                <div className="grid gap-6 md:grid-cols-2 mb-8">
                   <div className="space-y-1.5"><label className="text-[10px] font-black uppercase text-slate-400">Base URL</label><input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-mono font-bold" value={editingModel.baseUrl} onChange={e => setEditingModel({...editingModel, baseUrl: e.target.value})} placeholder="https://api.openai.com/v1" /></div>
                   <div className="space-y-1.5"><label className="text-[10px] font-black uppercase text-slate-400">API Key</label><input type="password" className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-mono font-bold" value={editingModel.apiKey} onChange={e => setEditingModel({...editingModel, apiKey: e.target.value})} placeholder="sk-..." /></div>
                </div>
                <div className="flex-1 overflow-hidden flex flex-col bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white/50 backdrop-blur">
                    <Button variant="secondary" onClick={handleFetchRemote} disabled={scanning} icon={Search}>{scanning ? '扫描中...' : '扫描可用模型'}</Button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 grid gap-2">
                    {scannedModels.length === 0 ? <div className="p-12 text-center text-slate-400 text-sm font-bold uppercase italic tracking-widest">扫描结果将在此显示</div> : scannedModels.map(m => (
                        <button key={m.id} onClick={() => toggleSelect(m.id)} className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${selectedModelIds.has(m.id) ? 'bg-white border-primary-500 shadow-sm ring-1 ring-primary-100' : 'bg-transparent border-transparent hover:bg-white/50'}`}>
                           <span className="text-sm font-bold text-slate-700">{m.id}</span>
                           {selectedModelIds.has(m.id) && <Check className="h-4 w-4 text-primary-600" />}
                        </button>
                      ))}
                  </div>
                </div>
                <div className="mt-8 flex gap-4 pt-6 border-t border-slate-50"><Button onClick={handleBatchSave} className="flex-1 py-4 font-black shadow-xl shadow-primary-100" disabled={selectedModelIds.size === 0}>导入所选 ({selectedModelIds.size})</Button></div>
              </Card>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {filteredProjects.map(p => (
          <Card key={p.id} className="p-8 group hover:border-primary-400 transition-all cursor-pointer border-slate-100 bg-white relative rounded-[32px] overflow-hidden" onClick={() => onSelectProject(p.id)}>
             <div className="flex items-start justify-between">
                <h3 className="text-xl font-black text-slate-900 group-hover:text-primary-700 transition-colors pr-8">{p.name}</h3>
                <button 
                  onClick={(e) => handleDeleteProject(e, p.id)} 
                  className="absolute top-6 right-6 p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-2xl opacity-0 group-hover:opacity-100 transition-all z-10"
                >
                  <Trash2 className="h-4.5 w-4.5" />
                </button>
             </div>
             <p className="mt-3 text-sm text-slate-500 font-medium leading-relaxed line-clamp-2">{p.description}</p>
             <div className="mt-8 pt-6 border-t border-slate-50 space-y-3">
               <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Cpu className="h-3 w-3" /> Default Model</div>
               <Badge status="info" className="px-3 py-1 font-black text-[10px] uppercase tracking-wider">{getModelName(p.defaultModel)}</Badge>
             </div>
          </Card>
        ))}
        {filteredProjects.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 py-20 text-center text-slate-400 font-bold italic tracking-widest bg-slate-50/50 rounded-[40px] border border-dashed border-slate-200 uppercase">
            未找到匹配的项目
          </div>
        )}
      </div>
    </div>
  );
}
