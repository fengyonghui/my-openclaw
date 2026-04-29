import { Settings, Shield, Cpu, Trash2, Layout, Globe, FolderOpen, ChevronRight, Search, ChevronDown, Wrench, CheckCircle2 } from 'lucide-react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, Button } from '../components/ui';
import { SkillsPage } from './SkillsPage';
import { AgentsPage } from './AgentsPage';

export function SettingsPage({ projectId, onSaved }: { projectId: string, onSaved?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('basic');
  const [savedMsg, setSavedMsg] = useState('');       // 自动保存提示
  const [isSaving, setIsSaving] = useState(false);

  // 临时编辑状态
  const [editState, setEditState] = useState({
    name: '',
    description: '',
    defaultModel: '',
    workspace: ''
  });

  // 自动保存防抖定时器
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 执行保存（基础配置 & 模型设置 共用）
  const persistEditState = async () => {
    try {
      setIsSaving(true);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editState)
      });
      if (res.ok) {
        setProject(await res.json());
        onSaved?.();
        setSavedMsg('已保存');
        setTimeout(() => setSavedMsg(''), 2000);
      }
    } catch (err) {
      console.error('[Settings] 保存失败', err);
      setSavedMsg('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 防抖自动保存（基础配置/模型设置切换时若有未保存变更则立即保存）
  const scheduleAutoSave = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(persistEditState, 600);
  };

  // 基础配置变更 -> 防抖保存
  const handleBasicChange = (patch: Partial<typeof editState>) => {
    setEditState(prev => ({ ...prev, ...patch }));
    scheduleAutoSave();
  };

  // 模型选择变更 -> 立即保存（无需等防抖，用户意图明确）
  const handleModelChange = (modelId: string) => {
    setEditState(prev => ({ ...prev, defaultModel: modelId }));
    // 立即触发保存
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    persistEditState();
  };

  // 默认模型搜索
  const [modelSearchOpen, setModelSearchOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const modelSearchRef = useRef<HTMLDivElement>(null);

  // 过滤模型列表
  const filteredModels = useMemo(() => {
    if (!modelSearchQuery.trim()) return models;
    const query = modelSearchQuery.toLowerCase();
    return models.filter(m =>
      m.name?.toLowerCase().includes(query) ||
      m.provider?.toLowerCase().includes(query) ||
      m.modelId?.toLowerCase().includes(query)
    );
  }, [models, modelSearchQuery]);

  // 点击外部关闭搜索下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelSearchRef.current && !modelSearchRef.current.contains(e.target as Node)) {
        setModelSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          workspace: pData.workspace || ''
        });
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    init();
  }, [projectId]);

  const sections = [
    { id: 'basic', label: '基础配置', icon: Layout },
    { id: 'model', label: '模型设置', icon: Cpu },
    { id: 'skills', label: '项目技能', icon: Wrench },
    { id: 'team', label: '团队成员', icon: FolderOpen },
    { id: 'danger', label: '危险操作', icon: Shield },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center animate-pulse shadow-xl shadow-indigo-200">
            <Settings className="h-8 w-8 text-white" />
          </div>
          <p className="text-slate-500 font-medium">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50 overflow-y-auto">
      {/* 顶部导航 */}
      <div className="bg-white/80 backdrop-blur-xl border-b border-slate-200/50 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <Settings className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">项目设置</h1>
                <p className="text-sm text-slate-500">{project?.name}</p>
              </div>
            </div>
            {/* 自动保存指示器 */}
            {isSaving && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-500 text-sm font-medium">
                <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                保存中...
              </div>
            )}
            {!isSaving && savedMsg && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold">
                <CheckCircle2 className="h-4 w-4" />
                {savedMsg}
              </div>
            )}
          </div>

          {/* 标签页导航 */}
          <div className="flex items-center gap-2 mt-6 -mb-4 overflow-x-auto pb-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all whitespace-nowrap ${
                    activeSection === section.id
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className={`space-y-6 transition-all ${activeSection !== 'basic' ? 'hidden' : ''}`}>
          {/* 项目基础信息 */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <Layout className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">项目信息</h2>
              </div>
            </div>
            <div className="p-8 space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">项目名称</label>
                  <input
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 text-slate-800 font-medium transition-all"
                    value={editState.name}
                    onChange={e => handleBasicChange({ name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">项目 ID</label>
                  <input
                    className="w-full px-5 py-4 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 font-mono text-sm"
                    value={project?.id}
                    readOnly
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">项目描述</label>
                  <textarea
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 text-slate-800 font-medium min-h-[120px] resize-none transition-all"
                    value={editState.description}
                    onChange={e => handleBasicChange({ description: e.target.value })}
                  />
              </div>
            </div>
          </Card>

          {/* 工作空间 */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <FolderOpen className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">工作空间</h2>
              </div>
            </div>
            <div className="p-8">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">物理路径</label>
                <div className="relative">
                  <Globe className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                  <input
                    className="w-full pl-14 pr-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100 text-slate-800 font-mono text-sm transition-all"
                    value={editState.workspace}
                    onChange={e => handleBasicChange({ workspace: e.target.value })}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">Agent 的工作目录，用于文件操作和代码管理</p>
              </div>
            </div>
          </Card>
        </div>

        {/* 模型设置 */}
        <div className={`space-y-6 transition-all ${activeSection !== 'model' ? 'hidden' : ''}`}>
          <Card className="overflow-visible">
            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <Cpu className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">默认模型</h2>
              </div>
            </div>
            <div className="p-8">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">选择模型</label>
                
                {/* 搜索下拉选择器 */}
                <div className="relative" ref={modelSearchRef}>
                  <div 
                    className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 text-slate-800 font-medium transition-all cursor-pointer flex items-center justify-between"
                    onClick={() => setModelSearchOpen(!modelSearchOpen)}
                  >
                    <span>{models.find(m => m.id === editState.defaultModel)?.name || '请选择模型'}</span>
                    <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${modelSearchOpen ? 'rotate-180' : ''}`} />
                  </div>
                  
                  {/* 下拉选项 */}
                  {modelSearchOpen && (
                    <div className="absolute z-50 w-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                      {/* 搜索框 */}
                      <div className="p-3 border-b border-slate-100" onClick={e => e.stopPropagation()}>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <input
                            type="text"
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 outline-none focus:border-cyan-500 text-sm font-medium"
                            placeholder="搜索模型..."
                            value={modelSearchQuery}
                            onChange={e => setModelSearchQuery(e.target.value)}
                            autoFocus
                          />
                        </div>
                      </div>
                      
                      {/* 选项列表 */}
                      <div className="max-h-96 overflow-y-auto">
                        {filteredModels.length > 0 ? (
                          filteredModels.map(m => (
                            <div
                              key={m.id}
                              className={`px-5 py-3 cursor-pointer flex items-center justify-between hover:bg-cyan-50 transition-colors ${
                                m.id === editState.defaultModel ? 'bg-cyan-50' : ''
                              }`}
                              onClick={() => {
                                handleModelChange(m.id);
                                setModelSearchOpen(false);
                                setModelSearchQuery('');
                              }}
                            >
                              <div>
                                <p className="font-medium text-slate-900">{m.name}</p>
                                <p className="text-xs text-slate-500">{m.provider} · {m.modelId}</p>
                              </div>
                              {m.id === editState.defaultModel && (
                                <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs font-bold rounded-lg">当前</span>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="px-5 py-8 text-center text-slate-400 text-sm">
                            未找到匹配的模型
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-slate-400 mt-2">用于 Agent 推理的默认语言模型</p>
              </div>
            </div>
          </Card>
        </div>

        {/* 团队成员 - Agent 管理 */}
        <div className={`transition-all ${activeSection !== 'team' ? 'hidden' : ''}`}>
          <AgentsPage projectId={projectId} />
        </div>

        {/* 项目技能 */}
        <div className={`space-y-6 transition-all ${activeSection !== 'skills' ? 'hidden' : ''}`}>
          <SkillsPage projectId={projectId} />
        </div>

        {/* 危险操作 */}
        <div className={`space-y-6 transition-all ${activeSection !== 'danger' ? 'hidden' : ''}`}>
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-rose-600 to-red-600 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <Shield className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">危险操作</h2>
              </div>
            </div>
            <div className="p-8">
              <p className="text-sm text-slate-500 mb-6">删除项目将永久移除所有数据，此操作不可恢复</p>
              <Button 
                variant="outline" 
                className="border-rose-300 text-rose-600 hover:bg-rose-600 hover:text-white"
                icon={Trash2}
              >
                删除当前项目
              </Button>
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}
