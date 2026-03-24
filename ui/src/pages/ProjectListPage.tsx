import { FolderPlus, FolderOpen, ArrowRight, Settings, Plus, Trash2, Cpu, Save, Search, Check, Square, CheckSquare, X, Globe, Puzzle, Download, FileText, ExternalLink } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function ProjectListPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [globalModels, setGlobalModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGlobalModels, setShowGlobalModels] = useState(false);
  const [showGlobalSkills, setShowGlobalSkills] = useState(false);
  const [editingModel, setEditingModel] = useState<any>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scannedModels, setScannedModels] = useState<any[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [globalSkills, setGlobalSkills] = useState<any[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualContent, setManualContent] = useState('');
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showImportProject, setShowImportProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [importingProject, setImportingProject] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({ name: '', description: '', parentDir: '/mnt/d/workspace' });
  const [importProjectForm, setImportProjectForm] = useState({ name: '', description: '', workspace: '' });
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [pickerPath, setPickerPath] = useState('/mnt/d/workspace');
  const [pickerDirs, setPickerDirs] = useState<any[]>([]);
  const [pickerParentPath, setPickerParentPath] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3001/api/v1/projects'),
      fetch('http://localhost:3001/api/v1/models'),
      fetch('http://localhost:3001/api/v1/skills')
    ]).then(async ([pRes, mRes, sRes]) => {
      setProjects(await pRes.json());
      setGlobalModels(await mRes.json());
      setGlobalSkills(await sRes.json());
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

  const filteredGlobalSkills = useMemo(() => {
    return globalSkills.filter((s: any) =>
      (s.name || '').toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(skillSearchQuery.toLowerCase())
    );
  }, [globalSkills, skillSearchQuery]);

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('确定要永久删除该项目及其所有会话记录吗？此操作无法恢复。')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${id}`, { method: 'DELETE' });
    if (res.ok) setProjects(await res.json());
  };

  const handleCreateProject = async () => {
    if (!newProjectForm.name.trim()) return alert('请填写项目名称');
    setCreatingProject(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProjectForm)
      });
      if (res.ok) {
        const created = await res.json();
        setProjects(prev => [created, ...prev]);
        setShowCreateProject(false);
        setNewProjectForm({ name: '', description: '', parentDir: '/mnt/d/workspace' });
      } else {
        const err = await res.json();
        alert(`创建失败: ${err.error || '未知错误'}`);
      }
    } catch {
      alert('创建失败：后端不可用');
    } finally {
      setCreatingProject(false);
    }
  };

  const handleImportProject = async () => {
    if (!importProjectForm.workspace.trim()) return alert('请填写项目目录');
    setImportingProject(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importProjectForm)
      });
      if (res.ok) {
        const created = await res.json();
        setProjects(prev => [created, ...prev]);
        setShowImportProject(false);
        setImportProjectForm({ name: '', description: '', workspace: '' });
      } else {
        const err = await res.json();
        alert(`导入失败: ${err.error || '未知错误'}`);
      }
    } catch {
      alert('导入失败：后端不可用');
    } finally {
      setImportingProject(false);
    }
  };

  const loadDirectories = async (targetPath: string) => {
    setPickerLoading(true);
    try {
      const res = await fetch(`http://localhost:3001/api/v1/system/ls?currentPath=${encodeURIComponent(targetPath)}`);
      if (!res.ok) throw new Error('读取目录失败');
      const data = await res.json();
      setPickerPath(data.currentPath || targetPath);
      setPickerParentPath(data.parentPath || '');
      setPickerDirs(data.directories || []);
    } catch {
      alert('读取目录失败，请确认后端服务正常');
    } finally {
      setPickerLoading(false);
    }
  };

  const openFolderPicker = async () => {
    setShowFolderPicker(true);
    const startPath = importProjectForm.workspace || pickerPath || '/mnt/d/workspace';
    await loadDirectories(startPath);
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

  const handleImportSkill = async (type: 'direct' | 'zip') => {
    if (!importUrl) return;
    setImporting(true);
    const apiPath = type === 'direct' ? 'import' : 'import-zip';
    try {
      const res = await fetch(`http://localhost:3001/api/v1/skills/${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });
      if (res.ok) {
        setGlobalSkills(await res.json());
        setImportUrl('');
        alert('技能导入成功！');
      } else {
        const err = await res.json();
        alert(`导入失败: ${err.error || '未知错误'}`);
      }
    } catch (err) {
      alert('网络异常');
    } finally {
      setImporting(false);
    }
  };

  const handleManualSkillSave = async () => {
    if (!manualContent.trim()) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: manualContent })
    });
    if (res.ok) {
      setGlobalSkills(await res.json());
      setManualContent('');
      setShowManual(false);
    }
  };

  const handleDeleteGlobalSkill = async (id: string) => {
    if (!confirm('确定要从全局技能池中永久移除此技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/${id}`, { method: 'DELETE' });
    if (res.ok) setGlobalSkills(await res.json());
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
          <Button variant="outline" onClick={() => { setShowGlobalModels(!showGlobalModels); setShowGlobalSkills(false); }} icon={Settings}>全局模型管理</Button>
          <Button variant="outline" onClick={() => { setShowGlobalSkills(!showGlobalSkills); setShowGlobalModels(false); }} icon={Puzzle}>全局技能管理</Button>
          <Button variant="outline" onClick={() => setShowImportProject(true)} icon={Download}>导入项目</Button>
          <Button onClick={() => setShowCreateProject(true)} icon={Plus}>创建新项目</Button>
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

      {showGlobalSkills && (
        <Card className="p-10 border-primary-100 bg-white shadow-2xl relative animate-in zoom-in-95 duration-200 rounded-[32px]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-black text-slate-900">全局技能池配置</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  placeholder="搜索技能名称..."
                  className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-primary-400 transition-all w-64"
                  value={skillSearchQuery}
                  onChange={e => setSkillSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" icon={FileText} onClick={() => setShowManual(true)}>手动导入</Button>
            </div>
          </div>

          <Card className="p-6 border-indigo-100 bg-gradient-to-r from-white to-indigo-50/20 shadow-sm rounded-3xl mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-700">导入 Skill (文件 URL 或 仓库)</h3>
              </div>
              <a href="https://clawhub.ai/skills?sort=downloads&nonSuspicious=true" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-800 transition-colors bg-white px-2.5 py-1 rounded-lg border border-indigo-100 shadow-sm">浏览 ClawHub <ExternalLink className="h-3 w-3" /></a>
            </div>
            <div className="flex flex-col gap-3">
              <input
                className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-100 text-xs font-mono font-bold text-slate-600 shadow-inner"
                placeholder="粘贴 GitHub SKILL.md 文件链接"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
              />
              <div className="flex gap-3">
                <Button onClick={() => handleImportSkill('direct')} disabled={importing || !importUrl} icon={Download} className="flex-1">{importing ? '解析中...' : '解析文件链接'}</Button>
                <Button variant="outline" onClick={() => handleImportSkill('zip')} disabled={importing || !importUrl} icon={FolderOpen} className="flex-1">{importing ? '探测中...' : '整库 ZIP 导入'}</Button>
              </div>
            </div>
          </Card>

          {showManual && (
            <Card className="p-6 border-primary-100 bg-primary-50/5 rounded-3xl mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">粘贴 SKILL.MD 内容</h3>
                <button onClick={() => setShowManual(false)}><X className="h-5 w-5 text-slate-400 hover:text-slate-600" /></button>
              </div>
              <textarea
                className="w-full h-52 p-4 rounded-2xl bg-white border border-slate-200 outline-none focus:border-primary-400 font-mono text-xs shadow-inner"
                placeholder="在此粘贴 Markdown 文本..."
                value={manualContent}
                onChange={e => setManualContent(e.target.value)}
              />
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowManual(false)}>取消</Button>
                <Button onClick={handleManualSkillSave}>保存导入</Button>
              </div>
            </Card>
          )}

          <div className="grid gap-3 max-h-[500px] overflow-y-auto pr-2">
            {filteredGlobalSkills.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm font-bold uppercase italic tracking-widest bg-slate-50 rounded-3xl border border-dashed">无匹配技能</div>
            ) : filteredGlobalSkills.map((skill: any) => (
              <div key={skill.id} className="p-5 rounded-3xl border border-slate-100 bg-slate-50/30 flex items-center justify-between group hover:border-primary-200 hover:bg-white transition-all">
                <div className="flex items-center gap-5 flex-1 min-w-0">
                  <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 group-hover:bg-primary-50 transition-colors flex-shrink-0"><Puzzle className="h-5 w-5 text-primary-600" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3"><h3 className="text-sm font-black text-slate-900 truncate">{skill.name}</h3></div>
                    <div className="mt-1 text-[11px] text-slate-500 truncate">{skill.description}</div>
                  </div>
                </div>
                <button onClick={() => handleDeleteGlobalSkill(skill.id)} className="ml-4 text-rose-400 hover:text-rose-600 p-2 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {showCreateProject && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-3xl bg-white border-0 rounded-[28px] relative">
            <button onClick={() => setShowCreateProject(false)} className="absolute right-6 top-6 p-2 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            <h3 className="text-xl font-black text-slate-900 mb-6">创建新项目</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">项目名称</label>
                <input className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400" value={newProjectForm.name} onChange={e => setNewProjectForm({ ...newProjectForm, name: e.target.value })} placeholder="例如：my-openclaw" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">项目描述</label>
                <textarea className="w-full h-24 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400" value={newProjectForm.description} onChange={e => setNewProjectForm({ ...newProjectForm, description: e.target.value })} placeholder="可选" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">父目录</label>
                <input className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400 font-mono text-xs" value={newProjectForm.parentDir} onChange={e => setNewProjectForm({ ...newProjectForm, parentDir: e.target.value })} placeholder="/mnt/d/workspace" />
              </div>
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowCreateProject(false)}>取消</Button>
              <Button onClick={handleCreateProject} disabled={creatingProject}>{creatingProject ? '创建中...' : '创建'}</Button>
            </div>
          </Card>
        </div>
      )}

      {showImportProject && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-3xl bg-white border-0 rounded-[28px] relative">
            <button onClick={() => setShowImportProject(false)} className="absolute right-6 top-6 p-2 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            <h3 className="text-xl font-black text-slate-900 mb-6">导入已有项目</h3>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">项目目录</label>
                <div className="flex gap-2">
                  <input className="flex-1 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400 font-mono text-xs" value={importProjectForm.workspace} onChange={e => setImportProjectForm({ ...importProjectForm, workspace: e.target.value })} placeholder="/mnt/d/workspace/my-openclaw" />
                  <Button variant="outline" onClick={openFolderPicker} icon={FolderOpen}>浏览</Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">项目名称（可选）</label>
                <input className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400" value={importProjectForm.name} onChange={e => setImportProjectForm({ ...importProjectForm, name: e.target.value })} placeholder="留空则自动取目录名" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400">描述（可选）</label>
                <textarea className="w-full h-24 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 outline-none focus:border-primary-400" value={importProjectForm.description} onChange={e => setImportProjectForm({ ...importProjectForm, description: e.target.value })} placeholder="可选" />
              </div>
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowImportProject(false)}>取消</Button>
              <Button onClick={handleImportProject} disabled={importingProject}>{importingProject ? '导入中...' : '导入'}</Button>
            </div>
          </Card>
        </div>
      )}

      {showFolderPicker && (
        <div className="fixed inset-0 z-[110] bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full p-6 shadow-3xl bg-white border-0 rounded-[24px] relative">
            <button onClick={() => setShowFolderPicker(false)} className="absolute right-5 top-5 p-2 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            <h3 className="text-lg font-black text-slate-900 mb-4">选择项目文件夹</h3>

            <div className="mb-3 p-3 bg-slate-50 border border-slate-100 rounded-xl font-mono text-xs text-slate-600 break-all">{pickerPath}</div>

            <div className="flex items-center gap-2 mb-3">
              <Button variant="outline" onClick={() => pickerParentPath && loadDirectories(pickerParentPath)} disabled={!pickerParentPath}>返回上级</Button>
              <Button variant="outline" onClick={() => loadDirectories(pickerPath)} disabled={pickerLoading}>{pickerLoading ? '刷新中...' : '刷新'}</Button>
              <div className="ml-auto">
                <Button onClick={() => {
                  setImportProjectForm(prev => ({ ...prev, workspace: pickerPath }));
                  setShowFolderPicker(false);
                }}>选择当前目录</Button>
              </div>
            </div>

            <div className="max-h-[380px] overflow-y-auto border border-slate-100 rounded-2xl divide-y divide-slate-100">
              {pickerDirs.length === 0 ? (
                <div className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">{pickerLoading ? '读取中...' : '当前目录无子文件夹'}</div>
              ) : pickerDirs.map((d: any) => (
                <button
                  key={d.path}
                  onClick={() => loadDirectories(d.path)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-center gap-2"
                >
                  <FolderOpen className="h-4 w-4 text-primary-600" />
                  <span className="text-sm font-bold text-slate-700">{d.name}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
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
