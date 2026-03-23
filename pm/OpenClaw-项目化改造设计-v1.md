# OpenClaw 项目化改造设计 v1

> 目标：在 **保留 OpenClaw 当前所有功能** 的前提下，引入 **Project（项目）** 这一等公民，使系统支持：
>
> 1. 项目管理功能  
> 2. 项目内创建和使用 Agent  
> 3. Session 和 Chat 基于项目归属  
> 4. 不同项目开启不同 Chat，且可同时工作

---

## 1. 背景与设计原则

当前 OpenClaw 更偏向“单工作区 + 会话 + Agent”的组织方式。这个模型在单项目使用时足够直接，但当用户同时处理多个项目、希望在项目内沉淀独立上下文，并让多个 Agent/Chat 并行工作时，会逐步暴露出几个问题：

- 不同业务上下文容易串扰
- 工作目录、记忆、工具权限缺少稳定边界
- Session / Chat / Agent 的归属关系不够清晰
- 很难自然支持“多项目并发运行”

因此，本次改造的核心不是推翻原架构，而是：

> **把 Project 提升为新的一级作用域，用它承接 Chat、Session、Agent、Memory、Workspace、权限和运行时状态。**

### 1.1 核心原则

1. **保留现有能力，不破坏已有使用方式**
2. **向上兼容**：旧数据、旧 API、旧 UI 尽量继续可用
3. **项目优先**：所有新增能力都优先围绕项目组织
4. **作用域清晰**：配置、记忆、目录、权限、运行态必须能明确归属
5. **并发可控**：多项目、多 Chat、多 Agent 可以同时工作，但避免资源冲突
6. **渐进式落地**：允许分阶段上线，而不是一次性大爆改

---

## 2. 总体架构重构

### 2.1 现状抽象

当前系统可粗略理解为：

```text
OpenClaw
 └── session/chat
      └── agent
           └── workspace/config/memory
```

### 2.2 目标架构

改造后建议变成：

```text
OpenClaw
 ├── Global Runtime
 ├── Projects
 │    ├── Project A
 │    │    ├── Agents
 │    │    ├── Chats
 │    │    ├── Sessions
 │    │    ├── Memory
 │    │    ├── Workspaces
 │    │    └── Project Settings
 │    └── Project B
 │         ├── Agents
 │         ├── Chats
 │         ├── Sessions
 │         ├── Memory
 │         └── ...
 └── Shared Global Services
      ├── Model Provider
      ├── Message Router
      ├── Auth
      ├── Scheduler
      └── Storage
```

### 2.3 分层说明

#### Global 层
保留现有 OpenClaw 的系统级基础设施：

- 模型提供方接入
- 消息路由
- 认证与账户
- 全局配置
- 全局调度器
- 存储与日志能力

#### Project 层
新增的核心业务边界：

- 项目配置
- 项目默认工作目录 / workspace
- 项目级 memory
- 项目级 agent 模板
- 项目级 chat / session
- 项目级工具权限
- 项目级并发与任务控制

#### Runtime 层
每个项目都有自己的运行时上下文：

- chat runtime
- session runtime
- agent worker
- memory cache
- task queue

---

## 3. 核心概念重定义

为避免概念混淆，建议统一定义如下。

### 3.1 Project

Project 是新的一级业务容器，也是系统中的主要隔离边界。

#### Project 的职责

- 作为 Chat / Session / Agent 的父级作用域
- 挂载工作目录与项目配置
- 承接项目级 Memory
- 承接项目级权限与安全策略
- 承接项目级运行时调度

#### 建议数据结构

```ts
type Project = {
  id: string
  name: string
  slug: string
  description?: string
  status: 'active' | 'paused' | 'archived'

  rootPath?: string
  workspaces?: WorkspaceRef[]

  config: {
    defaultModel?: string
    reasoning?: 'off' | 'on'
    timezone?: string
    memoryPolicy?: 'project' | 'shared' | 'isolated'
    toolPolicy?: ToolPolicy
    visibility?: 'private' | 'team'
  }

  createdAt: string
  updatedAt: string
}
```

---

### 3.2 Chat

Chat 是用户可见的对话容器。

#### Chat 的职责

- 作为前端 UI 中的会话入口
- 承载消息流
- 绑定默认 Agent
- 归属于某个 Project
- 可对应一个或多个 Session

#### 建议数据结构

```ts
type Chat = {
  id: string
  projectId: string
  title: string
  channel: 'webchat' | 'telegram' | 'discord' | 'signal' | 'internal'
  mode: 'human-agent' | 'multi-agent' | 'group'
  defaultAgentId?: string
  status: 'active' | 'closed' | 'archived'
  createdAt: string
  updatedAt: string
}
```

---

### 3.3 Session

Session 是运行态上下文，是比 Chat 更底层的实际执行单元。

#### Session 的职责

- 承载运行时参数（cwd、env、model、tools）
- 承载消息处理状态
- 承载上下文窗口和短期 memory
- 绑定某个 Agent Instance 执行任务

#### 建议数据结构

```ts
type Session = {
  id: string
  projectId: string
  chatId: string
  agentId?: string

  runtime: {
    cwd?: string
    env?: Record<string, string>
    model?: string
    tools?: string[]
    skillContext?: string[]
  }

  memoryScope: 'project' | 'chat' | 'session' | 'agent'
  status: 'active' | 'idle' | 'background' | 'terminated'
  lastActivityAt: string
}
```

#### Chat 与 Session 的关系

建议采用以下设计：

- **简单模式**：1 个 Chat 对应 1 个主 Session
- **进阶模式**：1 个 Chat 可以派生多个 Session
  - 比如一个主会话中同时启动多个 Agent 并行工作

---

### 3.4 Agent

建议将 Agent 明确拆成两类。

#### A. Agent Template
代表“可复用的 Agent 定义”。

```ts
type AgentTemplate = {
  id: string
  projectId: string | null
  name: string
  role: string
  systemPrompt?: string
  skills: string[]
  tools: string[]
  memoryMode: 'shared-project' | 'isolated'
  executionMode: 'interactive' | 'background' | 'scheduled'
}
```

#### B. Agent Instance
代表“运行中的 Agent 实例”。

```ts
type AgentInstance = {
  id: string
  projectId: string
  templateId: string
  name: string
  status: 'idle' | 'running' | 'waiting' | 'error'
  boundSessionId?: string
  createdAt: string
  updatedAt: string
}
```

#### 为什么要拆分

因为用户的真实需求通常有两层：

1. 先在项目内定义一个角色（模板）
2. 再在某个 Chat / Session 中实际运行它（实例）

这样更利于：

- 模板复用
- 实例监控
- 并发运行
- 审计与回放

---

### 3.5 Workspace

Workspace 是项目挂载的物理目录集合。

```ts
type WorkspaceRef = {
  id: string
  projectId: string
  name: string
  path: string
  isPrimary: boolean
  readOnly?: boolean
}
```

#### 设计意图

- 一个项目可绑定多个目录
- 主目录为默认 cwd
- 可支持只读依赖目录、文档目录、资源目录

---

### 3.6 Memory

Memory 建议分层处理。

#### Memory 层次

1. **Global Memory**
   - 系统级经验、全局默认偏好
   - 应控制使用范围，避免污染项目

2. **Project Memory**
   - 项目架构、规范、关键决策、里程碑
   - 应作为默认主记忆层

3. **Chat Memory**
   - 某个对话的上下文连续性

4. **Session Memory**
   - 某次执行过程中的短期运行状态

5. **Agent Memory**
   - 某个 Agent 的专属工作记忆

#### 默认建议

- 项目知识 -> Project Memory
- 对话上下文 -> Chat / Session Memory
- 角色偏好 -> Agent Memory

---

## 4. 作用域与继承规则

这是整套设计最关键的部分。

### 4.1 作用域层级

```text
Global
  -> Project
      -> Chat
          -> Session
              -> Agent Instance
```

### 4.2 配置优先级

读取顺序建议如下：

```text
Agent Instance > Session > Chat > Project > Global
```

适用于：

- model
- reasoning
- cwd
- tools
- env
- memory mode
- output policies

### 4.3 示例

#### 示例 1：模型选择

- Global 默认模型：`MiniMax-M2.5`
- Project 指定默认模型：`gpt-5.4`
- 某 Chat 临时指定：`claude-sonnet`
- 某 Agent Instance 再指定：`deepseek-reasoner`

最终实际执行时，优先取 Agent Instance。

#### 示例 2：工作目录

- Project 默认根目录：`D:\workspace\my-openclaw`
- Chat 指向 `pm/`
- Session 切到 `pm/docs`

最终 Session 的 cwd 生效。

---

## 5. 目标能力设计

### 5.1 项目管理功能

#### 能力清单

- 创建项目
- 编辑项目
- 归档/暂停项目
- 删除项目（需谨慎）
- 绑定项目根目录
- 管理项目级 workspace
- 管理项目级 memory
- 管理项目级默认 Agent
- 管理项目级模型、技能、工具权限
- 查看项目活动历史

#### 用户价值

- 不同项目上下文独立
- 不再依赖“手动切换工作目录”维持边界
- 可以把项目真正当成工作单元管理

---

### 5.2 项目内创建和使用 Agent

#### 能力清单

- 在项目中创建 Agent Template
- 从全局模板导入为项目模板
- 编辑项目 Agent 的 system prompt / skills / tools / memory mode
- 在某个 Chat 中选择默认 Agent
- 支持 `@agent` 方式拉入对话
- 支持一个项目下多个 Agent 并行工作

#### 示例

项目 `my-openclaw` 下可拥有：

- PM Agent
- Backend Agent
- Frontend Agent
- QA Agent
- DevOps Agent

它们共享同一项目背景，但职责各自独立。

---

### 5.3 Session 和 Chat 基于项目

#### 强约束设计

- `chat.projectId` 必填
- `session.projectId` 必须与 `chat.projectId` 一致
- `agent.projectId` 必须与 project 兼容
- Session 的默认 cwd 来源于 Project / Workspace
- Memory 默认写入项目范围

#### 收益

- 上下文不串项目
- Session / Chat 的归属更明确
- 多项目并发时风险更低

---

### 5.4 不同项目开启不同 Chat，并同时工作

#### 目标能力

- 项目 A 开 3 个 Chat
- 项目 B 开 2 个 Chat
- 这些 Chat 可以同时工作
- 各自可调用不同 Agent
- 各自上下文、目录、Memory 互不污染

#### 必须解决的问题

- 并发调度
- 资源隔离
- 工具权限隔离
- 文件修改冲突
- 模型调用预算与速率管理

---

## 6. 运行时架构设计

建议引入 **Project Runtime Manager**。

### 6.1 Runtime 分层

```text
Global Runtime Manager
 ├── Project Runtime: my-openclaw
 │    ├── Chat Runtime 1
 │    ├── Chat Runtime 2
 │    ├── Session Workers
 │    ├── Agent Workers
 │    └── Memory Cache
 ├── Project Runtime: client-a
 │    ├── Chat Runtime 3
 │    └── ...
 └── Shared Services
```

### 6.2 Project Runtime 职责

每个 Project Runtime 负责：

- 项目级事件队列
- chat/session 生命周期管理
- agent worker 调度
- memory / cache 管理
- 工具调用预算与并发控制
- workspace 访问隔离

### 6.3 为什么要按项目拆 Runtime

因为这是实现“多项目并发且相互隔离”的关键。

好处：

- 一个项目异常，不拖垮所有项目
- 项目级缓存更清晰
- 项目级锁更好做
- 项目级监控更容易

---

## 7. 并发模型设计

### 7.1 基本策略

采用：

> **项目级隔离 + Session 级并发 + 资源访问锁**

### 7.2 并发层次

#### 项目级并发
不同项目可独立运行：

- 独立任务队列
- 独立 runtime state
- 独立 memory cache
- 独立 workspace context

#### Session 级并发
同一项目内允许多个 Session 同时工作。

例如：

- `需求讨论 Chat` -> PM Agent
- `修 Bug Chat` -> Backend Agent
- `发布准备 Chat` -> DevOps Agent

### 7.3 冲突控制

必须增加以下机制：

1. **文件锁 / 目录锁**
   - 同一文件被多个 Session 修改时应串行化

2. **写操作审计**
   - 记录谁在什么 Session 下改了什么

3. **长任务后台化**
   - 防止一个 Chat 长时间阻塞前台交互

4. **工具调用配额控制**
   - 避免一个项目占满所有资源

5. **模型请求速率限制**
   - 以项目为单位控制 burst

---

## 8. 信息架构与 UI 设计

### 8.1 顶部 Project Switcher

建议在主界面顶部增加项目切换器：

```text
[ my-openclaw ▼ ]
```

切换项目后，以下模块都按当前项目过滤：

- Chats
- Agents
- Files
- Memory
- Activity
- Settings

### 8.2 左侧导航建议

```text
项目：my-openclaw
- Chats
- Agents
- Files
- Memory
- Activity
- Settings
```

### 8.3 Chat 列表

每个项目单独维护自己的 Chat 列表。

#### Chat 卡片建议展示

- 标题
- 默认 Agent
- 最近活动时间
- 状态（Active / Background / Waiting）
- 是否存在后台任务

### 8.4 新建 Project 流程

```text
新建项目
  -> 输入名称
  -> 绑定根目录
  -> 选择默认模型
  -> 选择默认 Agent 模板
  -> 创建首个 Chat
```

### 8.5 新建 Chat 流程

```text
新建 Chat
  - 所属项目：my-openclaw
  - 标题：项目化改造设计
  - 默认 Agent：PM Agent
  - 工作目录：/mnt/d/workspace/my-openclaw/pm
  - 模型：默认 / 指定
```

### 8.6 Agent 管理面板

```text
Agents
- PM Agent
- Backend Agent
- Frontend Agent
- QA Agent
+ New Agent
```

每个 Agent 可查看：

- 角色定义
- 使用技能
- 工具权限
- 默认工作目录
- 最近活跃 Session

### 8.7 多 Chat 并行展示建议

对于项目内多个 Chat 同时工作，建议 UI 增加：

- 运行中状态标识
- 后台任务数量
- 最近一次输出摘要
- “正在处理中”提示

---

## 9. API 设计建议

### 9.1 Project API

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId
```

### 9.2 Chat API

```http
GET    /api/projects/:projectId/chats
POST   /api/projects/:projectId/chats
GET    /api/projects/:projectId/chats/:chatId
PATCH  /api/projects/:projectId/chats/:chatId
POST   /api/projects/:projectId/chats/:chatId/archive
```

### 9.3 Session API

```http
GET    /api/projects/:projectId/sessions
POST   /api/projects/:projectId/sessions
GET    /api/projects/:projectId/sessions/:sessionId
POST   /api/projects/:projectId/sessions/:sessionId/run
POST   /api/projects/:projectId/sessions/:sessionId/stop
POST   /api/projects/:projectId/sessions/:sessionId/background
```

### 9.4 Agent API

```http
GET    /api/projects/:projectId/agents
POST   /api/projects/:projectId/agents
GET    /api/projects/:projectId/agents/:agentId
PATCH  /api/projects/:projectId/agents/:agentId
POST   /api/projects/:projectId/agents/:agentId/spawn
```

### 9.5 Memory API

```http
GET    /api/projects/:projectId/memory
PATCH  /api/projects/:projectId/memory
GET    /api/projects/:projectId/chats/:chatId/memory
PATCH  /api/projects/:projectId/chats/:chatId/memory
```

### 9.6 Files / Workspace API

```http
GET    /api/projects/:projectId/workspaces
POST   /api/projects/:projectId/workspaces
PATCH  /api/projects/:projectId/workspaces/:workspaceId
DELETE /api/projects/:projectId/workspaces/:workspaceId
```

---

## 10. 数据库 / 存储模型建议

如果当前已存在 `chat` / `session` / `agent` 等表，建议增量改造。

### 10.1 新增 projects 表

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  root_path TEXT,
  status TEXT NOT NULL,
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.2 新增 workspaces 表

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.3 chat 表扩展

```sql
ALTER TABLE chats ADD COLUMN project_id TEXT;
ALTER TABLE chats ADD COLUMN default_agent_id TEXT;
```

### 10.4 session 表扩展

```sql
ALTER TABLE sessions ADD COLUMN project_id TEXT;
ALTER TABLE sessions ADD COLUMN runtime_json TEXT;
ALTER TABLE sessions ADD COLUMN memory_scope TEXT;
```

### 10.5 agent 拆分

```sql
CREATE TABLE agent_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  prompt TEXT,
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_instances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  runtime_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.6 memory 表建议

如果原本未显式建表，可以开始结构化：

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

其中：

- `scope_type` 可取 `global | project | chat | session | agent`
- `scope_id` 为对应作用域实体 id

---

## 11. 兼容迁移方案

这是落地里最重要的一段。

### 11.1 总策略

> 不推翻旧结构，而是先引入一个 **默认项目 main**，让所有旧数据自动挂到它下面。

### 11.2 迁移步骤

#### 第一步：创建默认项目

```text
Project: main
```

它代表“旧系统的默认承载容器”。

#### 第二步：旧 Chat / Session 归属到 main

- 所有历史 chats 填充 `project_id = main`
- 所有历史 sessions 填充 `project_id = main`
- 默认 workspace 指向当前原始工作目录

#### 第三步：旧 API 自动补 projectId

例如原有：

- `createSession()`
- `listChats()`
- `runAgent()`

在内部自动映射为：

```ts
projectId = currentProject || 'main'
```

#### 第四步：UI 渐进暴露项目功能

第一阶段只增加：

- 项目切换器
- 当前 Chat 的项目归属展示
- 创建 Chat 时可选择项目

### 11.3 兼容收益

- 老用户几乎无感迁移
- 旧代码路径仍可工作
- 新系统可以逐步接管核心流程

---

## 12. 权限与安全边界设计

Project 引入后，最自然的附加收益是安全边界更清晰。

### 12.1 项目作为权限边界

建议以下能力按项目管理：

- 可访问目录
- 可用工具白名单
- 环境变量注入
- 模型访问权限
- 后台任务能力
- 外部连接能力

### 12.2 跨项目访问原则

默认禁止隐式跨项目访问。

如果确实需要：

- 项目 A 的 Agent 访问项目 B 资源
- 必须显式授权
- 需要日志记录

### 12.3 文件写入安全

同一项目内也应做保护：

- 写操作落审计日志
- 同文件修改引入锁
- 提供冲突提示

---

## 13. 典型使用场景

### 场景 1：一个项目，多 Chat

项目 `my-openclaw` 下：

- Chat 1：项目化改造设计
- Chat 2：数据库迁移方案
- Chat 3：前端 UI 重构

这些 Chat 都属于同一个项目，共享项目知识，但对话上下文独立。

### 场景 2：一个项目，多 Agent 协作

在 `my-openclaw` 项目中：

- PM Agent 负责需求拆解
- Backend Agent 负责 API 设计
- Frontend Agent 负责页面结构
- QA Agent 负责测试矩阵

它们可以共享项目级 Memory，但拥有独立的 Session 与执行轨迹。

### 场景 3：多个项目并行

- 项目 A：OpenClaw 改造
- 项目 B：客户系统交付
- 项目 C：个人实验项目

三者同时运行：

- 不同目录
- 不同 Memory
- 不同 Agent
- 不同 Chat
- 不同任务队列

这是本次改造最核心的目标价值。

---

## 14. 实施路线图

建议分四个阶段实施。

### Phase 1：引入 Project 概念，保持旧行为

#### 目标

- 落地 `Project` 数据模型
- 增加默认项目 `main`
- 让旧 chats/sessions 自动挂到 `main`
- UI 增加项目切换器雏形

#### 风险

- 风险最低
- 对旧逻辑影响最小

---

### Phase 2：Chat / Session 项目化

#### 目标

- 新建 Chat 必须属于某个项目
- 新建 Session 必须绑定项目
- 工作目录、memory、运行参数从项目继承
- Chat 列表按项目隔离

#### 结果

- 项目成为真正的业务组织单位

---

### Phase 3：Agent 项目化

#### 目标

- 支持项目内管理 Agent Template
- 支持项目内生成 Agent Instance
- Chat 可绑定默认 Agent
- 支持多 Agent 在同项目下协作

#### 结果

- 完成“项目内创建和使用 Agent”能力

---

### Phase 4：多项目并发与运行时隔离

#### 目标

- 引入 Project Runtime Manager
- 支持多项目并发运行
- 引入任务队列、资源锁、后台任务管理
- 完善监控、日志、审计

#### 结果

- 完成“不同项目开启不同 Chat，且可同时工作”能力

---

## 15. 推荐的目录 / 模块改造方向

下面给一版偏工程化的模块拆分建议。

### 15.1 后端模块

```text
server/
  projects/
    project.service.ts
    project.controller.ts
    project.repo.ts
  chats/
    chat.service.ts
    chat.controller.ts
  sessions/
    session.service.ts
    session.controller.ts
  agents/
    agent-template.service.ts
    agent-instance.service.ts
  runtime/
    global-runtime-manager.ts
    project-runtime-manager.ts
    session-runner.ts
  memory/
    memory.service.ts
  workspaces/
    workspace.service.ts
```

### 15.2 前端模块

```text
ui/
  pages/
    projects/
    chats/
    agents/
  components/
    ProjectSwitcher.tsx
    ChatList.tsx
    AgentPanel.tsx
    ProjectSettings.tsx
  stores/
    projectStore.ts
    chatStore.ts
    sessionStore.ts
    agentStore.ts
```

### 15.3 状态管理建议

前端状态建议至少按 `projectId` 做一级 key：

```ts
state = {
  currentProjectId,
  projects: {},
  chatsByProject: {},
  agentsByProject: {},
  sessionsByProject: {}
}
```

---

## 16. 最终建议与结论

如果目标是：

- 保留 OpenClaw 当前所有功能
- 新增项目管理能力
- 支持项目内 Agent
- 让 Session / Chat 真正基于项目
- 支持多项目多 Chat 并发工作

那么最稳妥、最清晰、可迭代成本最低的方案就是：

> **以 Project 作为新的一级作用域，将 Chat、Session、Agent、Memory、Workspace、权限和 Runtime 全部纳入 Project 之下，同时通过默认项目 `main` 实现对旧系统的向上兼容。**

这是本次方案的核心结论。

---

## 17. 下一步建议

建议紧接着输出第二份文档：

1. **《OpenClaw 项目化改造实施方案 v1》**
   - 拆解为开发任务列表
   - 按前后端/数据库/运行时分工

2. **《OpenClaw 项目化数据迁移方案 v1》**
   - 数据表迁移顺序
   - 回滚策略
   - 兼容验证清单

3. **《OpenClaw 项目化 UI 原型说明 v1》**
   - 页面布局
   - 核心交互流程
   - 状态切换设计

如果继续，我建议下一步先写第 1 份：

> **《OpenClaw 项目化改造实施方案 v1》**

这样就可以从“设计”直接进入“落地”。
