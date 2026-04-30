import { Brain, Plus, Trash2, ShieldCheck, X, BookOpen, Zap } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

type ManualMemory = {
  id: string;
  category?: string;
  content: string;
  source?: string;
  createdAt: string;
};

export function MemoryPage({ projectId }: { projectId: string }) {
  const [manualMemories, setManualMemories] = useState<ManualMemory[]>([]);
  const [projectMemoryMd, setProjectMemoryMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemory, setNewMemory] = useState({ title: '', content: '', tags: '' });
  const [activeTab, setActiveTab] = useState<'project' | 'manual'>('project');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [memRes, mdRes] = await Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/memory`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/memory-file`),
      ]);
      const memData = await memRes.json();
      const mdData = await mdRes.json();
      setManualMemories(Array.isArray(memData) ? memData : []);
      setProjectMemoryMd(mdData.content || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [projectId]);

  const handleAddMemory = async () => {
    if (!newMemory.content) return alert('内容不能为空');
    const tags = newMemory.tags.split(',').map(t => t.trim()).filter(Boolean);
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newMemory.content, category: 'manual', tags }),
    });
    if (res.ok) {
      setShowAddModal(false);
      setNewMemory({ title: '', content: '', tags: '' });
      fetchAll();
    }
  };

  const handleDeleteMemory = async (id: string) => {
    if (!confirm('确定删除这条记忆？')) return;
    const db = await (await fetch(`http://localhost:3001/api/v1/db`)).json();
    db.memories = (db.memories || []).filter((m: any) => m.id !== id);
    await fetch(`http://localhost:3001/api/v1/db`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(db),
    });
    fetchAll();
  };

  // 渲染 MEMORY.md 内容（简单的 Markdown 渲染）
  const renderMarkdown = (md: string) => {
    if (!md) return null;
    const lines = md.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('## ')) {
        return <h3 key={i} className="text-base font-black text-slate-700 mt-6 mb-2">{line.replace('## ', '')}</h3>;
      }
      if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="text-sm font-bold text-slate-600 mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>;
      }
      if (line.startsWith('- [')) {
        return <p key={i} className="text-sm text-slate-600 pl-3 my-1 leading-relaxed">{line}</p>;
      }
      if (line.trim()) {
        return <p key={i} className="text-sm text-slate-500 leading-relaxed">{line}</p>;
      }
      return <div key={i} className="h-2" />;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight italic">Project Memory</h1>
          <p className="text-sm text-slate-500 font-medium">项目知识沉淀 · AI 自动提取 · 手动维护</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Tab 切换 */}
          <div className="flex bg-slate-100 rounded-2xl p-1">
            <button
              onClick={() => setActiveTab('project')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === 'project' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5 inline mr-1.5" />
              项目记忆
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === 'manual' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Zap className="h-3.5 w-3.5 inline mr-1.5" />
              手动记忆
            </button>
          </div>
          <Button icon={Plus} onClick={() => setShowAddModal(true)}>添加</Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-400 font-bold animate-pulse">正在加载记忆...</div>
      ) : (
        <div className="grid gap-6">
          {/* 项目层记忆 (MEMORY.md) */}
          {activeTab === 'project' && (
            <>
              {projectMemoryMd ? (
                <Card className="p-8 bg-white shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-md shadow-rose-200">
                      <Brain className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-black text-slate-800">MEMORY.md</h3>
                      <p className="text-xs text-slate-400">注入所有新对话的系统提示词</p>
                    </div>
                    <Badge status="success" className="ml-auto">AI 自动维护</Badge>
                  </div>
                  <div className="prose prose-sm max-w-none text-slate-600">
                    {renderMarkdown(projectMemoryMd)}
                  </div>
                </Card>
              ) : (
                <div className="p-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 opacity-50 flex flex-col items-center">
                  <Brain className="h-10 w-10 mb-4 text-slate-300" />
                  <p className="text-sm font-bold uppercase tracking-widest italic text-slate-400">MEMORY.md 为空</p>
                  <p className="text-xs text-slate-300 mt-2">对话结束后 AI 会自动提取关键信息到这里</p>
                </div>
              )}
            </>
          )}

          {/* 手动记忆 */}
          {activeTab === 'manual' && (
            <>
              {manualMemories.length === 0 ? (
                <div className="p-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 opacity-50 flex flex-col items-center">
                  <Brain className="h-10 w-10 mb-4 text-slate-300" />
                  <p className="text-sm font-bold uppercase tracking-widest italic text-slate-400">手动记忆池为空</p>
                </div>
              ) : (
                manualMemories.map((item) => (
                  <div key={item.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <Card className="p-8 border-primary-50 bg-white shadow-xl ring-1 ring-primary-50/20 relative group">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <div className="rounded-2xl bg-primary-50 p-3"><Brain className="h-6 w-6 text-primary-600" /></div>
                          <div>
                            <h3 className="text-lg font-black text-slate-900">{item.category || '一般'}</h3>
                            {item.source && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Badge status="info" className="scale-75 origin-left">{item.source}</Badge>
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteMemory(item.id)}
                          className="p-2 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-6 p-5 rounded-3xl bg-slate-50 border border-slate-100 text-sm text-slate-700 leading-7 font-medium italic">"{item.content}"</div>
                      <div className="mt-6 flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">
                        <ShieldCheck className="h-3.5 w-3.5" /> 最后更新于: {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </Card>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-3xl bg-white border-0 relative animate-in zoom-in-95">
             <button onClick={() => setShowAddModal(false)} className="absolute right-6 top-6 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
             <h3 className="text-xl font-black text-slate-900 mb-6">新增手动记忆</h3>
             <div className="space-y-4">
               <div className="space-y-1.5"><label className="text-[10px] font-black uppercase text-slate-400">内容</label><textarea className="w-full px-5 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-medium min-h-[100px]" value={newMemory.content} onChange={e => setNewMemory({...newMemory, content: e.target.value})} placeholder="输入需要 Agent 永久记住的信息..." /></div>
               <div className="space-y-1.5"><label className="text-[10px] font-black uppercase text-slate-400">标签 (逗号分隔)</label><input className="w-full px-5 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold" value={newMemory.tags} onChange={e => setNewMemory({...newMemory, tags: e.target.value})} placeholder="Safety, Rule, Logic" /></div>
             </div>
             <div className="mt-8 flex gap-3">
               <Button onClick={handleAddMemory} className="flex-1">保存记忆</Button>
               <Button variant="outline" onClick={() => setShowAddModal(false)} className="px-6">取消</Button>
             </div>
          </Card>
        </div>
      )}
    </div>
  );
}
