import { useState } from 'react';
import { Bot, Cpu, Search, X, Check, MessageSquare } from 'lucide-react';
import type { Message } from './types';

// 成员选择弹窗
export function AgentPicker({
  agents,
  currentAgentId,
  onSelect,
  onClose,
}: {
  agents: Array<{ id: string; name: string; role?: string; description?: string }>;
  currentAgentId?: string;
  onSelect: (agentId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-24 right-6 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* 标题栏 */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-white font-bold">选择成员</p>
                <p className="text-white/70 text-xs">切换对话助手</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              <X className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>

        {/* 成员列表 */}
        <div className="p-3 max-h-80 overflow-y-auto">
          {agents.map((agent, idx) => (
            <button
              key={agent.id}
              onClick={() => { onSelect(agent.id); onClose(); }}
              className={`w-full text-left p-4 rounded-2xl flex items-center gap-4 transition-all mb-2 ${
                currentAgentId === agent.id
                  ? 'bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 shadow-sm'
                  : 'hover:bg-slate-50 border-2 border-transparent'
              }`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                currentAgentId === agent.id
                  ? 'bg-gradient-to-br from-indigo-500 to-purple-600'
                  : 'bg-gradient-to-br from-slate-400 to-slate-500'
              }`}>
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800">{agent.name}</p>
                <p className="text-xs text-slate-500 truncate">{agent.role || agent.description || '团队成员'}</p>
              </div>
              {currentAgentId === agent.id && (
                <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center shadow-sm">
                  <Check className="h-4 w-4 text-white" />
                </div>
              )}
            </button>
          ))}

          {agents.length === 0 && (
            <div className="text-center py-8">
              <Bot className="h-12 w-12 mx-auto mb-3 text-slate-200" />
              <p className="text-sm text-slate-400">暂无可用成员</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 模型选择弹窗
export function ModelPicker({
  models,
  activeModelId,
  onSwitch,
  onClose,
}: {
  models: Array<{ id: string; name: string; modelId: string }>;
  activeModelId?: string;
  onSwitch: (modelId: string) => void;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredModels = models.filter(m => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (m.name || '').toLowerCase().includes(query) || (m.modelId || '').toLowerCase().includes(query);
  });

  return (
    <div className="absolute top-24 right-6 z-50 w-80 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* 标题栏 */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                <Cpu className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-white font-bold">选择模型</p>
                <p className="text-white/70 text-xs">切换 AI 模型</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-200" />
            <input
              placeholder="搜索模型名称..."
              className="w-full pl-10 pr-4 py-3 bg-white/90 backdrop-blur rounded-xl text-sm outline-none border-0 focus:ring-2 focus:ring-white/50 transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* 模型列表 */}
        <div className="p-3 max-h-72 overflow-y-auto">
          {filteredModels.map(m => (
            <button
              key={m.id}
              onClick={() => onSwitch(m.id)}
              className={`w-full text-left p-4 rounded-2xl flex items-center gap-4 transition-all mb-2 ${
                activeModelId === m.id
                  ? 'bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 shadow-sm'
                  : 'hover:bg-slate-50 border-2 border-transparent'
              }`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${
                activeModelId === m.id
                  ? 'bg-gradient-to-br from-amber-400 to-orange-500'
                  : 'bg-gradient-to-br from-slate-200 to-slate-300'
              }`}>
                <Cpu className={`h-5 w-5 ${activeModelId === m.id ? 'text-white' : 'text-slate-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-700 truncate">{m.name}</p>
                <p className="text-[10px] text-slate-400 truncate font-mono">{m.modelId}</p>
              </div>
              {activeModelId === m.id && (
                <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center shadow-sm">
                  <Check className="h-4 w-4 text-white" />
                </div>
              )}
            </button>
          ))}

          {filteredModels.length === 0 && (
            <div className="text-center py-8">
              <Search className="h-12 w-12 mx-auto mb-3 text-slate-200" />
              <p className="text-sm text-slate-400">未找到匹配的模型</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
