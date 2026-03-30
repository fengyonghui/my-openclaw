import type { ReactNode } from 'react';
import {
  Activity,
  Bot,
  Brain,
  Cpu,
  FolderKanban,
  FolderOpen,
  MessageSquare,
  Search,
  Settings,
  Puzzle,
  Sparkles,
  ChevronLeft,
  Home,
  Zap
} from 'lucide-react';
import type { AppView } from '../../App';
import { useState, useEffect } from 'react';

type NavKey = Exclude<AppView, 'dashboard'> | 'chats';

type NavItem = {
  key: NavKey;
  label: string;
  icon: ReactNode;
  gradient: string;
};

const navItems: NavItem[] = [
  { key: 'chats', label: '对话', icon: <MessageSquare className="h-5 w-5" />, gradient: 'from-indigo-500 to-purple-500' },
  { key: 'agents', label: 'Agents', icon: <Bot className="h-5 w-5" />, gradient: 'from-cyan-500 to-teal-500' },
  { key: 'skills', label: 'Skills', icon: <Puzzle className="h-5 w-5" />, gradient: 'from-violet-500 to-purple-500' },
  { key: 'files', label: '文件', icon: <FolderOpen className="h-5 w-5" />, gradient: 'from-amber-500 to-orange-500' },
  { key: 'memory', label: '记忆', icon: <Brain className="h-5 w-5" />, gradient: 'from-rose-500 to-pink-500' },
  { key: 'activity', label: '活动', icon: <Activity className="h-5 w-5" />, gradient: 'from-emerald-500 to-teal-500' },
  { key: 'models', label: '模型', icon: <Cpu className="h-5 w-5" />, gradient: 'from-violet-500 to-fuchsia-500' },
  { key: 'settings', label: '设置', icon: <Settings className="h-5 w-5" />, gradient: 'from-slate-500 to-slate-600' },
];

type AppShellProps = {
  currentProjectName: string;
  currentProjectDescription?: string;
  activeNav?: NavKey;
  children: ReactNode;
  contextPanel?: ReactNode;
  onNavigate?: (view: AppView) => void;
  onSwitchProject?: () => void;
};

export function AppShell({
  currentProjectName,
  currentProjectDescription,
  activeNav = 'chats',
  children,
  contextPanel,
  onNavigate,
  onSwitchProject,
}: AppShellProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Atmospheric Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-white to-indigo-50/30" />
      <div className="absolute inset-0 opacity-[0.008]" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, #1e1b4b 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 left-0 w-[400px] h-[400px] rounded-full bg-gradient-to-br from-indigo-100/40 to-purple-100/30 blur-3xl transform -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-gradient-to-tr from-violet-100/30 to-fuchsia-100/20 blur-3xl transform translate-x-1/3 translate-y-1/3" />

      {/* Header */}
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-white/50 bg-white/80 backdrop-blur-xl px-6 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onSwitchProject}
            className="group flex items-center gap-3 rounded-2xl border border-slate-200/50 bg-white/80 px-4 py-2.5 text-sm font-bold shadow-sm transition-all hover:bg-white hover:shadow-md hover:border-indigo-200/50"
          >
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
              <FolderKanban className="h-4 w-4" />
            </div>
            <span className="text-slate-700 group-hover:text-indigo-600 transition-colors">{currentProjectName}</span>
            <ChevronLeft className="h-4 w-4 text-slate-400 -ml-1 group-hover:translate-x-0.5 transition-transform" />
          </button>
          <div className="hidden text-sm text-slate-400 lg:block font-medium">
            {currentProjectDescription || '项目工作区'}
          </div>
        </div>

        <div className="hidden flex-1 max-w-md mx-8 items-center gap-2 rounded-2xl border border-slate-200/50 bg-white/80 px-4 py-2.5 md:flex group focus-within:bg-white focus-within:border-indigo-200/50 focus-within:shadow-md transition-all">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 font-medium"
            placeholder="搜索 Chat、Agent、文件..."
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden rounded-full border border-emerald-200/50 bg-emerald-50/80 backdrop-blur-sm px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600 md:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            运行中
          </div>
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-[10px] font-black text-white flex items-center justify-center shadow-lg shadow-indigo-500/30">
            YH
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className={`relative z-10 grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] max-w-[100vw] transition-all duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        
        {/* Left Sidebar */}
        <aside className="hidden border-r border-white/50 bg-white/60 backdrop-blur-sm lg:block">
          <div className="flex flex-col h-full">
            {/* Dashboard Link */}
            <div className="p-4 border-b border-slate-100/50">
              <button
                onClick={() => onSwitchProject?.()}
                className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-slate-500 hover:bg-white/80 hover:text-indigo-600 transition-all border border-transparent hover:border-indigo-200/50"
              >
                <Home className="h-5 w-5" />
                <span>返回首页</span>
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const selected = item.key === activeNav;
                return (
                  <button
                    key={item.key}
                    onClick={() => onNavigate?.(item.key === 'chats' ? 'dashboard' : item.key)}
                    className={`group relative w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-200 overflow-hidden ${
                      selected
                        ? 'text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {/* Selected Background */}
                    {selected && (
                      <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500" />
                    )}
                    
                    {/* Hover Glow */}
                    {!selected && (
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-slate-100 to-slate-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                    
                    <div className={`relative p-2 rounded-xl transition-all duration-200 ${
                      selected
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600'
                    }`}>
                      {item.icon}
                    </div>
                    <span className="relative">{item.label}</span>
                    
                    {/* Active Indicator */}
                    {selected && (
                      <div className="absolute right-3 w-2 h-2 rounded-full bg-white/80 animate-pulse" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Bottom Section */}
            <div className="p-4 border-t border-slate-100/50">
              <div className="rounded-2xl bg-gradient-to-br from-indigo-50/80 to-purple-50/40 p-4 border border-indigo-100/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-bold text-slate-700">快捷操作</span>
                </div>
                <button
                  onClick={() => {
                    onSwitchProject?.();
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 bg-[length:200%_100%] text-white text-sm font-bold py-2.5 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/30 transition-all animate-gradient hover:-translate-y-0.5"
                >
                  <Home className="h-4 w-4" />
                  返回首页
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 overflow-x-hidden">{children}</main>

        {/* Right Sidebar */}
        <aside className="hidden border-l border-white/50 bg-white/60 backdrop-blur-sm xl:block">
          {contextPanel}
        </aside>
      </div>

      {/* Global Styles */}
      <style>{`
        @keyframes gradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        
        .animate-gradient {
          animation: gradient 4s ease infinite;
        }
      `}</style>
    </div>
  );
}
