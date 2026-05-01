import { useMemo, useState, useCallback, useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ChatDetailPage } from './pages/ChatDetailPage';
import { ProjectDashboardPage } from './pages/ProjectDashboardPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { FilesPage } from './pages/FilesPage';
import { ActivityPage } from './pages/ActivityPage';
import { MemoryPage } from './pages/MemoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ContextPanel } from './components/layout/ContextPanel';
import { ProjectProvider } from './contexts/ProjectContext';

export type AppView = 'dashboard' | 'chat' | 'files' | 'memory' | 'activity' | 'settings';

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<AppView>('dashboard');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const pageContent = useMemo(() => {
    if (!projectId) {
      return (
        <>
          <ProjectListPage onSelectProject={(id) => { setProjectId(id); setView('dashboard'); }} />
        </>
      );
    }

    // When viewing chat, skip rendering the dashboard/page entirely
    if (view === 'chat') {
      return null;
    }

    const page = (() => {
      switch (view) {
        case 'files': return <FilesPage projectId={projectId} />;
        case 'activity': return <ActivityPage projectId={projectId} />;
        case 'memory': return <MemoryPage projectId={projectId} />;
        case 'settings': return <SettingsPage projectId={projectId} onSaved={triggerRefresh} />;
        default: return <ProjectDashboardPage projectId={projectId} onOpenChat={(chatId) => { setActiveChatId(chatId); setView('chat'); }} onProjectUpdated={triggerRefresh} />;
      }
    })();

    return (
      <AppShell
        currentProjectName={projectId}
        currentProjectDescription="OpenClaw 项目工作区"
        activeNav={view === 'dashboard' ? 'chats' : view}
        onNavigate={setView}
        onSwitchProject={() => setProjectId(null)}
        contextPanel={<ContextPanel projectId={projectId} refreshKey={refreshKey} />}
      >
        {page}
      </AppShell>
    );
  }, [view, projectId, triggerRefresh, refreshKey]);

  // Lock body scroll when chat is open
  useEffect(() => {
    if (view === 'chat') {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [view]);

  if (!projectId) return <div className="min-h-screen bg-slate-50 overflow-hidden">{pageContent}</div>;

  return (
    <ProjectProvider projectId={projectId}>
      <>
        {/* Chat overlay: rendered inside React tree */}
        {view === 'chat' && activeChatId && (
          <ChatDetailPage
            chatId={activeChatId}
            projectId={projectId}
            onMinimize={() => setView('dashboard')}
          />
        )}
        {/* Dashboard / page content */}
        {pageContent}
      </>
    </ProjectProvider>
  );
}
