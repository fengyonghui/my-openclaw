# OpenClaw Backend API 设计 v1

## 1. 基础信息
- **Base URL**: `/api/v1`
- **Auth**: Bearer Token
- **Content-Type**: `application/json`

## 2. 项目管理 (Projects)

### 2.1 获取项目详情
`GET /projects/:projectId`
- 返回项目的核心配置、统计数据和最近活动。

### 2.2 获取项目列表
`GET /projects`
- 返回当前用户有权访问的所有项目。

## 3. 会话管理 (Chats)

### 3.1 创建新会话
`POST /projects/:projectId/chats`
- **Request Body**:
  ```json
  {
    "title": "可选标题",
    "agentId": "指定的 agent id"
  }
  ```

### 3.2 发送消息 (Stream)
`POST /chats/:chatId/send`
- **Request Body**:
  ```json
  {
    "content": "消息内容",
    "context": ["可选的上下文文件路径"]
  }
  ```
- **Response**: Server-Sent Events (SSE)

## 4. Agent 管理 (Agents)

### 4.1 获取项目内 Agents
`GET /projects/:projectId/agents`
- 返回该项目作用域内所有已定义的 Agent（包括全局 Agent 和项目专属 Agent）。

### 4.2 更新 Agent 配置
`PATCH /agents/:agentId`
- 用于修改 Agent 的 Persona、默认模型、挂载目录等。

## 5. 存储与检索 (Files & Memory)

### 5.1 文件树检索
`GET /projects/:projectId/files/tree`

### 5.2 记忆检索
`GET /projects/:projectId/memory`
- 返回 MEMORY.md 的结构化数据或 RAG 检索结果。
