# OpenClaw 项目化 UI 原型说明 v1

> 配套文档：
> - `OpenClaw-项目化改造设计-v1.md`
> - `OpenClaw-项目化改造实施方案-v1.md`
> - `OpenClaw-项目化数据迁移方案-v1.md`

这份文档聚焦前端和产品视角，目标是把“项目化能力”落成明确页面结构、核心交互和状态表现。

---

## 1. 设计目标

在保留当前 OpenClaw 使用习惯的前提下，引入清晰的“项目”层级，让用户可以：

1. 管理多个项目
2. 在项目内查看和创建 Chat
3. 在项目内管理 Agent
4. 在多个项目中并行工作
5. 明确知道当前上下文属于哪个项目、哪个 Chat、哪个 Agent

### 核心体验原则

- **默认不打断旧用户路径**
- **项目切换要轻量、直观**
- **信息层级清楚，避免 session/chat/agent 混乱**
- **并发状态可见，但不制造界面噪音**
- **项目是一级导航，不只是过滤条件**

---

## 2. 信息架构

建议 UI 从“单会话导航”调整为“项目优先导航”。

### 2.1 顶层结构

```text
App
 ├── Top Bar
 │    ├── Project Switcher
 │    ├── Search
 │    ├── Global Status
 │    └── User Menu
 ├── Left Sidebar
 │    ├── Chats
 │    ├── Agents
 │    ├── Files
 │    ├── Memory
 │    ├── Activity
 │    └── Settings
 ├── Main Content
 │    └── 当前模块内容
 └── Right Panel（可选）
      ├── Session Status
      ├── Agent Info
      └── Background Tasks
```

### 2.2 一级导航：Project

用户看到的最上层上下文应该是：

- 当前项目是谁
- 当前项目有哪些 Chat
- 当前项目有哪些 Agent
- 当前项目最近在做什么

这比把项目藏在设置里更符合用户心智。

---

## 3. 核心页面设计

---

## 3.1 Project Switcher

### 位置

顶部导航左上角。

### 作用

- 切换当前项目
- 新建项目
- 快速查看最近项目

### 原型结构

```text
┌─────────────────────────────┐
│ [ my-openclaw ▼ ]           │
└─────────────────────────────┘

展开后：

┌─────────────────────────────┐
│ 当前项目                     │
│  • my-openclaw              │
│ 最近项目                     │
│  • client-a                 │
│  • personal-lab             │
│ --------------------------- │
│ + 新建项目                  │
│ 管理项目                    │
└─────────────────────────────┘
```

### 交互说明

- 点击项目名称展开
- 选择项目后，左侧内容与主区域全部切换到该项目作用域
- 切换项目时可默认打开该项目最近访问的 Chat

---

## 3.2 项目主页 / Dashboard

### 目标

切到某个项目后，优先展示该项目概览，而不是空白页。

### 原型结构

```text
项目：my-openclaw
-------------------------------------------------
最近 Chats
- 项目化改造设计
- 数据迁移方案
- UI 原型讨论

Agents
- PM Agent
- Backend Agent
- QA Agent

最近活动
- 12:40 PM Backend Agent 更新 API 说明
- 12:32 PM PM Agent 创建新任务清单
- 12:18 PM Chat「数据迁移方案」有新输出

快捷操作
[ 新建 Chat ] [ 新建 Agent ] [ 打开文件 ] [ 项目设置 ]
```

### 适用场景

- 项目刚创建
- 用户切换项目后需要快速感知现状
- 适合作为项目默认 landing page

---

## 3.3 项目内 Chat 列表

### 目标

每个项目有独立 Chat 列表，避免多项目对话混杂。

### 左侧结构建议

```text
项目：my-openclaw
--------------------------------
[ + New Chat ]

Chats
- 项目化改造设计
- 数据迁移方案
- UI 原型说明
- 运行时隔离讨论

Agents
- PM Agent
- Backend Agent
- QA Agent

Activity
Settings
```

### Chat Item 样式建议

每条 Chat 展示：

- 标题
- 默认 Agent
- 最近更新时间
- 状态标签

示例：

```text
[●] 项目化改造设计
    PM Agent · 2 分钟前

[↻] 数据迁移方案
    Backend Agent · 正在运行

[!] UI 原型说明
    等待输入
```

状态建议：

- `●` 活跃 / 最近有活动
- `↻` 正在运行
- `…` 后台处理中
- `!` 等待用户输入
- `✓` 已完成最近任务

---

## 3.4 Chat 详情页

### 目标

保留现有聊天体验，但把项目与 Agent 信息补清楚。

### 原型结构

```text
顶部：
my-openclaw / 项目化改造设计
-------------------------------------------------
默认 Agent: PM Agent   模型: gpt-5.4   目录: /pm

中间：消息流
-------------------------------------------------
用户消息...
Agent 回复...
系统事件...

底部：输入框
-------------------------------------------------
[ 输入消息... ] [ 发送 ]
```

### 右侧附加面板建议

```text
Session Info
- Session ID
- Status: Running
- Working Dir: /mnt/d/workspace/my-openclaw/pm
- Memory Scope: Project

Agent Info
- PM Agent
- Skills: planning, writing
- Tools: read, write, exec

Background Tasks
- 生成实施方案（完成）
- 整理 API 草案（运行中）
```

### 交互增强建议

- 顶部明确显示项目名
- 可快速切换默认 Agent
- 可查看当前 Session 的工作目录与状态

---

## 3.5 新建 Chat 弹窗

### 目标

让用户在创建 Chat 时明确它属于哪个项目、默认由谁处理。

### 原型结构

```text
新建 Chat
--------------------------------
项目：        [ my-openclaw ▼ ]
标题：        [ 项目化改造设计 ]
默认 Agent：  [ PM Agent ▼ ]
工作目录：    [ /mnt/d/workspace/my-openclaw/pm ]
模型：        [ 使用项目默认 ▼ ]

[ 取消 ] [ 创建 ]
```

### 默认规则

- 项目：默认当前项目
- 默认 Agent：项目默认 Agent 或上次使用的 Agent
- 工作目录：项目主 workspace
- 模型：继承项目默认配置

---

## 3.6 Agent 管理页

### 目标

让项目内 Agent 变成可见、可维护、可复用的资源。

### 原型结构

```text
Agents / my-openclaw
-------------------------------------------------
[ + New Agent ]

- PM Agent
  角色：产品经理 / 需求拆解
  Skills: planning, docs
  最近使用：2 分钟前

- Backend Agent
  角色：后端设计 / API / 数据库
  Skills: coding, sql
  最近使用：20 分钟前

- QA Agent
  角色：测试与验证
  Skills: testing, review
  最近使用：昨天
```

### Agent 详情页建议展示

- 名称
- 角色
- System Prompt
- Skills
- Tools
- 默认工作目录
- Memory 模式
- 最近活跃 chats / sessions

### 交互建议

- 支持复制 Agent
- 支持从全局模板导入
- 支持设为项目默认 Agent

---

## 3.7 新建 Agent 弹窗

### 原型结构

```text
新建 Agent
--------------------------------
所属项目：      [ my-openclaw ▼ ]
名称：          [ PM Agent ]
角色：          [ 产品经理 ]
System Prompt： [ ... ]
Skills：        [ 多选 ]
Tools：         [ 多选 ]
Memory：        [ shared-project / isolated ]
执行模式：      [ interactive / background ]

[ 取消 ] [ 创建 ]
```

### 第一版建议

第一版不要把配置做得过度复杂。

保留关键字段就够：

- 名称
- 角色
- Prompt
- Skills
- Tools
- Memory Mode

---

## 3.8 Files 页面

### 目标

让用户知道当前项目关联了哪些目录。

### 原型结构

```text
Files / my-openclaw
-------------------------------------------------
Workspaces
- Primary: D:\workspace\my-openclaw
- Docs:    D:\workspace\my-openclaw\pm
- Assets:  D:\workspace\my-openclaw\assets

当前默认目录：D:\workspace\my-openclaw\pm
```

### 交互建议

- 查看项目挂载目录
- 修改主 workspace
- 新增附属 workspace
- 标记只读目录

---

## 3.9 Memory 页面

### 目标

让用户看到项目级记忆，而不是黑盒。

### 原型结构

```text
Memory / my-openclaw
-------------------------------------------------
项目长期记忆
- 当前目标：实现项目化能力
- 已确认：Project 为一级作用域
- 默认目录：D:\workspace\my-openclaw
- 当前重点：实施方案 / 迁移方案 / UI 原型

Chat 记忆
- 项目化改造设计：已完成第一版
- 数据迁移方案：待评审
```

### 交互建议

- 支持查看项目长期记忆
- 支持按 Chat 查看上下文摘要
- 后续可加“固定记忆 / 临时记忆”分类

---

## 3.10 Activity 页面

### 目标

给项目提供一条清晰的运行轨迹。

### 原型结构

```text
Activity / my-openclaw
-------------------------------------------------
13:08 PM  PM Agent   创建文档：实施方案-v1
13:02 PM  Backend    更新 chat：数据迁移方案
12:50 PM  Session    写入文件：pm/xxx.md
12:45 PM  User       新建 Chat：UI 原型说明
```

### 展示价值

- 快速看项目最近发生了什么
- 方便排查谁改了什么
- 为后续审计与协作打基础

---

## 3.11 项目设置页

### 建议字段

```text
Project Settings / my-openclaw
-------------------------------------------------
名称：my-openclaw
描述：OpenClaw 项目化改造
根目录：D:\workspace\my-openclaw
默认模型：gpt-5.4
默认 Agent：PM Agent
时区：Asia/Shanghai
Memory 策略：Project
工具策略：默认项目白名单
```

### 可操作项

- 修改项目名称与描述
- 修改根目录
- 设定默认模型
- 设定默认 Agent
- 配置工具权限
- 归档项目

---

## 4. 多项目并发体验设计

这是本次 UI 中最容易忽略，但价值很高的一块。

### 4.1 顶部全局状态区

建议在顶部保留一块“全局运行状态”。

#### 示例

```text
Global Status
- Running Chats: 3
- Background Tasks: 2
- Active Projects: 2
```

点击后展开：

```text
正在运行
- my-openclaw / 数据迁移方案
- my-openclaw / UI 原型说明
- client-a / 发布排查
```

### 4.2 项目切换时的提醒

如果当前项目里有后台任务：

- 切走项目不应中断任务
- UI 可以轻量提示“该项目仍有 2 个任务在运行”

### 4.3 Chat 列表中的并发提示

建议给运行中的 Chat 加醒目标识，但不要整页乱闪。

---

## 5. 兼容旧用户的 UI 策略

### 5.1 默认项目 main

对旧用户来说，首次升级后看到的应是：

- 系统自动进入 `main`
- 原有 chat 仍能看到
- 没有强迫理解复杂项目概念

### 5.2 项目入口渐进暴露

可按阶段开放：

#### 第一阶段

- 顶部显示项目切换器
- 默认只有 `main`

#### 第二阶段

- 支持新建项目
- Chat 列表按项目过滤

#### 第三阶段

- 开放项目内 Agent 页面
- 开放项目设置 / memory / activity

---

## 6. 关键交互流程

### 6.1 创建项目流程

```text
点击 Project Switcher
 -> 新建项目
 -> 输入名称
 -> 绑定根目录
 -> 选择默认模型
 -> 创建
 -> 跳转到项目主页
```

### 6.2 创建 Chat 流程

```text
进入项目
 -> 点击 New Chat
 -> 输入标题
 -> 选择默认 Agent
 -> 选择目录 / 模型
 -> 创建
 -> 跳转到 Chat 页
```

### 6.3 创建 Agent 流程

```text
进入项目
 -> 打开 Agents
 -> 点击 New Agent
 -> 填写角色与 Prompt
 -> 选择技能与工具
 -> 创建
```

### 6.4 并发工作流程

```text
项目 A 中打开 Chat 1 并运行任务
 -> 切换到项目 B
 -> 打开 Chat 2 并运行另一个任务
 -> 顶部状态显示两个项目均有运行中的工作
```

---

## 7. 空状态设计建议

### 7.1 新项目空状态

```text
这个项目还没有内容
[ 新建 Chat ] [ 新建 Agent ] [ 绑定目录 ]
```

### 7.2 无 Agent 空状态

```text
当前项目还没有 Agent
建议先创建一个 PM Agent 或 Backend Agent
[ 新建 Agent ]
```

### 7.3 无 Activity 空状态

```text
这个项目还没有活动记录
创建一个 Chat 开始工作吧
```

---

## 8. 视觉层级建议

### 应重点突出的信息

1. 当前项目名
2. 当前 Chat 标题
3. 当前 Agent
4. 当前状态（运行中 / 等待中）

### 应弱化但可见的信息

1. session id
2. model 细节
3. memory scope
4. 运行时参数

这些信息适合放右侧面板或 tooltip，不要淹没主聊天体验。

---

## 9. 第一版最小可用 UI 范围（MVP）

如果希望尽快落地，不建议一上来全做完。

### MVP 建议只做这些

- Project Switcher
- 项目内 Chat 列表
- 新建项目
- 新建 Chat
- Chat 详情页显示项目名 + 默认 Agent
- 基础 Agent 列表页

### 第二阶段再补

- Memory 页面
- Activity 页面
- Files / Workspace 管理
- 多 chat 并发总览
- 更完整的 Agent 配置页

---

## 10. 最终建议

如果你想让这次项目化改造在 UI 上足够自然，我的建议是：

> **把 Project 做成一级导航和一级心智模型，而不是一个隐藏的筛选条件。**

用户真正理解之后，后面的 Chat、Session、Agent 关系都会自然很多。

---

## 11. 可继续补充的下一步

如果后面要继续往前推进，建议下一批再补：

1. 低保真页面线框图（ASCII / Mermaid / Figma 文本说明）
2. 前端状态机说明
3. 组件拆分与路由设计
4. Chat / Agent / Activity 的交互细节稿

如果你要，我下一步可以继续在 `pm/` 下补一份：

- `OpenClaw-项目化低保真线框图-v1.md`

这样前端就更容易直接开工。