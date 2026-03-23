import { Brain, Search, Plus, Trash2, Edit3, ShieldCheck, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../components/ui';

export function MemoryPage({ projectId }: { projectId: string }) {
  const [memoryItems, setMemoryItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemory, setNewMemory] = useState({ title: '', content: '', tags: '' });

  const fetchMemory = async () => {
    try {
      setLoading(true);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/memory`);
      const data = await res.json();
      setMemoryItems(data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchMemory();
  }, [projectId]);

  const handleAddMemory = async () => {
    if (!newMemory.title || !newMemory.content) return alert('标题和内容不能为空');
    const tags = newMemory.tags.split(',').map(t => t.trim()).filter(Boolean);
    const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newMemory, tags })
    });
    if (res.ok) {
      setShowAddModal(false);
      setNewMemory({ title: '', content: '', tags: '' });
      fetchMemory();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight italic">Project Memory</h1>
          <p className="text-sm text-slate-500 font-medium">持久化项目规则、核心逻辑、关键决策及 Agent 知识沉淀</p>
        </div>
        <Button icon={Plus} onClick={() => setShowAddModal(true)}>添加新记忆</Button>
      </div>

      <div className="grid gap-6">
        {loading ? (
          <div className="p-12 text-center text-slate-400 font-bold animate-pulse">正在提取项目记忆...</div>
        ) : memoryItems.length === 0 ? (
          <div className="p-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200 opacity-50 flex flex-col items-center">
            <Brain className="h-10 w-10 mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest italic text-slate-400">项目记忆池为空</p>
          </div>
        ) : (
          memoryItems.map((item) => (
            <div key={item.id} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Card className="p-8 border-primary-50 bg-white shadow-xl ring-1 ring-primary-50/20">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="rounded-2xl bg-primary-50 p-3"><Brain className="h-6 w-6 text-primary-600" /></div>
                    <div>
                      <h3 className="text-lg font-black text-slate-900">{item.title}</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.tags?.map((tag: string) => <Badge key={tag} status="info" className="scale-75 origin-left">{tag}</Badge>)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 p-5 rounded-3xl bg-slate-50 border border-slate-100 text-sm text-slate-700 leading-7 font-medium italic">"{item.content}"</div>
                <div className="mt-6 flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 tracking-widest px-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> 最后更新于: {new Date(item.createdAt).toLocaleString()}
                </div>
              </Card>
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Card className="max-w-xl w-full p-8 shadow-3xl bg-white border-0 relative animate-in zoom-in-95">
             <button onClick={() => setShowAddModal(false)} className="absolute right-6 top-6 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
             <h3 className="text-xl font-black text-slate-900 mb-6">新增项目记忆</h3>
             <div className="space-y-4">
               <div className="space-y-1.5"><label className="text-[10px] font-black uppercase text-slate-400">标题</label><input className="w-full px-5 py-3 rounded-2xl bg-slate-50 border-0 outline-none focus:ring-4 focus:ring-primary-50 text-sm font-bold" value={newMemory.title} onChange={e => setNewMemory({...newMemory, title: e.target.value})} placeholder="例如：后端 API 规范" /></div>
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
