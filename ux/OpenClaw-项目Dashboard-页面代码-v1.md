# OpenClaw 项目 Dashboard 页面代码 v1

## UX 分析
- Dashboard 的价值是帮助用户快速建立项目全局感，而不是堆信息。
- 第一屏应优先展示“最近在做什么”和“我下一步可以做什么”。
- 卡片设计必须轻量，便于后续继续加模块而不显得拥挤。

## 设计决策
- 使用 2 层布局：顶部 Hero + 下方信息卡栅格。
- 关键卡片采用统一样式，减少认知成本。
- 最近活动与运行中任务分开，避免时间流和状态流混在一起。

## 代码实现

```tsx
import { Activity, Bot, FolderOpen, MessageSquare, Plus } from "lucide-react";

const recentChats = [
  { title: "项目化改造设计", agent: "PM Agent", updatedAt: "2 分钟前", status: "active" },
  { title: "数据迁移方案", agent: "Backend Agent", updatedAt: "运行中", status: "running" },
  { title: "UI 原型说明", agent: "PM Agent", updatedAt: "等待输入", status: "waiting" },
];

const recentAgents = [
  { name: "PM Agent", role: "需求拆解 / 文档输出" },
  { name: "Backend Agent", role: "API / DB / 服务设计" },
  { name: "QA Agent", role: "测试与质量保障" },
];

const recentActivities = [
  "14:10 PM Agent 创建实施方案",
  "14:03 Backend Agent 写入 API 文档",
  "13:58 User 新建 Chat：UI 原型说明",
];

function statusClass(status: string) {
  switch (status) {
    case "running":
      return "bg-emerald-50 text-emerald-700";
    case "waiting":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-blue-50 text-blue-700";
  }
}

export function ProjectDashboardPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-sm font-medium text-blue-600">Project Overview</div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">my-openclaw</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              OpenClaw 项目化改造，目标是引入 Project 一级作用域，支撑多项目、多 Agent、多 Chat 并行协作。
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">默认 Agent: PM Agent</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">默认模型: gpt-5.4</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">主目录: D:\workspace\my-openclaw</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              新建 Chat
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Bot className="h-4 w-4" />
              新建 Agent
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MessageSquare className="h-4 w-4 text-blue-600" />
            最近 Chats
          </div>
          <div className="mt-4 space-y-3">
            {recentChats.map((chat) => (
              <div key={chat.title} className="rounded-2xl border border-slate-200 p-4 hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{chat.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{chat.agent}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(chat.status)}`}>
                    {chat.updatedAt}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Bot className="h-4 w-4 text-blue-600" />
            最近 Agents
          </div>
          <div className="mt-4 space-y-3">
            {recentAgents.map((agent) => (
              <div key={agent.name} className="rounded-2xl border border-slate-200 p-4 hover:bg-slate-50">
                <div className="text-sm font-semibold text-slate-900">{agent.name}</div>
                <div className="mt-1 text-xs text-slate-500">{agent.role}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Activity className="h-4 w-4 text-blue-600" />
            最近 Activity
          </div>
          <div className="mt-4 space-y-3">
            {recentActivities.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-600 hover:bg-slate-50">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">运行中任务</div>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">数据迁移方案生成中</div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">API 详细设计整理中</div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FolderOpen className="h-4 w-4 text-blue-600" />
            快捷入口
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {['打开 Files', '查看 Memory', '进入 Activity', '项目设置'].map((item) => (
              <button
                key={item}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
```

## 下一步建议
- 可直接将页面挂载到 `AppShell` 的主内容区。
- 后续可把卡片抽成 `ProjectSummaryCard`、`ChatCard`、`ActivityCard`。
- 如果继续推进，建议下一步接 Chat 详情页。