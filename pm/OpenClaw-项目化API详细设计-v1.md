# OpenClaw 项目化 API 详细设计 v1

> 配套文档：
> - `OpenClaw-项目化改造设计-v1.md`
> - `OpenClaw-项目化改造实施方案-v1.md`
> - `OpenClaw-项目化数据库表设计-v1.md`

本文档定义项目化改造后建议的 API 边界、资源模型、请求响应结构、兼容策略与错误约定。

---

## 1. 设计目标

API 设计目标：

1. 所有核心资源都显式归属于 Project
2. 保留旧接口兼容路径
3. 资源路径清晰反映归属关系
4. 支持前端快速构建项目化 UI
5. 支持后续多 Agent、多 Session 并发演进

---

## 2. 设计原则

### 2.1 资源优先

统一采用 REST 风格为主，必要时补充动作型子路径。

### 2.2 项目作用域显式化

新增接口优先采用：

```http
/api/projects/:projectId/...
```

### 2.3 兼容旧接口

旧接口如果暂不下线，应在服务端自动补：

```ts
projectId = currentProjectId || 'main'
```

### 2.4 错误语义明确

必须能区分：

- 项目不存在
- 资源不属于该项目
- 项目与 chat/session/agent 归属冲突
- 资源冲突（如文件锁）

---

## 3. 通用约定

### 3.1 Header 建议

```http
X-Project-Id: my-openclaw
X-Request-Id: xxx
```

注意：
- 新接口以路径中的 `projectId` 为准
- Header 可用于兼容旧接口或日志追踪

### 3.2 返回格式建议

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

错误时：

```json
{
  "ok": false,
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "Project not found"
  }
}
```

### 3.3 时间格式

统一使用 ISO 8601。

---

## 4. Project API

---

### 4.1 获取项目列表

```http
GET /api/projects
```

#### 响应

```json
{
  "ok": true,
  "data": [
    {
      "id": "main",
      "name": "Main",
      "slug": "main",
      "status": "active",
      "rootPath": "D:\\workspace\\my-openclaw",
      "createdAt": "2026-03-22T06:00:00.000Z",
      "updatedAt": "2026-03-22T06:00:00.000Z"
    }
  ]
}
```

---

### 4.2 创建项目

```http
POST /api/projects
```

#### 请求体

```json
{
  "name": "my-openclaw",
  "slug": "my-openclaw",
  "description": "OpenClaw 项目化改造",
  "rootPath": "D:\\workspace\\my-openclaw",
  "config": {
    "defaultModel": "gpt-5.4",
    "timezone": "Asia/Shanghai",
    "memoryPolicy": "project"
  }
}
```

---

### 4.3 获取项目详情

```http
GET /api/projects/:projectId
```

---

### 4.4 更新项目

```http
PATCH /api/projects/:projectId
```

#### 请求体

```json
{
  "description": "新的描述",
  "config": {
    "defaultModel": "claude-sonnet"
  }
}
```

---

### 4.5 归档项目

```http
POST /api/projects/:projectId/archive
```

---

## 5. Workspace API

---

### 5.1 获取项目 Workspaces

```http
GET /api/projects/:projectId/workspaces
```

### 5.2 新增 Workspace

```http
POST /api/projects/:projectId/workspaces
```

#### 请求体

```json
{
  "name": "Docs",
  "path": "D:\\workspace\\my-openclaw\\pm",
  "isPrimary": false,
  "readOnly": false
}
```

### 5.3 更新 Workspace

```http
PATCH /api/projects/:projectId/workspaces/:workspaceId
```

### 5.4 删除 Workspace

```http
DELETE /api/projects/:projectId/workspaces/:workspaceId
```

---

## 6. Chat API

---

### 6.1 获取项目内 Chat 列表

```http
GET /api/projects/:projectId/chats
```

#### 查询参数

- `status=active|archived|all`
- `keyword=xxx`
- `limit=50`

#### 响应示例

```json
{
  "ok": true,
  "data": [
    {
      "id": "chat_001",
      "projectId": "my-openclaw",
      "title": "项目化改造设计",
      "defaultAgentId": "agent_tpl_pm",
      "status": "active",
      "updatedAt": "2026-03-22T06:10:00.000Z"
    }
  ]
}
```

---

### 6.2 创建 Chat

```http
POST /api/projects/:projectId/chats
```

#### 请求体

```json
{
  "title": "项目化改造设计",
  "defaultAgentId": "agent_tpl_pm",
  "runtime": {
    "cwd": "D:\\workspace\\my-openclaw\\pm",
    "model": "gpt-5.4"
  }
}
```

---

### 6.3 获取 Chat 详情

```http
GET /api/projects/:projectId/chats/:chatId
```

---

### 6.4 更新 Chat

```http
PATCH /api/projects/:projectId/chats/:chatId
```

#### 请求体

```json
{
  "title": "项目化改造设计 v2",
  "defaultAgentId": "agent_tpl_backend"
}
```

---

### 6.5 归档 Chat

```http
POST /api/projects/:projectId/chats/:chatId/archive
```

---

### 6.6 获取 Chat 消息

```http
GET /api/projects/:projectId/chats/:chatId/messages
```

### 6.7 发送消息到 Chat

```http
POST /api/projects/:projectId/chats/:chatId/messages
```

#### 请求体

```json
{
  "role": "user",
  "content": "帮我重新设计项目化架构",
  "sessionId": "sess_001"
}
```

---

## 7. Session API

---

### 7.1 获取项目内 Session 列表

```http
GET /api/projects/:projectId/sessions
```

### 7.2 创建 Session

```http
POST /api/projects/:projectId/sessions
```

#### 请求体

```json
{
  "chatId": "chat_001",
  "agentId": "agent_tpl_pm",
  "runtime": {
    "cwd": "D:\\workspace\\my-openclaw\\pm",
    "model": "gpt-5.4",
    "tools": ["read", "write", "exec"]
  },
  "memoryScope": "project"
}
```

---

### 7.3 获取 Session 详情

```http
GET /api/projects/:projectId/sessions/:sessionId
```

---

### 7.4 启动 Session

```http
POST /api/projects/:projectId/sessions/:sessionId/run
```

#### 请求体

```json
{
  "input": "继续输出 API 详细设计"
}
```

---

### 7.5 停止 Session

```http
POST /api/projects/:projectId/sessions/:sessionId/stop
```

---

### 7.6 将 Session 切到后台

```http
POST /api/projects/:projectId/sessions/:sessionId/background
```

---

### 7.7 获取 Session 事件流

```http
GET /api/projects/:projectId/sessions/:sessionId/events
```

可用于 SSE / 流式输出。

---

## 8. Agent API

---

## 8.1 Agent Template API

### 8.1.1 获取项目 Agent 模板列表

```http
GET /api/projects/:projectId/agents
```

### 8.1.2 创建 Agent 模板

```http
POST /api/projects/:projectId/agents
```

#### 请求体

```json
{
  "name": "PM Agent",
  "role": "产品经理",
  "systemPrompt": "你是项目经理，负责拆解任务和输出文档。",
  "skills": ["planning", "writing"],
  "tools": ["read", "write", "exec"],
  "memoryMode": "shared-project",
  "executionMode": "interactive"
}
```

### 8.1.3 获取 Agent 详情

```http
GET /api/projects/:projectId/agents/:agentId
```

### 8.1.4 更新 Agent

```http
PATCH /api/projects/:projectId/agents/:agentId
```

### 8.1.5 复制 Agent

```http
POST /api/projects/:projectId/agents/:agentId/clone
```

### 8.1.6 从全局模板导入

```http
POST /api/projects/:projectId/agents/import
```

#### 请求体

```json
{
  "sourceAgentId": "global_pm_template"
}
```

---

## 8.2 Agent Instance API

### 8.2.1 生成 Agent 实例

```http
POST /api/projects/:projectId/agents/:agentId/spawn
```

#### 请求体

```json
{
  "chatId": "chat_001",
  "sessionId": "sess_001"
}
```

### 8.2.2 获取 Agent 实例详情

```http
GET /api/projects/:projectId/agent-instances/:instanceId
```

### 8.2.3 停止 Agent 实例

```http
POST /api/projects/:projectId/agent-instances/:instanceId/stop
```

---

## 9. Memory API

---

### 9.1 获取项目 Memory

```http
GET /api/projects/:projectId/memory
```

### 9.2 更新项目 Memory

```http
PATCH /api/projects/:projectId/memory
```

#### 请求体

```json
{
  "content": "项目长期记忆内容..."
}
```

### 9.3 获取 Chat Memory

```http
GET /api/projects/:projectId/chats/:chatId/memory
```

### 9.4 更新 Chat Memory

```http
PATCH /api/projects/:projectId/chats/:chatId/memory
```

---

## 10. Activity / Audit API

---

### 10.1 获取项目活动流

```http
GET /api/projects/:projectId/activity
```

#### 查询参数

- `limit=50`
- `cursor=xxx`
- `type=chat|session|agent|file`

### 10.2 获取项目审计日志

```http
GET /api/projects/:projectId/audit-logs
```

---

## 11. 全局运行状态 API

---

### 11.1 获取全局运行概览

```http
GET /api/runtime/overview
```

#### 响应示例

```json
{
  "ok": true,
  "data": {
    "activeProjects": 2,
    "runningChats": 3,
    "backgroundTasks": 2
  }
}
```

### 11.2 获取运行中项目列表

```http
GET /api/runtime/projects
```

---

## 12. 兼容旧接口策略

如果保留旧接口，例如：

```http
POST /api/chats
POST /api/sessions
GET /api/chats/:chatId
```

则服务端应：

1. 从 Header 读取 `X-Project-Id`
2. 若没有，则使用当前上下文项目
3. 若仍没有，则回退 `main`

### 兼容原则

- 旧接口短期不删除
- 新功能优先只走项目化新接口
- 中后期逐步废弃旧路径

---

## 13. 错误码建议

```text
PROJECT_NOT_FOUND
PROJECT_ARCHIVED
CHAT_NOT_FOUND
SESSION_NOT_FOUND
AGENT_NOT_FOUND
RESOURCE_SCOPE_MISMATCH
WORKSPACE_NOT_FOUND
WORKSPACE_WRITE_CONFLICT
INVALID_RUNTIME_CONFIG
MEMORY_SCOPE_INVALID
PROJECT_ACCESS_DENIED
```

### 示例

```json
{
  "ok": false,
  "error": {
    "code": "RESOURCE_SCOPE_MISMATCH",
    "message": "Session does not belong to the specified project"
  }
}
```

---

## 14. 事件流与推送建议

如果系统已有 WebSocket / SSE，建议频道命名显式项目化：

```text
project:{projectId}
project:{projectId}:chat:{chatId}
project:{projectId}:session:{sessionId}
```

这样前端订阅关系更清晰，也能避免跨项目串事件。

---

## 15. API 落地顺序建议

优先实现：

1. Project API
2. Workspace API
3. Chat API
4. Session API
5. Agent API
6. Memory / Activity API
7. Runtime Overview API

---

## 16. 最终建议

这套 API 的关键点只有一句话：

> **让资源路径天然表达“它属于哪个项目”。**

一旦路径设计清楚，前端、后端、日志、权限和调试都会简单很多。
