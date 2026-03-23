import { Brain, FileText, Layout, LucideIcon, Zap, Activity, Info, FolderOpen } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Badge } from '../ui';

function StatusItem({ icon: Icon, label, value, colorClass }: { icon: LucideIcon; label: string; value: string; colorClass: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${colorClass}`} />
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">{label}</span>
      </div>
      <span className="text-[11px] font-black text-slate-900 truncate ml-4">{value}</span>
    </div>
  );
}

export function ContextPanel({ projectId, refreshKey }: { projectId?: string, refreshKey?: number }) {
  const [project, setProject] = useState<any>(null);
  const [modelName, setModelName] = useState('Loading...');

  useEffect(() => {
    if (projectId) {
      Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/models`)
      ]).then(async ([pRes, mRes]) => {
        const pData = await pRes.json();
        const mData = await mRes.json();
        setProject(pData);
        const model = mData.find((m: any) => m.id === pData.defaultModel);
        setModelName(model ? model.name : (pData.defaultModel || 'None'));
      });
    }
  }, [projectId, refreshKey]); // 监听刷新信号

  return (
    <div className="flex flex-col h-full bg-slate-50/50 p-4 space-y-4 overflow-y-auto">
      <Card className="p-5 border-slate-100 shadow-sm rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-4">
          <Info className="h-4 w-4 text-primary-600" />
          <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">项目状态</h3>
        </div>
        <div className="space-y-1 divide-y divide-slate-50">
          <StatusItem icon={Layout} label="当前项目" value={project?.name || 'Loading...'} colorClass="text-blue-500" />
          <StatusItem icon={Zap} label="默认模型" value={modelName} colorClass="text-amber-500" />
          <StatusItem icon={Activity} label="会话状态" value="Active" colorClass="text-emerald-500" />
        </div>
      </Card>

      <Card className="p-5 border-slate-100 shadow-sm rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-4">
          <FolderOpen className="h-4 w-4 text-primary-600" />
          <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">物理工作空间</h3>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
           <code className="text-[9px] font-mono font-bold text-slate-500 break-all leading-normal block">
             {project?.workspace || 'N/A'}
           </code>
        </div>
        <p className="mt-3 text-[9px] text-slate-400 font-bold italic leading-normal">
          所有的 Agent 输出文件将同步到此物理目录中。
        </p>
      </Card>

      <Card className="p-5 border-slate-100 shadow-sm flex-1 rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="h-4 w-4 text-primary-600" />
          <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">实时 Context</h3>
        </div>
        <div className="space-y-3">
          <div className="p-3 rounded-2xl bg-primary-50/50 border border-primary-100/50">
            <p className="text-[11px] font-bold text-primary-700 leading-relaxed italic">
              "正在监控工作目录下的变更..."
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
             <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">最近加载上下文</p>
             <p className="mt-1 text-[10px] text-slate-700 font-medium truncate">OpenClaw-Backend-API-v1.md</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
