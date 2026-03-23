# OpenClaw Chat 详情页 页面代码 v1

## UX 分析
- Chat 页面是整个产品的主战场，最重要的是消息流不能被杂讯打断。
- 用户必须一眼知道：当前在哪个项目、哪个 Chat、由谁处理、状态如何。
- 错误、运行中、等待状态必须自然地融入消息流，而不是另起一套系统。

## 设计决策
- 采用顶部 Header + 主消息流 + 底部 Composer 的经典聊天布局。
- 右侧上下文面板单独承载 Session / Agent / Tasks，避免主消息区过载。
- 消息样式区分 user / agent / system，保持可读性。
- 输入区支持多行输入，并为运行中状态预留提示区域。

## 代码实现

```tsx
import { Bot, LoaderCircle, SendHorizonal, Sparkles } from "lucide-react";
import { useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: "streaming" | "error";
};

const initialMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "@pm 保留 openclaw 当前所有功能，在此基础上实现项目管理、项目内 agent、多项目 chat 并发。",
  },
  {
    id: "2",
    role: "assistant",
    content: "已为你整理一版项目化改造设计方案，并输出到 pm 目录。",
  },
  {
    id: "3",
    role: "system",
    content: "系统已写入：pm/OpenClaw-项目化改造设计-v1.md",
  },
];

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-3xl rounded-3xl px-4 py-3 shadow-sm ${
          isUser
            ? "bg-blue-600 text-white"
            : "border border-slate-200 bg-white text-slate-900"
        }`}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-600">
            <Bot className="h-4 w-4" />
            PM Agent
          </div>
        )}
        <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
        {message.status === "streaming" && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            正在生成...
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatDetailPage() {
  const [input, setInput] = useState("");
  const [messages] = useState(initialMessages);
  const [isRunning] = useState(true);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[680px] flex-col rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">my-openclaw / Chat</div>
            <h1 className="mt-1 text-xl font-bold text-slate-900">项目化改造设计</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-1">Agent: PM Agent</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Model: gpt-5.4</span>
              <span className="rounded-full bg-slate-100 px-3 py-1">Dir: /mnt/d/workspace/my-openclaw/pm</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Running
            </span>
            <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              切换 Agent
            </button>
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="border-b border-blue-100 bg-blue-50 px-6 py-3 text-sm text-blue-700">
          当前任务正在处理中，你可以继续查看输出，也可以等待完成后继续输入。
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        <div className="flex justify-start">
          <div className="max-w-3xl rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-blue-600">
              <Sparkles className="h-4 w-4" />
              PM Agent
            </div>
            <div className="text-sm leading-6 text-slate-900">正在继续整理实施方案、数据迁移和 UI 原型的落地内容。</div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在生成...
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 px-6 py-4">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3 focus-within:border-blue-400 focus-within:bg-white focus-within:shadow-sm">
          <textarea
            aria-label="输入消息"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="输入你的任务，例如：继续补 API 设计，或把 Dashboard 页面直接写成 React + Tailwind 代码..."
            className="w-full resize-none bg-transparent text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
          />
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-slate-500">Enter 发送，Shift + Enter 换行</div>
            <button className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <SendHorizonal className="h-4 w-4" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

## 下一步建议
- 这个页面可以直接嵌入 `AppShell` 的主区域。
- 后续可继续补：消息 markdown 渲染、代码块高亮、任务中止按钮、消息操作菜单。
- 如果继续开发，建议再补一个 `Agents 页面代码稿` 和 `Common UI 组件稿`。