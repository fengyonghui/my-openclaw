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
  Puzzle
} from 'lucide-react';
import type { AppView } from '../../App';

type NavKey = Exclude<AppView, 'dashboard'> | 'chats';

type NavItem = {
  key: NavKey;
  label: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  { key: 'chats', label: 'Chats', icon: <MessageSquare className="h-4 w-4" /> },
  { key: 'agents', label: 'Agents', icon: <Bot className="h-4 w-4" /> },
  { key: 'skills', label: 'Skills', icon: <Puzzle className="h-4 w-4" /> },
  { key: 'files', label: 'Files', icon: <FolderOpen className="h-4 w-4" /> },
  { key: 'memory', label: 'Memory', icon: <Brain className="h-4 w-4" /> },
  { key: 'activity', label: 'Activity', icon: <Activity className="h-4 w-4" /> },
  { key: 'models', label: 'Models', icon: <Cpu className="h-4 w-4" /> },
  { key: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
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
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 overflow-hidden">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onSwitchProject}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold shadow-sm transition hover:bg-slate-50 text-primary-600"
          >
            <FolderKanban className="h-4 w-4" />
            <span>{currentProjectName}</span>
          </button>
          <div className="hidden text-sm text-slate-400 lg:block font-medium">
            {currentProjectDescription || 'Project workspace'}
          </div>
        </div>

        <div className="hidden w-full max-w-md items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2 md:flex group focus-within:bg-white focus-within:ring-2 focus-within:ring-primary-100 transition-all">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 font-medium"
            placeholder="搜索 Chat、Agent、文件或命令..."
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 md:block">
            Running
          </div>
          <button className="h-9 w-9 rounded-full bg-slate-900 text-[10px] font-black text-white flex items-center justify-center">YH</button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] max-w-[100vw] overflow-hidden">
        <aside className="hidden border-r border-slate-200 bg-white lg:block">
          <div className="border-b border-slate-100 px-4 py-4 space-y-3">
             <button
              onClick={() => onNavigate?.('dashboard')}
              className="text-left text-xs font-bold text-slate-400 uppercase tracking-widest hover:text-primary-600 transition-colors"
            >
              Dashboard
            </button>
            <button
              onClick={() => onNavigate?.('chat')}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary-100 transition hover:bg-primary-700"
            >
              Resume Chat
            </button>
          </div>

          <nav className="p-3">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const selected = item.key === activeNav;
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => onNavigate?.(item.key === 'chats' ? 'dashboard' : item.key)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-all ${
                        selected
                          ? 'bg-primary-50 text-primary-700 shadow-sm'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 px-4 py-4 lg:px-6 lg:py-6 overflow-x-hidden">{children}</main>

        <aside className="hidden border-l border-slate-200 bg-white xl:block">{contextPanel}</aside>
      </div>
    </div>
  );
}
