# OpenClaw 项目化数据库表设计 v1

> 配套文档：
> - `OpenClaw-项目化改造设计-v1.md`
> - `OpenClaw-项目化数据迁移方案-v1.md`
> - `OpenClaw-项目化API详细设计-v1.md`

本文件给出 OpenClaw 项目化改造后推荐的数据库表结构设计，目标是为 Project / Chat / Session / Agent / Workspace / Memory / Activity 提供统一数据基础。

---

## 1. 设计目标

1. 将 Project 提升为一级作用域
2. 所有核心资源明确归属于项目
3. 支持 Agent 模板与实例拆分
4. 支持后续多项目并发与审计追踪
5. 兼容旧结构，允许渐进迁移

---

## 2. 核心实体关系

```text
projects
 ├── workspaces
 ├── chats
 │    ├── chat_messages
 │    ├── chat_memories
 │    └── sessions
 │         ├── session_events
 │         ├── session_memories
 │         └── agent_instances
 ├── agent_templates
 ├── project_memories
 ├── project_activities
 └── audit_logs
```

---

## 3. 表设计

---

## 3.1 projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  root_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 字段说明

- `id`：主键，建议使用稳定 uuid / cuid / nanoid
- `slug`：用于路由与展示
- `root_path`：项目主目录
- `config_json`：项目默认模型、时区、memoryPolicy、toolPolicy 等

---

## 3.2 workspaces

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_workspaces_project_id ON workspaces(project_id);
```

### 说明

- 一个项目可挂多个 workspace
- 仅允许一个 `is_primary = 1`，该约束可在应用层保证

---

## 3.3 chats

```sql
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'human-agent',
  default_agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_chats_project_id ON chats(project_id);
CREATE INDEX idx_chats_project_updated ON chats(project_id, updated_at DESC);
```

### 推荐枚举

- `channel`: `webchat | telegram | discord | signal | internal`
- `mode`: `human-agent | multi-agent | group`
- `status`: `active | closed | archived`

---

## 3.4 chat_messages

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  session_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id, created_at ASC);
CREATE INDEX idx_chat_messages_project_id ON chat_messages(project_id);
```

### 说明

- 冗余 `project_id` 是为了加速过滤与审计
- `role` 建议支持 `user | assistant | system | tool`

---

## 3.5 sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  agent_id TEXT,
  cwd TEXT,
  runtime_json TEXT,
  memory_scope TEXT NOT NULL DEFAULT 'project',
  status TEXT NOT NULL DEFAULT 'active',
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_chat_id ON sessions(chat_id);
CREATE INDEX idx_sessions_project_status ON sessions(project_id, status);
```

### 推荐枚举

- `memory_scope`: `project | chat | session | agent`
- `status`: `active | idle | background | terminated | error`

---

## 3.6 session_events

```sql
CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_session_events_session_id ON session_events(session_id, created_at ASC);
CREATE INDEX idx_session_events_project_id ON session_events(project_id);
```

### 用途

用于记录：

- session 启动/停止
- tool 调用
- 状态变化
- 后台任务进度
- 错误信息

---

## 3.7 agent_templates

```sql
CREATE TABLE agent_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT,
  skills_json TEXT,
  tools_json TEXT,
  memory_mode TEXT NOT NULL DEFAULT 'shared-project',
  execution_mode TEXT NOT NULL DEFAULT 'interactive',
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_agent_templates_project_id ON agent_templates(project_id);
```

### 说明

- `project_id = NULL` 可表示全局模板
- 项目模板则必须带 `project_id`

---

## 3.8 agent_instances

```sql
CREATE TABLE agent_instances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  session_id TEXT,
  name TEXT,
  status TEXT NOT NULL,
  runtime_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (template_id) REFERENCES agent_templates(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_agent_instances_project_id ON agent_instances(project_id);
CREATE INDEX idx_agent_instances_session_id ON agent_instances(session_id);
CREATE INDEX idx_agent_instances_template_id ON agent_instances(template_id);
```

### 推荐枚举

- `status`: `idle | running | waiting | error | stopped`

---

## 3.9 memories

建议统一 memory 表，而不是拆很多散表。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_memories_project_id ON memories(project_id);
CREATE INDEX idx_memories_scope ON memories(scope_type, scope_id);
```

### 推荐取值

- `scope_type`: `global | project | chat | session | agent`
- `kind`: `summary | rule | preference | decision | note`

---

## 3.10 project_activities

```sql
CREATE TABLE project_activities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_project_activities_project_id ON project_activities(project_id, created_at DESC);
```

### 用途

记录项目级活动流，如：

- 创建 chat
- 启动 session
- 生成 agent 输出
- 写入文件
- 更新 memory

---

## 3.11 audit_logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  result TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_audit_logs_project_id ON audit_logs(project_id, created_at DESC);
```

### 用途

记录更严肃的审计行为，例如：

- 文件修改
- 权限拒绝
- 跨项目访问尝试
- 配置变更
- 删除/归档操作

---

## 4. 表关系约束建议

### 强约束

1. `chats.project_id` 必须存在
2. `sessions.project_id` 必须存在
3. `sessions.chat_id` 必须存在
4. `agent_instances.project_id` 必须存在

### 应用层校验

以下关系建议在应用层强校验：

- `session.project_id == chat.project_id`
- `agent_instance.project_id == session.project_id`
- `workspace.project_id == current_project_id`

这样比复杂数据库触发器更容易维护。

---

## 5. 冗余字段策略

有些字段建议冗余，例如：

- `chat_messages.project_id`
- `session_events.project_id`
- `memories.project_id`

原因：

1. 查询高频
2. 便于按项目过滤
3. 审计更方便
4. 减少多表 join 压力

---

## 6. 索引策略建议

高频查询应重点覆盖：

- 按项目查 chats
- 按项目查 sessions
- 按 chat 拉消息
- 按 session 拉事件
- 按项目查 activities
- 按作用域查 memory

如果后续数据量变大，可补：

- `created_at / updated_at` 组合索引
- `status` 组合索引
- `actor_type / action` 审计索引

---

## 7. 迁移建议

### 第一阶段

- 新建 `projects`、`workspaces`、`agent_templates`、`agent_instances`
- 旧表加 `project_id`
- 插入默认项目 `main`
- 回填 chat / session 的 `project_id`

### 第二阶段

- 前端与 API 全量改为显式项目作用域
- 新写入强制带 `project_id`

### 第三阶段

- 补 `NOT NULL`
- 补外键
- 补索引
- 清理兼容分支

---

## 8. 推荐枚举总表

### projects.status

- `active`
- `paused`
- `archived`

### chats.status

- `active`
- `closed`
- `archived`

### sessions.status

- `active`
- `idle`
- `background`
- `terminated`
- `error`

### agent_instances.status

- `idle`
- `running`
- `waiting`
- `error`
- `stopped`

### memories.scope_type

- `global`
- `project`
- `chat`
- `session`
- `agent`

---

## 9. 最终建议

数据库层的关键不是“表多漂亮”，而是保证一句话：

> **所有高价值资源都能回答“它属于哪个项目”。**

只要这个边界清楚，后面的 API、UI、并发和权限都容易落地。
