import { Bot, Cpu, Edit3, Download, Trash2, Minus, XCircle } from 'lucide-react';

export function ChatHeader({
  project,
  chat,
  currentModel,
  currentAgent,
  isEditingTitle,
  newTitle,
  showAgentPicker,
  showModelPicker,
  onEditTitle,
  onCancelTitle,
  onSaveTitle,
  onTitleChange,
  onToggleAgentPicker,
  onToggleModelPicker,
  onDownload,
  onClearHistory,
  onMinimize,
  onToggleMaximize,
  windowState,
}: {
  project?: any;
  chat?: any;
  currentModel?: any;
  currentAgent?: any;
  isEditingTitle: boolean;
  newTitle: string;
  showAgentPicker: boolean;
  showModelPicker: boolean;
  onEditTitle: () => void;
  onCancelTitle: () => void;
  onSaveTitle: () => void;
  onTitleChange: (val: string) => void;
  onToggleAgentPicker: () => void;
  onToggleModelPicker: () => void;
  onDownload: () => void;
  onClearHistory: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  windowState: 'normal' | 'minimized' | 'maximized';
}) {
  return (
    <div className="flex items-center justify-between flex-shrink-0 bg-white border-b border-slate-100">
      <div className="flex items-center gap-4 flex-1 px-6 py-4">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          {isEditingTitle ? (
            <input
              autoFocus
              className="text-base font-bold text-slate-800 bg-white border border-indigo-300 rounded-xl px-3 py-1.5 outline-none shadow-sm w-full max-w-xs"
              value={newTitle}
              onChange={e => onTitleChange(e.target.value)}
              onBlur={onSaveTitle}
              onKeyDown={e => { if (e.key === 'Enter') onSaveTitle(); if (e.key === 'Escape') onCancelTitle(); }}
            />
          ) : (
            <div className="flex items-center gap-2 group cursor-pointer" onClick={onEditTitle}>
              <h1 className="text-base font-bold text-slate-800 truncate">{chat?.title || '新对话'}</h1>
              <Edit3 className="h-3.5 w-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full">{project?.name}</span>
            <button
              onClick={onToggleModelPicker}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-400 transition-all"
            >
              <Cpu className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-600">{currentModel?.name || '模型'}</span>
            </button>
            <button
              onClick={onToggleAgentPicker}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 hover:border-indigo-400 transition-all"
            >
              <Bot className="h-3 w-3 text-indigo-500" />
              <span className="text-[10px] font-bold text-indigo-600">{currentAgent?.name || '成员'}</span>
              <svg className="h-3 w-3 text-indigo-400" viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M3 4.5L6 7.5L9 4.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* 右侧按钮 */}
      <div className="flex items-center gap-2 px-4">
        <button onClick={onDownload} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors" title="导出对话">
          <Download className="h-5 w-5 text-slate-400" />
        </button>
        <button
          onClick={onClearHistory}
          className="p-2.5 rounded-xl hover:bg-red-50 transition-colors"
          title="清空历史"
        >
          <Trash2 className="h-5 w-5 text-slate-400 hover:text-red-500" />
        </button>
        <button onClick={onMinimize} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
          <Minus className="h-5 w-5 text-slate-400" />
        </button>
        {windowState === 'normal' ? (
          <button onClick={onToggleMaximize} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors" title="最大化">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="6" height="6" rx="0.5" />
              <path d="M4 4V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H9" />
            </svg>
          </button>
        ) : (
          <button onClick={onToggleMaximize} className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors" title="还原">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="8" height="8" rx="1" />
              <path d="M4 4V3a1 1 0 0 1 1-1h5" />
            </svg>
          </button>
        )}
        <button onClick={onMinimize} className="p-2.5 rounded-xl hover:bg-red-50 transition-colors" title="关闭">
          <XCircle className="h-5 w-5 text-slate-400 hover:text-red-500" />
        </button>
      </div>
    </div>
  );
}
