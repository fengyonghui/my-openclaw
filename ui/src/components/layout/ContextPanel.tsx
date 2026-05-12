import { Brain, FileText, Layout, LucideIcon, Zap, Activity, Info, FolderOpen, Cpu, Bot, Puzzle, Clock, TrendingUp, Circle } from 'lucide-react';
import { useState, useEffect } from 'react';

function StatusItem({ icon: Icon, label, value, gradient, subtext }: { icon: LucideIcon; label: string; value: string; gradient: string; subtext?: string }) {
  return (
    <div className="group relative p-4 rounded-2xl bg-gradient-to-br from-slate-50/80 to-white border border-slate-100/50 hover:border-slate-200/80 transition-all hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`p-2 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-sm font-bold text-slate-800 truncate">{value}</p>
          {subtext && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{subtext}</p>}
        </div>
      </div>
    </div>
  );
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50/80 border border-emerald-200/50">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">实时监控</span>
    </div>
  );
}

export function ContextPanel({ projectId, refreshKey }: { projectId?: string, refreshKey?: number }) {
  const [project, setProject] = useState<any>(null);
  const [modelName, setModelName] = useState('加载中...');
  const [agentCount, setAgentCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);

  useEffect(() => {
    if (projectId) {
      Promise.all([
        fetch(`http://localhost:3001/api/v1/projects/${projectId}`),
        fetch(`http://localhost:3001/api/v1/models`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/agents`),
        fetch(`http://localhost:3001/api/v1/projects/${projectId}/skills`),
      ]).then(async ([pRes, mRes, aRes, sRes]) => {
        const pData = await pRes.json();
        const mData = await mRes.json();
        const aData = await aRes.json();
        const sData = await sRes.json();
        
        setProject(pData);
        const model = mData.find((m: any) => m.id === pData.defaultModel);
        setModelName(model ? model.name : (pData.defaultModel || '未设置'));
        setAgentCount(Array.isArray(aData) ? aData.length : 0);
        setSkillCount(Array.isArray(sData) ? sData.length : 0);
      });
    }
  }, [projectId, refreshKey]);

  return (
    <div className="flex flex-col h-full p-4 space-y-4 overflow-y-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25">
            <Activity className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">上下文面板</h3>
        </div>
        <LiveIndicator />
      </div>

      {/* Status Cards */}
      <div className="space-y-3">
        <StatusItem 
          icon={Layout} 
          label="当前项目" 
          value={project?.name || '加载中...'} 
          gradient="from-blue-500 to-indigo-500"
        />
        <StatusItem 
          icon={Cpu} 
          label="默认模型" 
          value={modelName}
          gradient="from-amber-500 to-orange-500"
        />
        <StatusItem 
          icon={Bot} 
          label="启用的成员" 
          value={`${agentCount} 个`}
          gradient="from-cyan-500 to-teal-500"
        />
        <StatusItem 
          icon={Puzzle} 
          label="启用的 Skill" 
          value={`${skillCount} 个`}
          gradient="from-violet-500 to-purple-500"
        />
      </div>

      {/* Workspace Path */}
      <div className="relative p-5 rounded-2xl bg-gradient-to-br from-indigo-50/50 to-purple-50/30 border border-indigo-100/50 overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-indigo-200/20 to-purple-200/10 rounded-full blur-xl transform translate-x-1/2 -translate-y-1/2" />
        
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="h-4 w-4 text-indigo-500" />
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">物理工作空间</h4>
          </div>
          <div className="p-3 bg-white/80 rounded-xl border border-indigo-100/30 overflow-hidden">
            <code className="text-[10px] font-mono font-semibold text-slate-600 break-all leading-relaxed block">
              {project?.workspace || '加载中...'}
            </code>
          </div>
          <p className="mt-3 text-[10px] text-slate-500 font-medium leading-relaxed">
            成员输出文件将同步到此目录
          </p>
        </div>
      </div>

      {/* Real-time Context */}
      <div className="relative p-5 rounded-2xl bg-gradient-to-br from-violet-50/50 to-fuchsia-50/30 border border-violet-100/50 overflow-hidden">
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-violet-200/20 to-fuchsia-200/10 rounded-full blur-2xl transform -translate-x-1/2 translate-y-1/2" />
        
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-violet-500" />
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">实时上下文</h4>
          </div>
          
          <div className="p-4 rounded-xl bg-white/80 border border-violet-100/30 mb-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
                <TrendingUp className="h-3 w-3" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
                  正在监控工作目录变更...
                </p>
                <p className="text-[10px] text-slate-400 mt-1">实时追踪文件修改</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Clock className="h-3 w-3" />
              最近加载
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white/60 border border-slate-100/50">
                <FileText className="h-3 w-3 text-slate-400" />
                <span className="text-[10px] font-medium text-slate-600 truncate">OpenClaw-Backend-API.md</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white/60 border border-slate-100/50">
                <FileText className="h-3 w-3 text-slate-400" />
                <span className="text-[10px] font-medium text-slate-600 truncate">Project-Schema.json</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
