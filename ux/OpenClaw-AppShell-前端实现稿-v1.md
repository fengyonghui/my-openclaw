# OpenClaw App Shell 前端实现稿 v1

## UX 分析
- App Shell 是整个项目化 UI 的骨架，必须先稳定。
- 项目切换、左侧导航和右侧上下文面板都属于高频结构，不应在每页重复拼装。
- 为了兼顾桌面端和后续移动端扩展，布局应组件化并支持折叠。

## 设计决策
- 使用 CSS Grid 实现整体布局，便于控制 Top Bar / Sidebar / Main / Context Panel 的结构。
- 使用 Tailwind CSS 管理层级、间距和响应式。
- 右侧 Context Panel 在小屏下默认隐藏，减少拥挤。
- 所有图标使用 Lucide React，保证统一风格。

## 代码实现

```tsx
import { ReactNode } from "react";
import {
  Activity,
  Bot,
  Brain,
  FolderOpen,
  FolderKanban,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";

type NavItem = {
  key: string;
  label: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  { key: "chats", label: "Chats", icon: <MessageSquare className="h-4 w-4" /> },
  { key: "agents", label: "Agents", icon: <Bot className="h-4 w-4" /> },
  { key: "files", label: "Files", icon: <FolderOpen className="h-4 w-4" /> },
  { key: "memory", label: "Memory", icon: <Brain className="h-4 w-4" /> },
  { key: "activity", label: "Activity", icon: <Activity className="h-4 w-4" /> },
  { key: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

type AppShellProps = {
  currentProjectName: string;
  currentProjectDescription?: string;
  activeNav?: string;
  children: ReactNode;
  contextPanel?: ReactNode;
};

export function AppShell({
  currentProjectName,
  currentProjectDescription,
  activeNav = "chats",
  children,
  contextPanel,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            aria-label="切换项目"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50"
          >
            <FolderKanban className="h-4 w-4 text-blue-600" />
            <span>{currentProjectName}</span>
          </button>
          <div className="hidden text-sm text-slate-500 lg:block">
            {currentProjectDescription || "Project workspace"}
          </div>
        </div>

        <div className="hidden w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 md:flex">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            aria-label="搜索"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="搜索 Chat、Agent、文件或命令..."
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 md:block">
            Running Chats: 3 · Tasks: 2
          </div>
          <button className="h-9 w-9 rounded-full bg-slate-900 text-sm font-semibold text-white">
            YH
          </button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="hidden border-r border-slate-200 bg-white lg:block">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="text-sm font-semibold text-slate-900">项目：{currentProjectName}</div>
            <button className="mt-3 w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              + New Chat
            </button>
          </div>

          <nav className="p-3">
            <ul className="space-y-1">
              {navItems.map((item) => {
                const selected = item.key === activeNav;
                return (
                  <li key={item.key}>
                    <button
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                        selected
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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

        <main className="min-w-0 px-4 py-4 lg:px-6 lg:py-6">{children}</main>

        <aside className="hidden border-l border-slate-200 bg-white xl:block">
          <div className="space-y-4 p-4">
            {contextPanel || (
              <>
                <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Session Info</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>Status: Running</div>
                    <div>Memory Scope: Project</div>
                    <div>Working Dir: /pm</div>
                  </div>
                </section>
                <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Background Tasks</h3>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div>生成 API 设计（运行中）</div>
                    <div>生成 DB 设计（排队中）</div>
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
```

## 下一步建议
- 把 `AppShell` 作为所有项目化页面的统一外壳。
- 后续可继续抽离 `TopBar`、`Sidebar`、`ContextPanel` 为独立组件。
- 如果继续落地，建议直接接 `Dashboard` 和 `ChatDetail` 页面。