import { FolderPlus, FolderOpen, ArrowRight, Settings, Plus, Trash2, Cpu, Save, Search, Check, Square, CheckSquare, X, Globe, Puzzle, Download, FileText, ExternalLink, Edit3, Eye, EyeOff, ArrowLeft, Bot } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';
import { SkillsPage } from './SkillsPage';
import { ModelsPage } from './ModelsPage';
import { GlobalAgentsPage } from './GlobalAgentsPage';

type ViewType = 'projects' | 'globalModels' | 'globalSkills' | 'globalAgents';

export function ProjectListPage({ onSelectProject }: { onSelectProject: (id: string) => void }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [globalModels, setGlobalModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<ViewType>('projects');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
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

  // 加载项目列表
  useEffect(() => {
    Promise.all([
      fetch('http://localhost:3001/api/v1/projects'),
      fetch('http://localhost:3001/api/v1/models')
    ]).then(async ([pRes, mRes]) => {
      setProjects(await pRes.json());
      setGlobalModels(await mRes.json());
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load data:', err);
      setLoading(false);
    });
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => 
      p.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(projectSearchQuery.toLowerCase()))
    );
  }, [projects, projectSearchQuery]);

  const getModelName = (id: string) => {
    const model = globalModels.find(m => m.id === id);
    return model ? model.name : id;
  };

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

  const navigateTo = (view: ViewType) => {
    setCurrentView(view);
    setProjectSearchQuery('');
  };

  if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">加载中...</div>;

  // 渲染项目列表视图
  const renderProjectsView = () => (
    <div className="max-w-6xl mx-auto space-y-12 py-12 px-6">
      {/* Header */}
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
          <Button variant="outline" onClick={() => navigateTo('globalModels')} icon={Settings}>全局模型管理</Button>
          <Button variant="outline" onClick={() => navigateTo('globalSkills')} icon={Puzzle}>全局技能管理</Button>
          <Button variant="outline" onClick={() => navigateTo('globalAgents')} icon={Bot}>全局Agent管理</Button>
          <Button variant="outline" onClick={() => setShowImportProject(true)} icon={Download}>导入项目</Button>
          <Button onClick={() => setShowCreateProject(true)} icon={Plus}>创建新项目</Button>
        </div>
      </div>

      {/* 项目列表 */}
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

      {/* 创建项目弹窗 */}
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

      {/* 导入项目弹窗 */}
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

      {/* 文件夹选择器 */}
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
    </div>
  );

  // 渲染全局模型管理视图
  const renderGlobalModelsView = () => (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" onClick={() => navigateTo('projects')} icon={ArrowLeft}>返回项目列表</Button>
        <h1 className="text-2xl font-black text-slate-900">全局模型管理</h1>
      </div>
      <ModelsPage />
    </div>
  );

  // 渲染全局技能管理视图
  const renderGlobalSkillsView = () => (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" onClick={() => navigateTo('projects')} icon={ArrowLeft}>返回项目列表</Button>
        <h1 className="text-2xl font-black text-slate-900">全局技能管理</h1>
      </div>
      <SkillsPage projectId="" />
    </div>
  );

  // 渲染全局Agent管理视图
  const renderGlobalAgentsView = () => (
    <div className="max-w-6xl mx-auto py-8 px-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="outline" onClick={() => navigateTo('projects')} icon={ArrowLeft}>返回项目列表</Button>
        <h1 className="text-2xl font-black text-slate-900">全局Agent管理</h1>
      </div>
      <GlobalAgentsPage />
    </div>
  );

  // 根据当前视图渲染
  switch (currentView) {
    case 'globalModels':
      return renderGlobalModelsView();
    case 'globalAgents':
      return renderGlobalAgentsView();
    case 'globalSkills':
      return renderGlobalSkillsView();
    default:
      return renderProjectsView();
  }
}