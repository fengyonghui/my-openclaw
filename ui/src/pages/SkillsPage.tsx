import { Zap, Puzzle, Download, Trash2, CheckCircle2, Search, Info, ExternalLink, Globe, Plus, X, FileText, Box, Lock, Unlock, Save, Sparkles, Wrench, Shield, Package } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function SkillsPage({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const [allGlobalSkills, setAllGlobalSkills] = useState<any[]>([]);
  const [projectData, setProjectData] = useState<any>(null);
  const [projectPrivateSkills, setProjectPrivateSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 项目私有技能相关状态
  const [showAddPrivate, setShowAddPrivate] = useState(false);
  const [privateSkillForm, setPrivateSkillForm] = useState({ name: '', description: '', content: '' });
  const [savingPrivate, setSavingPrivate] = useState(false);
  
  // 全局技能相关状态
  const [showAddGlobal, setShowAddGlobal] = useState(false);
  const [globalSkillForm, setGlobalSkillForm] = useState({ name: '', description: '', content: '' });
  const [globalSkillUrl, setGlobalSkillUrl] = useState('');
  const [importingFromUrl, setImportingFromUrl] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);

  // 动画状态
  const [mounted, setMounted] = useState(false);

  const fetchData = async () => {
    if (!projectId) {
      try {
        const res = await fetch('http://localhost:3001/api/v1/skills');
        setAllGlobalSkills(await res.json());
      } catch (err) { console.error(err); }
      setLoading(false);
      return;
    }
    
    try {
      const [skillsRes, projectRes, privateRes] = await Promise.all([
        fetch('http://localhost:3001/api/v1/skills'),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/private`)
      ]);
      setAllGlobalSkills(await skillsRes.json());
      setProjectData(await projectRes.json());
      setProjectPrivateSkills(await privateRes.json());
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { 
    fetchData();
    setTimeout(() => setMounted(true), 100);
  }, [projectId]);

  const isProjectMode = Boolean(projectId);
  const enabledGlobalSkillIds = projectData?.enabledSkillIds || [];
  
  const enabledSkills = useMemo(() => {
    const enabled = allGlobalSkills.filter(s => enabledGlobalSkillIds.includes(s.id));
    return [...enabled, ...projectPrivateSkills];
  }, [allGlobalSkills, enabledGlobalSkillIds, projectPrivateSkills]);

  const filteredGlobalSkills = useMemo(() => {
    return allGlobalSkills.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allGlobalSkills, searchQuery]);

  const toggleGlobalSkill = async (skillId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId })
    });
    if (res.ok) {
      const newEnabledIds = await res.json();
      setProjectData({ ...projectData, enabledSkillIds: newEnabledIds });
      onSaved?.();
    }
  };

  const handleDeleteGlobal = async (id: string) => {
    if (!confirm('确定要从全局技能池中永久移除此技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/${id}`, { method: 'DELETE' });
    if (res.ok) setAllGlobalSkills(await res.json());
  };

  const handleAddPrivateSkill = async () => {
    if (!privateSkillForm.name.trim() || !privateSkillForm.content.trim()) {
      alert('请填写技能名称和内容');
      return;
    }
    setSavingPrivate(true);
    try {
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: privateSkillForm.name.trim(),
          description: privateSkillForm.description.trim(),
          rawContent: privateSkillForm.content.trim(),
          content: privateSkillForm.content.trim()
        })
      });
      if (res.ok) {
        setProjectPrivateSkills(await res.json());
        setShowAddPrivate(false);
        setPrivateSkillForm({ name: '', description: '', content: '' });
      }
    } catch (err) { alert('添加失败'); }
    setSavingPrivate(false);
  };

  const handleDeletePrivateSkill = async (skillId: string) => {
    if (!confirm('确定要删除此项目私有技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/private/${skillId}`, {
      method: 'DELETE'
    });
    if (res.ok) setProjectPrivateSkills(await res.json());
  };

  // 添加全局技能
  const handleAddGlobalSkill = async () => {
    if (!globalSkillForm.name.trim() || !globalSkillForm.content.trim()) {
      alert('请填写技能名称和内容');
      return;
    }
    setSavingGlobal(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: globalSkillForm.name.trim(),
          description: globalSkillForm.description.trim(),
          rawContent: globalSkillForm.content.trim(),
          content: globalSkillForm.content.trim()
        })
      });
      if (res.ok) {
        setAllGlobalSkills(await res.json());
        setShowAddGlobal(false);
        setGlobalSkillForm({ name: '', description: '', content: '' });
      }
    } catch (err) { alert('添加失败'); }
    setSavingGlobal(false);
  };

  // 从 URL 导入技能
  const handleImportFromUrl = async () => {
    if (!globalSkillUrl.trim()) {
      alert('请输入技能 URL');
      return;
    }
    setImportingFromUrl(true);
    try {
      const res = await fetch('http://localhost:3001/api/v1/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: globalSkillUrl.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setAllGlobalSkills(data);
        setShowAddGlobal(false);
        setGlobalSkillUrl('');
      } else {
        alert(`导入失败: ${data.error || '未知错误'}`);
      }
    } catch (err) { 
      alert('导入失败，请检查 URL 是否正确'); 
    }
    setImportingFromUrl(false);
  };

  if (loading) return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30" />
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute h-px bg-gradient-to-r from-transparent via-indigo-200/40 to-transparent"
            style={{ top: `${15 + i * 15}%`, animation: `scanline 3s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
      </div>
      <div className="relative flex items-center justify-center h-[70vh]">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse opacity-20" />
            <div className="absolute inset-2 rounded-xl bg-white shadow-lg shadow-indigo-500/20 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-indigo-500 animate-spin" style={{ animationDuration: '3s' }} />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 tracking-wide">{isProjectMode ? '加载项目技能中...' : '同步技能中...'}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen w-full overflow-hidden pb-20">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40" />
      <div className="absolute inset-0 opacity-[0.015]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #1e1b4b 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-100/50 to-purple-100/30 blur-3xl transform translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-20 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-tr from-cyan-100/40 to-blue-100/20 blur-3xl transform -translate-x-1/2" />
      
      {/* Header */}
      <div className={`relative pt-12 px-8 pb-8 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold tracking-wide">
                <Package className="w-3.5 h-3.5" />
                {isProjectMode ? '项目配置' : '全局管理'}
              </div>
              <h1 className="text-5xl font-black tracking-tight text-slate-900">
                <span className="bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 bg-clip-text">
                  {isProjectMode ? '项目技能' : '技能中心'}
                </span>
              </h1>
              <p className="text-base text-slate-500 font-medium max-w-xl leading-relaxed">
                {isProjectMode 
                  ? `当前项目已启用 ${enabledSkills.length} 个技能，构建强大的 AI 工作流`
                  : '扩展成员能力边界：支持 GitHub 文件链接、ZIP 包导入或手动创建'}
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
              {/* 全局添加按钮 */}
              <button
                onClick={() => setShowAddGlobal(true)}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
              >
                <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                <Plus className="w-4 h-4 relative" />
                <span className="relative">添加技能</span>
              </button>
              
              {isProjectMode && (
                <button
                  onClick={() => setShowAddPrivate(true)}
                  className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm shadow-lg shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Lock className="w-4 h-4 relative" />
                  <span className="relative">添加私有技能</span>
                </button>
              )}
              
              <div className="relative group">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl opacity-0 group-focus-within:opacity-100 transition duration-300" />
                <div className="relative flex items-center bg-white rounded-2xl border border-slate-200/80 shadow-sm">
                  <Search className="w-4 h-4 text-slate-400 ml-4" />
                  <input 
                    placeholder="搜索技能..." 
                    className="w-64 px-4 py-3 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Stats Bar */}
          <div className="mt-8 flex flex-wrap gap-4">
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">{enabledSkills.length} 个已启用</span>
            </div>
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white border border-slate-200/60 shadow-sm">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-sm font-semibold text-slate-700">{allGlobalSkills.length} 个全局技能</span>
            </div>
            {isProjectMode && projectPrivateSkills.length > 0 && (
              <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-amber-50 border border-amber-200/60">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-sm font-semibold text-amber-700">{projectPrivateSkills.length} 个私有技能</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative px-8 max-w-7xl mx-auto">
        
        {/* 项目私有技能（项目模式） */}
        {isProjectMode && projectPrivateSkills.length > 0 && (
          <section className={`mb-12 transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/25">
                <Lock className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">项目私有技能</h2>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{projectPrivateSkills.length}</span>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projectPrivateSkills.map((skill, idx) => (
                <div 
                  key={skill.id}
                  className="group relative rounded-3xl p-6 bg-gradient-to-br from-amber-50/80 to-orange-50/40 border border-amber-200/50 hover:border-amber-300 transition-all duration-300 hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-1"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg">
                      <Zap className="w-5 h-5" />
                    </div>
                    <button 
                      onClick={() => handleDeletePrivateSkill(skill.id)}
                      className="p-2 rounded-xl text-slate-300 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all duration-200"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{skill.name}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{skill.description}</p>
                  
                  <div className="mt-4 pt-4 border-t border-amber-200/50">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                      <Lock className="w-3 h-3" />
                      仅当前项目可用
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 已启用的技能 */}
        {isProjectMode && enabledSkills.length > 0 && (
          <section className={`mb-12 transition-all duration-700 delay-200 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
                <CheckCircle2 className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">已启用的技能</h2>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">{enabledSkills.length}</span>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {enabledSkills.map((skill, idx) => (
                <div 
                  key={skill.id}
                  className="group relative rounded-3xl p-6 bg-gradient-to-br from-emerald-50/80 to-teal-50/40 border border-emerald-200/50 hover:border-emerald-300 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-1"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg">
                      <Zap className="w-5 h-5" />
                    </div>
                    {skill.isPrivate && (
                      <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 text-[10px] font-bold">私有</span>
                    )}
                  </div>
                  
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{skill.name}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{skill.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 全局技能网格 */}
        <section className={`transition-all duration-700 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">全局技能库</h2>
            <span className="px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">{filteredGlobalSkills.length}</span>
          </div>
          
          {filteredGlobalSkills.length === 0 ? (
            <div className="text-center py-16 rounded-3xl bg-slate-50/50 border border-slate-200/50">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">没有找到匹配的技能</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredGlobalSkills.map((skill, idx) => {
                const isEnabled = enabledGlobalSkillIds.includes(skill.id);
                return (
                  <div 
                    key={skill.id}
                    className={`group relative rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 ${
                      isEnabled 
                        ? 'bg-gradient-to-br from-indigo-50/80 to-purple-50/40 border-2 border-indigo-400/50 shadow-lg shadow-indigo-500/10' 
                        : 'bg-white border border-slate-200/60 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/5'
                    }`}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    {/* 状态指示 */}
                    {isEnabled && (
                      <div className="absolute top-4 right-4">
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          ACTIVE
                        </div>
                      </div>
                    )}
                    
                    {/* 图标 */}
                    <div className={`p-3 rounded-2xl mb-4 transition-all duration-300 ${
                      isEnabled 
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/30' 
                        : 'bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600'
                    }`}>
                      <Zap className="w-6 h-6" />
                    </div>
                    
                    {/* 内容 */}
                    <h3 className="text-xl font-bold text-slate-900 mb-2 pr-16">{skill.name}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4 min-h-[48px]">{skill.description}</p>
                    
                    {/* 操作区域 */}
                    {isProjectMode ? (
                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <button
                          onClick={() => toggleGlobalSkill(skill.id)}
                          className={`px-5 py-2 rounded-xl font-bold text-sm transition-all duration-200 ${
                            isEnabled 
                              ? 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-600 border border-slate-200' 
                              : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25'
                          }`}
                        >
                          {isEnabled ? '禁用' : '启用'}
                        </button>
                        {skill.url !== 'local://manual' && (
                          <a 
                            href={skill.url} 
                            target="_blank" 
                            rel="noreferrer"
                            className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <div className="pt-4 border-t border-slate-100">
                        <p className="text-xs text-slate-400 font-medium">在项目中启用此技能</p>
                        <button 
                          onClick={() => handleDeleteGlobal(skill.id)}
                          className="mt-2 p-2 rounded-xl text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 添加全局技能弹窗 */}
      {showAddGlobal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddGlobal(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* 弹窗头部 */}
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-b border-indigo-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-indigo-200/30 to-purple-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">添加全局技能</h2>
                    <p className="text-sm text-slate-500 mt-0.5">所有项目都可以使用此技能</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAddGlobal(false)} 
                  className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* 弹窗内容 */}
            <div className="px-8 pb-8 space-y-6">
              {/* URL 导入 */}
              <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-indigo-600 uppercase tracking-wider">从 URL 导入技能</label>
                  <a
                    href="https://clawhub.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-600 text-xs font-semibold hover:bg-indigo-100 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    浏览 ClawHub
                  </a>
                </div>
                <div className="flex gap-3">
                  <input 
                    type="url" 
                    className="flex-1 px-4 py-3 rounded-xl bg-white border border-indigo-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-medium"
                    placeholder="例如: https://clawhub.ai/skills/xxx"
                    value={globalSkillUrl} 
                    onChange={e => setGlobalSkillUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleImportFromUrl()}
                  />
                  <button 
                    onClick={handleImportFromUrl}
                    disabled={importingFromUrl}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                  >
                    {importingFromUrl ? '导入中...' : '导入'}
                  </button>
                </div>
              </div>
              
              {/* 分隔线 */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">或手动添加</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              
              {/* 手动添加 */}
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">技能名称 <span className="text-rose-500">*</span></label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-medium"
                    placeholder="例如：我的自定义技能"
                    value={globalSkillForm.name} 
                    onChange={e => setGlobalSkillForm({...globalSkillForm, name: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-medium"
                    placeholder="技能功能描述"
                    value={globalSkillForm.description} 
                    onChange={e => setGlobalSkillForm({...globalSkillForm, description: e.target.value})} 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">技能内容 (SKILL.md) <span className="text-rose-500">*</span></label>
                <textarea 
                  className="w-full h-64 p-5 rounded-xl bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 outline-none transition-all font-mono text-sm resize-none"
                  placeholder="在此粘贴技能 Markdown 内容..."
                  value={globalSkillForm.content} 
                  onChange={e => setGlobalSkillForm({...globalSkillForm, content: e.target.value})} 
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => setShowAddGlobal(false)}
                  className="px-6 py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={handleAddGlobalSkill}
                  disabled={savingGlobal}
                  className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all disabled:opacity-50"
                >
                  {savingGlobal ? '保存中...' : '保存技能'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 添加私有技能弹窗 */}
      {showAddPrivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddPrivate(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden">
            {/* 弹窗头部 */}
            <div className="relative px-8 pt-8 pb-6 bg-gradient-to-br from-amber-50 to-orange-50 border-b border-amber-100">
              <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-amber-200/30 to-orange-200/20 rounded-full blur-2xl transform translate-x-1/2 -translate-y-1/2" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/25">
                    <Lock className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">添加项目私有技能</h2>
                    <p className="text-sm text-slate-500 mt-0.5">仅当前项目可用，不会影响其他项目</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowAddPrivate(false)} 
                  className="p-2 rounded-xl hover:bg-white/50 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* 弹窗内容 */}
            <div className="px-8 pb-8 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">技能名称 <span className="text-rose-500">*</span></label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-50 outline-none transition-all font-medium"
                    placeholder="例如：我的自定义技能"
                    value={privateSkillForm.name} 
                    onChange={e => setPrivateSkillForm({...privateSkillForm, name: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">描述</label>
                  <input 
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-50 outline-none transition-all font-medium"
                    placeholder="技能功能描述"
                    value={privateSkillForm.description} 
                    onChange={e => setPrivateSkillForm({...privateSkillForm, description: e.target.value})} 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">技能内容 (SKILL.md) <span className="text-rose-500">*</span></label>
                <textarea 
                  className="w-full h-64 p-5 rounded-xl bg-slate-50 border border-slate-200 focus:border-amber-400 focus:ring-4 focus:ring-amber-50 outline-none transition-all font-mono text-sm resize-none"
                  placeholder="在此粘贴技能 Markdown 内容..."
                  value={privateSkillForm.content} 
                  onChange={e => setPrivateSkillForm({...privateSkillForm, content: e.target.value})} 
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <button 
                  onClick={() => setShowAddPrivate(false)}
                  className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleAddPrivateSkill}
                  disabled={savingPrivate}
                  className="group relative px-6 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-amber-500/30"
                >
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <span className="relative flex items-center gap-2">
                    <Save className="w-4 h-4" />
                    {savingPrivate ? '保存中...' : '保存私有技能'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全局动画样式 */}
      <style>{`
        @keyframes scanline {
          0%, 100% { opacity: 0.3; transform: translateX(-100%); }
          50% { opacity: 0.6; transform: translateX(100%); }
        }
        
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes glow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        
        .animate-glow {
          animation: glow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
