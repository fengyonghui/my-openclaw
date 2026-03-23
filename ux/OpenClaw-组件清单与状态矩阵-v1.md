# OpenClaw 组件清单与状态矩阵 v1

> 用于把界面设计转成前端组件与状态设计基线，减少实现阶段风格漂移和漏状态问题。

---

# 🎨 UI/UX 实现方案：组件清单与状态矩阵

## UX 分析
- 很多界面问题不是布局错，而是组件状态不完整。
- 如果按钮、卡片、聊天消息、侧边栏项没有统一状态定义，后期很容易越做越乱。
- 项目化场景下，“选中、运行中、等待中、错误中”是高频状态，必须统一抽象。

## 设计决策
- 所有核心组件按“基础组件 / 导航组件 / 业务组件 / 反馈组件”分类。
- 每个组件必须定义最少状态集：默认、悬停、激活、禁用、加载、错误（按需）。
- 状态表达采用：颜色 + 图标 + 文案，避免单一颜色传达。

---

## 1. 基础组件

### 1.1 Button

#### 变体
- Primary
- Secondary
- Ghost
- Danger
- Link

#### 状态矩阵
| 状态 | 表现 |
| :--- | :--- |
| Default | 正常颜色、正常阴影 |
| Hover | 背景略强调、阴影增强 |
| Active | 轻微按压感 |
| Disabled | 降低透明度、不可点击 |
| Loading | 显示 spinner，禁止重复点击 |
|

### 1.2 Input / Textarea

| 状态 | 表现 |
| :--- | :--- |
| Default | 默认边框 |
| Focus | 高亮主色边框 + 阴影 |
| Error | 红色边框 + 错误文案 |
| Disabled | 灰底、文本弱化 |
|

### 1.3 Badge

#### 变体
- Active
- Running
- Waiting
- Error
- Archived
- Info

---

## 2. 导航组件

### 2.1 Project Switcher

| 状态 | 表现 |
| :--- | :--- |
| Default | 展示当前项目 |
| Hover | 背景轻高亮 |
| Expanded | 展开下拉、显示项目列表 |
| Loading | 显示切换中状态 |
|

### 2.2 Sidebar Item

| 状态 | 表现 |
| :--- | :--- |
| Default | 普通文本 + 图标 |
| Hover | 背景轻高亮 |
| Selected | 主色背景或边框高亮 |
| Collapsed | 仅显示图标 |
|

### 2.3 Chat List Item

| 状态 | 表现 |
| :--- | :--- |
| Default | 标题 + Agent + 时间 |
| Hover | 卡片高亮 |
| Selected | 明显选中态 |
| Running | 状态点 / spinner + badge |
| Waiting | 黄色状态标签 |
| Error | 红色提示 |
|

---

## 3. 业务组件

### 3.1 Chat Bubble

#### 类型
- User Message
- Agent Message
- System Message
- Error Message

#### 状态
| 状态 | 表现 |
| :--- | :--- |
| Default | 正常消息样式 |
| Streaming | 底部显示生成中动画 |
| Error | 错误边框 / 提示操作 |
|

### 3.2 Agent Card

| 状态 | 表现 |
| :--- | :--- |
| Default | 展示角色与能力标签 |
| Hover | 抬升 / 边框高亮 |
| Selected | 高亮边框 |
| DefaultAgent | 额外 badge 标记 |
| Disabled | 降低透明度 |
|

### 3.3 Session Info Card

| 状态 | 表现 |
| :--- | :--- |
| Default | 显示 Session 基础信息 |
| Running | 显示状态标签 |
| Error | 红色错误摘要 |
|

### 3.4 Activity Item

| 状态 | 表现 |
| :--- | :--- |
| Default | 时间 + 行为摘要 |
| Hover | 背景高亮 |
| Clickable | 鼠标指针变化 |
|

---

## 4. 反馈组件

### 4.1 Empty State

适用：
- 无 Chat
- 无 Agent
- 无 Activity
- 无 Memory

### 4.2 Error State

适用：
- 接口失败
- 运行失败
- 切换失败
- 权限不足

### 4.3 Loading State

适用：
- Dashboard 初始加载
- Chat 加载历史消息
- Agent 列表加载
- 项目切换中

### 4.4 Toast / Inline Alert

建议：
- 成功轻提示用 Toast
- 关键错误或冲突用 Inline Alert

---

## 5. 推荐组件清单

### Layout 层
- `AppShell`
- `TopBar`
- `Sidebar`
- `ContextPanel`
- `PageHeader`

### Common 层
- `Button`
- `Input`
- `Textarea`
- `Badge`
- `Card`
- `Dropdown`
- `Modal`
- `Tabs`
- `Tooltip`

### Project 层
- `ProjectSwitcher`
- `ProjectSummaryCard`
- `WorkspaceList`

### Chat 层
- `ChatList`
- `ChatListItem`
- `ChatHeader`
- `ChatMessage`
- `Composer`
- `TaskStatusBar`

### Agent 层
- `AgentCard`
- `AgentList`
- `AgentDetails`
- `AgentCreateModal`

### Activity / Memory 层
- `ActivityFeed`
- `ActivityItem`
- `MemoryPanel`
- `MemorySummaryCard`

---

## 6. 下一步建议

建议前端实现时先做：

1. Layout + Common 组件
2. Chat 相关核心组件
3. Agent Card / Activity Feed 等业务组件

这样组件复用率最高，返工最少。
