import { Zap, Puzzle, Download, Trash2, CheckCircle2, Search, Info, ExternalLink, Globe, Plus, X, FileText, Box } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function SkillsPage({ projectId }: { projectId: string }) {
  const [availableSkills, setAvailableSkills] = useState<any[]>([]);
  const [projectSkillIds, setProjectSkillIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualContent, setManualContent] = useState('');

  const fetchSkills = async () => {
    try {
      const [aRes, pRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/skills`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`)
      ]);
      setAvailableSkills(await aRes.json());
      const pData = await pRes.json();
      setProjectSkillIds(pData.enabledSkillIds || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchSkills(); }, [projectId]);

  const filteredSkills = useMemo(() => {
    return availableSkills.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableSkills, searchQuery]);

  const toggleSkill = async (skillId: string) => {
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId })
    });
    if (res.ok) {
      setProjectSkillIds(await res.json());
    }
  };

  const handleImport = async (type: 'direct' | 'zip') => {
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
        setAvailableSkills(await res.json());
        setImportUrl('');
        alert('技能导入成功！');
      } else {
        const err = await res.json();
        alert(`导入失败: ${err.error || '未知错误'}`);
      }
    } catch (err) { alert('网络异常'); } finally { setImporting(false); }
  };

  const handleManualSave = async () => {
    if (!manualContent.trim()) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: manualContent })
    });
    if (res.ok) {
      setAvailableSkills(await res.json());
      setManualContent('');
      setShowManual(false);
    }
  };

  const handleDeleteGlobal = async (id: string) => {
    if (!confirm('确定要从全局技能池中永久移除此技能吗？')) return;
    const res = await fetch(`http://localhost:3001/api/v1/skills/${id}`, { method: 'DELETE' });
    if (res.ok) setAvailableSkills(await res.json());
  };

  if (loading) return <div className="p-12 text-center text-slate-500 font-bold animate-pulse">同步技能中...</div>;

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight italic flex items-center gap-3">
            <Puzzle className="h-8 w-8 text-primary-600" />
            Skill Center
          </h1>
          <p className="mt-2 text-sm text-slate-500 font-medium">扩展 Agent 能力：支持粘贴 GitHub 文件链接、ZIP 包或手动导入。</p>
        </div>
        <div className="flex gap-4">
           <Button variant="outline" icon={FileText} onClick={() => setShowManual(true)} className="rounded-2xl font-black text-[10px] tracking-widest uppercase bg-white border-slate-200">手动导入内容</Button>
           <div className="relative group"><Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary-500 transition-colors" /><input placeholder="搜索已导入技能..." className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-2xl text-xs font-bold outline-none focus:border-primary-400 focus:ring-4 focus:ring-primary-50 transition-all w-72 shadow-sm" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        </div>
      </div>

      {showManual && (
        <Card className="p-8 border-primary-100 bg-primary-50/5 animate-in slide-in-from-top-4 rounded-[32px]">
           <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">粘贴 SKILL.MD 内容</h3>
              <button onClick={() => setShowManual(false)}><X className="h-5 w-5 text-slate-400 hover:text-slate-600" /></button>
           </div>
           <textarea 
             className="w-full h-64 p-6 rounded-3xl bg-white border border-slate-200 outline-none focus:border-primary-400 font-mono text-xs shadow-inner" 
             placeholder="在此粘贴 Markdown 文本..." 
             value={manualContent}
             onChange={e => setManualContent(e.target.value)}
           />
           <div className="mt-6 flex justify-end gap-4"><Button variant="outline" onClick={() => setShowManual(false)}>取消</Button><Button onClick={handleManualSave}>保存导入</Button></div>
        </Card>
      )}

      {/* Main Import Bar */}
      <Card className="p-8 border-indigo-100 bg-gradient-to-r from-white to-indigo-50/20 shadow-sm rounded-[32px]">
         <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
               <Globe className="h-5 w-5 text-indigo-600" />
               <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">导入 Skill (文件 URL 或 仓库)</h3>
            </div>
            <a href="https://clawhub.ai/skills?sort=downloads&nonSuspicious=true" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-800 transition-colors bg-white px-3 py-1.5 rounded-xl border border-indigo-100 shadow-sm">浏览 ClawHub <ExternalLink className="h-3 w-3" /></a>
         </div>
         <div className="flex flex-col gap-4">
            <input 
              className="w-full px-5 py-4 rounded-2xl bg-white border border-slate-200 outline-none focus:ring-4 focus:ring-indigo-100 text-xs font-mono font-bold text-slate-600 shadow-inner" 
              placeholder="粘贴 GitHub SKILL.md 文件链接，例如: https://github.com/openclaw/skills/blob/main/skills/chart-generator/SKILL.md" 
              value={importUrl} 
              onChange={e => setImportUrl(e.target.value)} 
            />
            <div className="flex gap-4">
              <Button onClick={() => handleImport('direct')} disabled={importing || !importUrl} icon={Download} className="flex-1 py-4 rounded-2xl font-black shadow-xl shadow-indigo-100">{importing ? '解析中...' : '解析文件链接'}</Button>
              <Button variant="outline" onClick={() => handleImport('zip')} disabled={importing || !importUrl} icon={Box} className="flex-1 py-4 rounded-2xl font-black bg-white border-slate-200 transition-all hover:bg-slate-50">{importing ? '探测中...' : '整库 ZIP 导入'}</Button>
            </div>
         </div>
         <p className="mt-4 text-[10px] text-slate-400 font-bold italic">
           提示：直接点开 GitHub 上的 SKILL.md，复制浏览器地址栏链接并点击“解析文件链接”即可。
         </p>
      </Card>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {filteredSkills.map(skill => {
          const isEnabled = projectSkillIds.includes(skill.id);
          return (
            <Card key={skill.id} className={`p-8 group transition-all rounded-[32px] relative overflow-hidden flex flex-col ${isEnabled ? 'border-primary-500 bg-primary-50/10 shadow-xl ring-2 ring-primary-100' : 'border-slate-100 bg-white hover:border-primary-200 shadow-sm'}`}>
              <div className="flex items-start justify-between mb-8">
                 <div className={`p-4 rounded-2xl transition-all ${isEnabled ? 'bg-primary-600 text-white shadow-lg shadow-primary-200' : 'bg-slate-50 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-600 shadow-sm'}`}><Zap className="h-6 w-6" /></div>
                 <div className="flex items-center gap-2">
                    {isEnabled && <Badge status="success" className="font-black px-3 py-1 scale-90">ENABLED</Badge>}
                    <button onClick={() => handleDeleteGlobal(skill.id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-4 w-4" /></button>
                 </div>
              </div>
              <div className="flex-1 min-h-0">
                 <h3 className="text-xl font-black text-slate-900 mb-3 truncate">{skill.name}</h3>
                 <p className="text-sm text-slate-500 leading-relaxed font-medium line-clamp-3">"{skill.description}"</p>
              </div>
              <div className="mt-10 pt-6 border-t border-slate-50 flex items-center justify-between">
                 <Button variant={isEnabled ? 'outline' : 'primary'} size="sm" onClick={() => toggleSkill(skill.id)} className={`px-6 rounded-xl font-black ${isEnabled ? 'border-primary-200 text-primary-600' : ''}`}>{isEnabled ? 'UNINSTALL' : 'INSTALL'}</Button>
                 {skill.url !== 'local://manual' && <a href={skill.url} target="_blank" rel="noreferrer" className="p-2 text-slate-300 hover:text-primary-600 transition-colors"><ExternalLink className="h-4 w-4" /></a>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
