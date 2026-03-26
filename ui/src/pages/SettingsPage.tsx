import { Settings, Shield, Cpu, Save, Trash2, Layout, Bot, Globe, Users, Star, Plus, X, Sparkles, FolderOpen, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button } from '../components/ui';

export function SettingsPage({ projectId, onSaved }: { projectId: string, onSaved?: () => void }) {
  const [project, setProject] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [projectAgents, setProjectAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('basic');

  // 主协调 Agent 弹窗
  const [showCoordinatorModal, setShowCoordinatorModal] = useState(false);

  // 临时编辑状态
  const [editState, setEditState] = useState({
    name: '',
    description: '',
    defaultModel: '',
    workspace: ''
  });

  // 主协调 Agent 状态
  const [coordinatorAgentId, setCoordinatorAgentId] = useState<string | null>(null);

  // 新建私有 Agent
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: '', role: '', description: '' });

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const [pRes, mRes, aRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
          fetch(`http://localhost:3001/api/v1/models`),
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`)
        ]);
        const pData = await pRes.json();
        const mData = await mRes.json();
        const aData = await aRes.json();
        
        setProject(pData);
        setModels(mData);
        setProjectAgents(aData);
        setCoordinatorAgentId(pData.coordinatorAgentId || null);
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

  // 设置主协调 Agent
  const handleSetCoordinator = async (agentId: string | null) => {
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/coordinator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinatorAgentId: agentId })
      });
      if (res.ok) {
        const updated = await res.json();
        setProject(updated);
        setCoordinatorAgentId(updated.coordinatorAgentId);
        setShowCoordinatorModal(false);
      }
    } catch (err) { console.error(err); }
  };

  // 创建项目私有 Agent
  const handleCreatePrivateAgent = async () => {
    if (!newAgent.name.trim()) return;
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newAgent, isPrivate: true })
      });
      if (res.ok) {
        const agent = await res.json();
        setProjectAgents([...projectAgents, agent]);
        setNewAgent({ name: '', role: '', description: '' });
        setShowNewAgentModal(false);
      }
    } catch (err) { console.error(err); }
  };

  // 删除项目私有 Agent
  const handleDeletePrivateAgent = async (agentId: string) => {
    if (!confirm('确定删除此 Agent？')) return;
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents/private/${agentId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setProjectAgents(projectAgents.filter(a => a.id !== agentId));
      }
    } catch (err) { console.error(err); }
  };

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
        onSaved?.();
      }
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const coordinatorAgent = projectAgents.find(a => String(a.id) === String(coordinatorAgentId));

  const sections = [
    { id: 'basic', label: '基础配置', icon: Layout },
    { id: 'model', label: '模型设置', icon: Cpu },
    { id: 'team', label: '团队成员', icon: Users },
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50">
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
            <Button 
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200"
              icon={Save}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存更改'}
            </Button>
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
                    onChange={e => setEditState({...editState, name: e.target.value})}
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
                  onChange={e => setEditState({...editState, description: e.target.value})}
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
                    onChange={e => setEditState({...editState, workspace: e.target.value})}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">Agent 的工作目录，用于文件操作和代码管理</p>
              </div>
            </div>
          </Card>
        </div>

        {/* 模型设置 */}
        <div className={`space-y-6 transition-all ${activeSection !== 'model' ? 'hidden' : ''}`}>
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <Cpu className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">默认模型</h2>
              </div>
            </div>
            <div className="p-8">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider">选择模型</label>
                <select
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 text-slate-800 font-medium transition-all appearance-none cursor-pointer"
                  value={editState.defaultModel}
                  onChange={e => setEditState({...editState, defaultModel: e.target.value})}
                >
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-2">用于 Agent 推理的默认语言模型</p>
              </div>
            </div>
          </Card>
        </div>

        {/* 团队成员 */}
        <div className={`space-y-6 transition-all ${activeSection !== 'team' ? 'hidden' : ''}`}>
          {/* 主协调 Agent */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-6">
              <div className="flex items-center gap-3 text-white">
                <Sparkles className="h-5 w-5 opacity-80" />
                <h2 className="font-bold text-lg">主协调 Agent</h2>
              </div>
            </div>
            <div className="p-8">
              <p className="text-sm text-slate-500 mb-6">主协调 Agent 负责接收用户请求，协调团队成员完成任务</p>
              
              {coordinatorAgent ? (
                <div className="flex items-center justify-between p-6 bg-gradient-to-r from-violet-50 to-purple-50 rounded-2xl border border-violet-100">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-violet-200">
                      {coordinatorAgent.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-lg">{coordinatorAgent.name}</p>
                      <p className="text-sm text-slate-500">{coordinatorAgent.role || coordinatorAgent.description || '主协调者'}</p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="border-violet-300 text-violet-600 hover:bg-violet-600 hover:text-white"
                    icon={ChevronRight}
                    onClick={() => setShowCoordinatorModal(true)}
                  >
                    更换
                  </Button>
                </div>
              ) : (
                <div 
                  className="flex items-center justify-center p-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 cursor-pointer hover:border-violet-300 hover:bg-violet-50/50 transition-all"
                  onClick={() => setShowCoordinatorModal(true)}
                >
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-200 flex items-center justify-center">
                      <Star className="h-6 w-6 text-slate-400" />
                    </div>
                    <p className="font-medium text-slate-500">点击设置主协调 Agent</p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* 团队成员列表 */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  <Users className="h-5 w-5 opacity-80" />
                  <h2 className="font-bold text-lg">团队成员</h2>
                </div>
                <Button 
                  size="sm" 
                  className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm"
                  icon={Plus}
                  onClick={() => setShowNewAgentModal(true)}
                >
                  新建 Agent
                </Button>
              </div>
            </div>
            <div className="p-8">
              {projectAgents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {projectAgents.map(agent => (
                    <div 
                      key={agent.id} 
                      className={`p-5 rounded-2xl border transition-all ${
                        String(agent.id) === String(coordinatorAgentId) 
                          ? 'bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200' 
                          : 'bg-slate-50 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-md ${
                            String(agent.id) === String(coordinatorAgentId)
                              ? 'bg-gradient-to-br from-violet-500 to-purple-600'
                              : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                          }`}>
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{agent.name}</p>
                            <p className="text-xs text-slate-500">{agent.role || '成员'}</p>
                          </div>
                        </div>
                        {agent.isPrivate && (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-lg">私有</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">{agent.description || '暂无描述'}</p>
                      {agent.isPrivate && (
                        <div className="flex justify-end mt-3 pt-3 border-t border-slate-200">
                          <button
                            className="text-xs text-rose-500 hover:text-rose-600 font-medium"
                            onClick={() => handleDeletePrivateAgent(agent.id)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-slate-50 rounded-2xl">
                  <Users className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                  <p className="text-slate-500 font-medium">暂无团队成员</p>
                  <Button 
                    className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                    icon={Plus}
                    onClick={() => setShowNewAgentModal(true)}
                  >
                    添加第一个成员
                  </Button>
                </div>
              )}
            </div>
          </Card>
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

      {/* 设置主协调 Agent 弹窗 */}
      {showCoordinatorModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCoordinatorModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  <Star className="h-5 w-5" />
                  <h3 className="text-lg font-bold">设置主协调 Agent</h3>
                </div>
                <button className="p-2 hover:bg-white/20 rounded-xl transition-colors" onClick={() => setShowCoordinatorModal(false)}>
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
            
            <div className="p-8 space-y-3">
              <button
                className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                  !coordinatorAgentId ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => handleSetCoordinator(null)}
              >
                <div className="w-12 h-12 bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 font-black text-lg">?</div>
                <div className="text-left">
                  <p className="font-bold text-slate-900">不使用主协调</p>
                  <p className="text-xs text-slate-500">使用默认 Agent</p>
                </div>
              </button>
              
              {projectAgents.map(agent => (
                <button
                  key={agent.id}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                    String(agent.id) === String(coordinatorAgentId) ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                  onClick={() => handleSetCoordinator(agent.id)}
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-lg">
                    {agent.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-bold text-slate-900">{agent.name}</p>
                    <p className="text-xs text-slate-500">{agent.role || agent.description || '团队成员'}</p>
                  </div>
                  {String(agent.id) === String(coordinatorAgentId) && (
                    <span className="px-2 py-1 bg-violet-100 text-violet-700 text-[10px] font-bold rounded-lg">当前</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 新建私有 Agent 弹窗 */}
      {showNewAgentModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowNewAgentModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-white">
                  <Bot className="h-5 w-5" />
                  <h3 className="text-lg font-bold">新建项目 Agent</h3>
                </div>
                <button className="p-2 hover:bg-white/20 rounded-xl transition-colors" onClick={() => setShowNewAgentModal(false)}>
                  <X className="h-5 w-5 text-white" />
                </button>
              </div>
            </div>
            
            <div className="p-8 space-y-5">
              <div>
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider block mb-2">Agent 名称 *</label>
                <input
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 text-slate-800 font-medium transition-all"
                  placeholder="例如：前端工程师"
                  value={newAgent.name}
                  onChange={e => setNewAgent({...newAgent, name: e.target.value})}
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider block mb-2">角色</label>
                <input
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 text-slate-800 font-medium transition-all"
                  placeholder="例如：前端开发"
                  value={newAgent.role}
                  onChange={e => setNewAgent({...newAgent, role: e.target.value})}
                />
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400 tracking-wider block mb-2">描述</label>
                <textarea
                  className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-200 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 text-slate-800 font-medium min-h-[100px] resize-none transition-all"
                  placeholder="描述此 Agent 的职责和能力..."
                  value={newAgent.description}
                  onChange={e => setNewAgent({...newAgent, description: e.target.value})}
                />
              </div>
              
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowNewAgentModal(false)}>取消</Button>
                <Button 
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700" 
                  onClick={handleCreatePrivateAgent} 
                  disabled={!newAgent.name.trim()}
                >
                  创建
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
