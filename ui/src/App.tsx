import { useMemo, useState, useCallback } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ChatDetailPage } from './pages/ChatDetailPage';
import { ProjectDashboardPage } from './pages/ProjectDashboardPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { AgentsPage } from './pages/AgentsPage';
import { FilesPage } from './pages/FilesPage';
import { ActivityPage } from './pages/ActivityPage';
import { MemoryPage } from './pages/MemoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ContextPanel } from './components/layout/ContextPanel';

export type AppView = 'dashboard' | 'chat' | 'agents' | 'files' | 'memory' | 'activity' | 'settings';

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<AppView>('dashboard');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const content = useMemo(() => {
    if (!projectId) {
      return <ProjectListPage onSelectProject={(id) => { setProjectId(id); setView('dashboard'); }} />;
    }

    switch (view) {
      case 'chat': return <ChatDetailPage chatId={activeChatId || '1'} projectId={projectId} />;
      case 'agents': return <AgentsPage projectId={projectId} />;
      case 'files': return <FilesPage projectId={projectId} />;
      case 'activity': return <ActivityPage projectId={projectId} />;
      case 'memory': return <MemoryPage projectId={projectId} />;
      case 'settings': return <SettingsPage projectId={projectId} onSaved={triggerRefresh} />;
      case 'dashboard':
      default: return <ProjectDashboardPage projectId={projectId} onOpenChat={(chatId) => { setActiveChatId(chatId); setView('chat'); }} onProjectUpdated={triggerRefresh} />;
    }
  }, [view, projectId, activeChatId, triggerRefresh]);

  if (!projectId) return <div className="min-h-screen bg-slate-50">{content}</div>;

  return (
    <AppShell
      currentProjectName={projectId}
      currentProjectDescription="OpenClaw 项目工作区"
      activeNav={view === 'dashboard' ? 'chats' : (view === 'chat' ? 'chats' : view)}
      onNavigate={setView}
      onSwitchProject={() => setProjectId(null)}
      contextPanel={<ContextPanel projectId={projectId} refreshKey={refreshKey} />}
    >
      {content}
    </AppShell>
  );
}
