import { FolderPlus, FolderOpen, ArrowRight, Settings, Plus, Trash2, Cpu, Save, Search, Check, Square, CheckSquare, X, Globe, Puzzle, Download, FileText, ExternalLink, Edit3, Eye, EyeOff, ArrowLeft, Bot, Sparkles, Grid3X3, Layers, Star, Rocket, ChevronRight } from 'lucide-react';
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
  const [mounted, setMounted] = useState(false);

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
    setTimeout(() => setMounted(true), 100);
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => 
      p.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(projectSearchQuery.toLowerCase()))
    );
  }, [projects, projectSearchQuery]);

  const getModelName = (id: string) => {
    const model = globalModels.find(m => m.id === id || m.modelId === id);
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

  if (loading) return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />
      <div className="relative flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse opacity-20" />
            <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <FolderOpen className="w-8 h-8 text-indigo-500 animate-bounce" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 tracking-wide">加载项目中...</p>
        </div>
      </div>
    </div>
  );

  // 渲染项目列表视图
  const renderProjectsView = () => (
    <div className="relative min-h-screen w-full overflow-hidden pb-20">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40" />
      <div className="absolute inset-0 opacity-[0.015]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #1e1b4b 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-100/60 via-purple-100/40 to-pink-100/30 blur-3xl transform translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-20 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-cyan-100/40 to-blue-100/20 blur-3xl transform -translate-x-1/2" />

      {/* Hero Section - Two Row Layout */}
      <div className={`relative pt-8 px-8 pb-6 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          
          {/* Logo + Title */}
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 blur-lg opacity-30" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <Layers className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-black text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-indigo-900 to-purple-900 bg-clip-text">
                  My-OpenClaw
                </span>
              </h1>
              <p className="text-sm text-slate-500 font-medium">智能协作平台</p>
            </div>
          </div>

          {/* Row 1: Global Management Links */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <button
              onClick={() => navigateTo('globalModels')}
              className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50 font-medium text-sm text-slate-600 hover:border-cyan-300 hover:bg-cyan-50/50 transition-all shadow-sm"
            >
              <Cpu className="w-5 h-5 text-cyan-500" />
              <span>模型管理</span>
            </button>
            <button
              onClick={() => navigateTo('globalSkills')}
              className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50 font-medium text-sm text-slate-600 hover:border-violet-300 hover:bg-violet-50/50 transition-all shadow-sm"
            >
              <Puzzle className="w-5 h-5 text-violet-500" />
              <span>技能管理</span>
            </button>
            <button
              onClick={() => navigateTo('globalAgents')}
              className="group inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50 font-medium text-sm text-slate-600 hover:border-amber-300 hover:bg-amber-50/50 transition-all shadow-sm"
            >
              <Bot className="w-5 h-5 text-amber-500" />
              <span>Agent管理</span>
            </button>
          </div>

          {/* Row 2: All Elements Centered */}
          <div className="flex items-center justify-center gap-3">
            {/* Search - Wider */}
            <div className="relative flex-1 max-w-sm">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-xl blur opacity-0 focus-within:opacity-100 transition" />
              <div className="relative flex items-center bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200/50 shadow-sm">
                <Search className="w-4 h-4 text-slate-400 ml-4" />
                <input
                  placeholder="搜索项目..."
                  className="flex-1 px-4 py-3 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                  value={projectSearchQuery}
                  onChange={e => setProjectSearchQuery(e.target.value)}
                />
                {projectSearchQuery && (
                  <button onClick={() => setProjectSearchQuery('')} className="mr-3 p-1 hover:bg-slate-100 rounded-lg transition">
                    <X className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </div>
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100/50 shadow-sm">
              <Layers className="w-5 h-5 text-indigo-500" />
              <span className="text-lg font-black text-slate-700">{projects.length}</span>
              <span className="text-sm text-slate-500 font-medium">项目</span>
            </div>

            {/* Spacer */}
            <div style={{ width: '12px' }} />

            {/* Actions */}
            <button
              onClick={() => setShowImportProject(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200/80 text-slate-600 font-bold text-sm hover:border-indigo-300 hover:bg-indigo-50/50 transition-all shadow-sm"
            >
              <Download className="w-4 h-4 text-indigo-500" />
              <span>导入项目</span>
            </button>
            <button
              onClick={() => setShowCreateProject(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>新建项目</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search & Projects */}
      <div className={`relative px-8 max-w-7xl mx-auto transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        
        {/* Projects Grid */}
        {filteredProjects.length === 0 ? (
          <div className="text-center py-24 rounded-3xl bg-gradient-to-br from-slate-50/80 to-white border border-slate-200/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-100/30 to-purple-100/20 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
            <div className="relative">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200" />
                <div className="absolute inset-0 rounded-3xl bg-white shadow-lg flex items-center justify-center">
                  <FolderOpen className="w-12 h-12 text-slate-300" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-600 mb-2">
                {projectSearchQuery ? '未找到匹配的项目' : '还没有项目'}
              </h3>
              <p className="text-slate-500 mb-8 max-w-md mx-auto">
                {projectSearchQuery ? '尝试其他关键词' : '创建一个新项目开始你的 AI 协作之旅'}
              </p>
              {!projectSearchQuery && (
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5" />
                  创建第一个项目
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 pb-10">
            {filteredProjects.map((project, idx) => (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectProject(project.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProject(project.id); } }}
                className="group text-left cursor-pointer"
                style={{ animationDelay: `${idx * 80}ms` }}
              >
                <div className="relative p-7 rounded-3xl bg-white/80 backdrop-blur-sm border border-slate-200/50 shadow-sm hover:shadow-2xl hover:border-indigo-200/50 transition-all duration-300 hover:-translate-y-2 overflow-hidden">
                  {/* Hover Glow */}
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  {/* Decorative Orb */}
                  <div className="absolute -top-6 -right-6 w-24 h-24 bg-gradient-to-br from-indigo-100/50 to-purple-100/30 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="relative">
                    {/* Icon & Title */}
                    <div className="flex items-start justify-between mb-5">
                      <div className="relative">
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 blur-lg opacity-0 group-hover:opacity-50 transition-opacity" />
                        <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center group-hover:from-indigo-500 group-hover:to-purple-600 group-hover:shadow-lg transition-all duration-300">
                          <FolderOpen className="w-7 h-7 text-indigo-600 group-hover:text-white transition-colors" />
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDeleteProject(e, project.id)}
                        className="p-2.5 rounded-xl text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    
                    <h3 className="text-xl font-black text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed line-clamp-2 mb-5">
                      {project.description || '暂无描述'}
                    </p>
                    
                    {/* Meta Info */}
                    <div className="flex items-center gap-3 pt-4 border-t border-slate-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">默认模型</p>
                        <p className="text-sm font-bold text-slate-700 truncate">{getModelName(project.defaultModel)}</p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center group-hover:from-indigo-500 group-hover:to-purple-600 transition-all duration-300">
                        <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowCreateProject(false)} />
          <div className="relative z-10 w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-b border-indigo-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-indigo-200/30 to-purple-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">创建新项目</h2>
                    <p className="text-sm text-slate-500 mt-0.5">开始新的 AI 协作空间</p>
                  </div>
                </div>
                <button onClick={() => setShowCreateProject(false)} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="px-8 py-6 space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">项目名称 <span className="text-rose-500">*</span></label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm font-semibold"
                  placeholder="例如：my-openclaw"
                  value={newProjectForm.name}
                  onChange={e => setNewProjectForm({ ...newProjectForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">项目描述</label>
                <textarea
                  className="w-full h-24 px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm font-medium resize-none"
                  placeholder="描述你的项目..."
                  value={newProjectForm.description}
                  onChange={e => setNewProjectForm({ ...newProjectForm, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">父目录</label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-sm font-mono"
                  placeholder="/mnt/d/workspace"
                  value={newProjectForm.parentDir}
                  onChange={e => setNewProjectForm({ ...newProjectForm, parentDir: e.target.value })}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3 px-8 py-6 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100">
              <button onClick={() => setShowCreateProject(false)} className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition">
                取消
              </button>
              <button
                onClick={handleCreateProject}
                disabled={creatingProject}
                className="group relative px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-indigo-500/30"
              >
                <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative flex items-center gap-2">
                  {creatingProject ? '创建中...' : '创建项目'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Project Modal */}
      {showImportProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowImportProject(false)} />
          <div className="relative z-10 w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-emerald-50 to-teal-50 border-b border-emerald-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-emerald-200/30 to-teal-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25">
                    <Download className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">导入已有项目</h2>
                    <p className="text-sm text-slate-500 mt-0.5">从本地目录导入项目</p>
                  </div>
                </div>
                <button onClick={() => setShowImportProject(false)} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="px-8 py-6 space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">项目目录 <span className="text-rose-500">*</span></label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 outline-none transition-all text-sm font-mono"
                    placeholder="/mnt/d/workspace/my-openclaw"
                    value={importProjectForm.workspace}
                    onChange={e => setImportProjectForm({ ...importProjectForm, workspace: e.target.value })}
                  />
                  <button
                    onClick={openFolderPicker}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-200 transition"
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">项目名称（可选）</label>
                <input
                  className="w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 outline-none transition-all text-sm font-semibold"
                  placeholder="留空则自动取目录名"
                  value={importProjectForm.name}
                  onChange={e => setImportProjectForm({ ...importProjectForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述（可选）</label>
                <textarea
                  className="w-full h-20 px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50 outline-none transition-all text-sm font-medium resize-none"
                  placeholder="描述你的项目..."
                  value={importProjectForm.description}
                  onChange={e => setImportProjectForm({ ...importProjectForm, description: e.target.value })}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-3 px-8 py-6 bg-gradient-to-r from-slate-50 to-white border-t border-slate-100">
              <button onClick={() => setShowImportProject(false)} className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition">
                取消
              </button>
              <button
                onClick={handleImportProject}
                disabled={importingProject}
                className="group relative px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-emerald-500/30"
              >
                <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative flex items-center gap-2">
                  {importingProject ? '导入中...' : '导入项目'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowFolderPicker(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-slate-50 to-slate-100 border-b border-slate-200">
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 text-white shadow-lg">
                    <FolderOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">选择项目文件夹</h2>
                    <p className="text-sm text-slate-500 mt-0.5">浏览并选择项目目录</p>
                  </div>
                </div>
                <button onClick={() => setShowFolderPicker(false)} className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="px-8 py-6">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 font-mono text-sm text-slate-600 break-all mb-4">
                {pickerPath}
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => pickerParentPath && loadDirectories(pickerParentPath)}
                  disabled={!pickerParentPath}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-1" />返回上级
                </button>
                <button
                  onClick={() => loadDirectories(pickerPath)}
                  disabled={pickerLoading}
                  className="px-4 py-2 rounded-xl bg-white border border-slate-200 font-bold text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  刷新
                </button>
                <button
                  onClick={() => {
                    setImportProjectForm(prev => ({ ...prev, workspace: pickerPath }));
                    setShowFolderPicker(false);
                  }}
                  className="ml-auto px-6 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl transition"
                >
                  选择当前目录
                </button>
              </div>
              
              <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100">
                {pickerDirs.length === 0 ? (
                  <div className="p-10 text-center text-slate-400 font-medium">
                    {pickerLoading ? '读取中...' : '当前目录无子文件夹'}
                  </div>
                ) : pickerDirs.map((d: any) => (
                  <button
                    key={d.path}
                    onClick={() => loadDirectories(d.path)}
                    className="w-full text-left px-5 py-4 hover:bg-indigo-50/50 transition-colors flex items-center gap-3"
                  >
                    <FolderOpen className="w-5 h-5 text-indigo-500" />
                    <span className="text-sm font-semibold text-slate-700">{d.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Styles */}
      <style>{`
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient {
          animation: gradient 6s ease infinite;
        }
      `}</style>
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