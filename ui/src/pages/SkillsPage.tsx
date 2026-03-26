import { Zap, Puzzle, Download, Trash2, CheckCircle2, Search, Info, ExternalLink, Globe, Plus, X, FileText, Box, Lock, Unlock, Save } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function SkillsPage({ projectId }: { projectId: string }) {
  const [allGlobalSkills, setAllGlobalSkills] = useState<any[]>([]);
  const [projectData, setProjectData] = useState<any>(null);
  const [projectPrivateSkills, setProjectPrivateSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 项目私有技能相关状态
  const [showAddPrivate, setShowAddPrivate] = useState(false);
  const [privateSkillForm, setPrivateSkillForm] = useState({ name: '', description: '', content: '' });
  const [savingPrivate, setSavingPrivate] = useState(false);

  const fetchData = async () => {
    if (!projectId) {
      // 全局技能页面模式 - 只加载全局技能
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

  useEffect(() => { fetchData(); }, [projectId]);

  // 判断是否为项目模式（有 projectId）
  const isProjectMode = Boolean(projectId);
  
  // 已启用的全局技能ID
  const enabledGlobalSkillIds = projectData?.enabledSkillIds || [];
  
  // 合并显示：启用的全局技能 + 项目私有技能
  const enabledSkills = useMemo(() => {
    const enabled = allGlobalSkills.filter(s => enabledGlobalSkillIds.includes(s.id));
    return [...enabled, ...projectPrivateSkills];
  }, [allGlobalSkills, enabledGlobalSkillIds, projectPrivateSkills]);

  // 过滤后的可用全局技能
  const filteredGlobalSkills = useMemo(() => {
    return allGlobalSkills.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allGlobalSkills, searchQuery]);

  // 切换全局技能
  const toggleGlobalSkill = async (skillId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId })
    });
    if (res.ok) {
      const newEnabledIds = await res.json();
      setProjectData({ ...projectData, enabledSkillIds: newEnabledIds });
    }
  };

  // 删除全局技能（仅全局页面可用）
  const handleDeleteGlobal = async (id: string) => {
    if (!confirm('确定要从全局技能池中永久移除此技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/${id}`, { method: 'DELETE' });
    if (res.ok) setAllGlobalSkills(await res.json());
  };

  // 添加项目私有技能
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

  // 删除项目私有技能
  const handleDeletePrivateSkill = async (skillId: string) => {
    if (!confirm('确定要删除此项目私有技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/private/${skillId}`, {
      method: 'DELETE'
    });
    if (res.ok) setProjectPrivateSkills(await res.json());
  };

  if (loading) return <div className="p-12 text-center text-slate-500 font-bold animate-pulse">
    {isProjectMode ? '加载项目技能中...' : '同步技能中...'}
  </div>;

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20 overflow-hidden overflow-x-hidden w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight italic flex items-center gap-3">
            <Puzzle className="h-8 w-8 text-primary-600" />
            {isProjectMode ? '项目技能中心' : '技能中心'}
          </h1>
          <p className="mt-2 text-sm text-slate-500 font-medium">
            {isProjectMode 
              ? `已启用 ${enabledSkills.length} 个技能（全局技能 + 私有技能）`
              : '扩展 Agent 能力：支持粘贴 GitHub 文件链接、ZIP 包或手动导入。'}
          </p>
        </div>
        <div className="flex gap-4 items-center">
          {isProjectMode && (
            <Button variant="outline" icon={Lock} onClick={() => setShowAddPrivate(true)} 
              className="rounded-2xl font-black text-[10px] tracking-widest uppercase bg-amber-50 border-amber-200 text-amber-700">
              添加私有技能
            </Button>
          )}
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary-500 transition-colors" />
            <input placeholder="搜索技能..." className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50 transition-all w-72 shadow-sm" 
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {/* 项目私有技能弹窗 */}
      {showAddPrivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddPrivate(false)} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-8 pt-8 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-50 rounded-xl">
                  <Lock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">添加项目私有技能</h2>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">仅当前项目可用，不会影响其他项目</p>
                </div>
              </div>
              <button onClick={() => setShowAddPrivate(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-8 pb-8 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">技能名称 <span className="text-rose-400">*</span></label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    placeholder="例如：我的自定义技能" value={privateSkillForm.name} onChange={e => setPrivateSkillForm({...privateSkillForm, name: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">描述</label>
                  <input type="text" className="w-full px-4 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 text-sm font-bold transition-all" 
                    placeholder="技能功能描述" value={privateSkillForm.description} onChange={e => setPrivateSkillForm({...privateSkillForm, description: e.target.value})} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">技能内容 (SKILL.md) <span className="text-rose-400">*</span></label>
                <textarea className="w-full h-64 p-5 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-amber-50 font-mono text-xs shadow-inner" 
                  placeholder="在此粘贴技能 Markdown 内容..." value={privateSkillForm.content} onChange={e => setPrivateSkillForm({...privateSkillForm, content: e.target.value})} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowAddPrivate(false)}>取消</Button>
                <Button icon={Save} onClick={handleAddPrivateSkill} disabled={savingPrivate}>{savingPrivate ? '保存中...' : '保存私有技能'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 项目私有技能列表（项目模式） */}
      {isProjectMode && projectPrivateSkills.length > 0 && (
        <Card className="p-8 border-amber-100 bg-gradient-to-r from-amber-50/50 to-white shadow-sm rounded-[32px]">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="h-5 w-5 text-amber-600" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">项目私有技能</h3>
            <Badge status="warning" className="font-black px-3 py-1 scale-90">{projectPrivateSkills.length}</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projectPrivateSkills.map(skill => (
              <Card key={skill.id} className="p-6 group border-amber-100 bg-white hover:border-amber-300 transition-all rounded-3xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-amber-50 text-amber-600"><Zap className="h-5 w-5" /></div>
                  <button onClick={() => handleDeletePrivateSkill(skill.id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <h4 className="text-base font-black text-slate-900 mb-2">{skill.name}</h4>
                <p className="text-xs text-slate-500 font-medium line-clamp-2">{skill.description}</p>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {/* 已启用的技能（项目模式） */}
      {isProjectMode && enabledSkills.length > 0 && (
        <Card className="p-8 border-primary-100 bg-gradient-to-r from-primary-50/30 to-white shadow-sm rounded-[32px]">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle2 className="h-5 w-5 text-primary-600" />
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">已启用的技能</h3>
            <Badge status="success" className="font-black px-3 py-1 scale-90">{enabledSkills.length}</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {enabledSkills.map(skill => (
              <Card key={skill.id} className="p-6 group border-primary-100 bg-white hover:border-primary-300 transition-all rounded-3xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 rounded-xl bg-primary-50 text-primary-600"><Zap className="h-5 w-5" /></div>
                  {skill.isPrivate && <Badge status="warning" className="font-black px-2 py-0.5 text-[8px]">私有</Badge>}
                </div>
                <h4 className="text-base font-black text-slate-900 mb-2">{skill.name}</h4>
                <p className="text-xs text-slate-500 font-medium line-clamp-2">{skill.description}</p>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {/* 全局技能列表 */}
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 w-full max-w-full overflow-hidden">
        {filteredGlobalSkills.map(skill => {
          const isEnabled = enabledGlobalSkillIds.includes(skill.id);
          return (
            <Card key={skill.id} className={`p-8 group transition-all rounded-[32px] relative overflow-hidden flex flex-col min-w-0 ${isEnabled ? 'border-primary-500 bg-primary-50/10 shadow-xl ring-2 ring-primary-100' : 'border-slate-100 bg-white hover:border-primary-200 shadow-sm'}`}>
              <div className="flex items-start justify-between mb-8">
                 <div className={`p-4 rounded-2xl transition-all ${isEnabled ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-slate-50 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600 shadow-sm'}`}><Zap className="h-6 w-6" /></div>
                 <div className="flex items-center gap-2">
                    {isEnabled && <Badge status="success" className="font-black px-3 py-1 scale-90">ENABLED</Badge>}
                    {!isProjectMode && (
                      <button onClick={() => handleDeleteGlobal(skill.id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-4 w-4" /></button>
                    )}
                 </div>
              </div>
              <div className="flex-1 min-h-0 w-full overflow-hidden">
                 <h3 className="text-xl font-black text-slate-900 mb-3 break-words">{skill.name}</h3>
                 <p className="text-sm text-slate-500 leading-relaxed font-medium break-all">{skill.description}</p>
              </div>
              {isProjectMode ? (
                <div className="mt-10 pt-6 border-t border-slate-50 flex items-center justify-between">
                   <Button variant={isEnabled ? 'outline' : 'primary'} size="sm" onClick={() => toggleGlobalSkill(skill.id)} className={`px-6 rounded-xl font-black ${isEnabled ? 'border-primary-200 text-primary-600' : ''}`}>
                     {isEnabled ? 'UNINSTALL' : 'INSTALL'}
                   </Button>
                   {skill.url !== 'local://manual' && <a href={skill.url} target="_blank" rel="noreferrer" className="p-2 text-slate-300 hover:text-primary-600 transition-colors"><ExternalLink className="h-4 w-4" /></a>}
                </div>
              ) : (
                <div className="mt-10 pt-6 border-t border-slate-50">
                  <p className="text-[10px] text-slate-400 font-bold">在项目空间中启用此技能</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}