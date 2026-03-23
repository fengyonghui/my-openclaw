# OpenClaw 项目化数据迁移方案 v1

> 配套文档：
> - `OpenClaw-项目化改造设计-v1.md`
> - `OpenClaw-项目化改造实施方案-v1.md`

本方案聚焦两件事：

1. 如何把现有数据安全迁移到“Project 作用域”模型
2. 出问题时如何回滚、如何验证、如何灰度

---

## 1. 迁移目标

把现有 OpenClaw 的核心数据从“默认全局上下文”迁移为“项目化归属”。

### 目标结果

- 所有 Chat 有明确 `project_id`
- 所有 Session 有明确 `project_id`
- Agent 支持项目级模板 / 实例
- Workspace 能挂到项目
- 后续所有新增数据都基于项目写入

### 总体原则

- **先兼容，后收敛**
- **先加字段，后切流量**
- **先补默认值，后加约束**
- **每一步都可验证、可回退**

---

## 2. 迁移范围

### 涉及数据对象

- projects
- workspaces
- chats
- sessions
- agent definitions / agent runtime
- memory / context metadata
- cache key / index / audit logs

### 不一定立即迁移的内容

- 历史日志全文结构化重建
- 老 memory 文件完全入库
- 全量历史 agent 执行回放索引

这类可以分期做，不必阻塞主迁移。

---

## 3. 迁移策略总览

推荐采用 **四段式迁移**：

```text
第 1 段：加新结构，不改旧读写
第 2 段：回填默认项目 main
第 3 段：新写入走 project 模型
第 4 段：补约束、做清理、收尾
```

这样能最大限度降低一次性切换风险。

---

## 4. 迁移前准备

### 4.1 数据盘点

迁移前必须先做一次清查：

- chat 总量
- session 总量
- 当前 agent 配置形式
- workspace / cwd 来源
- memory 存储位置
- 是否已有用户自定义路径 / profile / 标签

### 4.2 风险识别

重点确认：

1. 哪些表已经有稳定主键
2. 哪些旧记录可能缺字段
3. 哪些逻辑默认用“当前全局工作目录”
4. 哪些缓存键没有明确作用域

### 4.3 备份要求

在正式执行任何迁移脚本前，必须完成：

- 数据库备份
- 关键配置备份
- 旧表结构快照
- 迁移脚本版本归档

如果是文件型存储，也要先整体拷贝备份。

---

## 5. 目标数据结构

### 5.1 projects

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

### 5.2 workspaces

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

### 5.3 chats 扩展

```sql
ALTER TABLE chats ADD COLUMN project_id TEXT;
ALTER TABLE chats ADD COLUMN default_agent_id TEXT;
```

### 5.4 sessions 扩展

```sql
ALTER TABLE sessions ADD COLUMN project_id TEXT;
ALTER TABLE sessions ADD COLUMN runtime_json TEXT;
ALTER TABLE sessions ADD COLUMN memory_scope TEXT;
```

### 5.5 agent 拆分

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

---

## 6. 核心迁移步骤

---

## Step 1：创建默认项目 `main`

### 目标

为所有历史数据提供一个兼容容器。

### 执行逻辑

```sql
INSERT INTO projects (id, name, slug, status, created_at, updated_at)
VALUES ('main', 'Main', 'main', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

如果已存在，则跳过。

### 说明

这个 `main` 项目是兼容桥梁，后续所有旧 chat/session 默认先归进去。

---

## Step 2：给 chats 回填 `project_id`

### 目标

让所有历史 chat 有项目归属。

### 执行逻辑

```sql
UPDATE chats
SET project_id = 'main'
WHERE project_id IS NULL;
```

### 验证

```sql
SELECT COUNT(*) FROM chats WHERE project_id IS NULL;
```

结果应为 0。

---

## Step 3：给 sessions 回填 `project_id`

### 目标

让所有历史 session 有项目归属。

### 执行逻辑

#### 方案 A：优先从 chat 继承

```sql
UPDATE sessions
SET project_id = (
  SELECT chats.project_id
  FROM chats
  WHERE chats.id = sessions.chat_id
)
WHERE project_id IS NULL AND chat_id IS NOT NULL;
```

#### 方案 B：仍为空的回填 main

```sql
UPDATE sessions
SET project_id = 'main'
WHERE project_id IS NULL;
```

### 验证

```sql
SELECT COUNT(*) FROM sessions WHERE project_id IS NULL;
```

结果应为 0。

---

## Step 4：建立 main 项目的默认 workspace

### 目标

把旧系统默认工作目录显式挂到 `main` 项目下。

### 执行逻辑

根据当前系统的默认工作目录写入：

```sql
INSERT INTO workspaces (
  id, project_id, name, path, is_primary, read_only, created_at, updated_at
)
VALUES (
  'ws-main-primary',
  'main',
  'Primary Workspace',
  '/current/default/workspace',
  1,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
```

### 风险

如果旧系统存在多个 cwd 来源，需要先梳理清楚，再决定回填哪个路径。

---

## Step 5：迁移 Agent 定义

### 目标

把现有 Agent 配置拆为模板与实例的可演进结构。

### 迁移建议

#### 场景 A：旧系统只有全局 Agent 定义

则迁移为：

- `agent_templates.project_id = NULL`，表示全局模板
- 或直接迁入 `main` 项目，视产品策略决定

#### 场景 B：旧系统 Agent 已绑定某类会话

则应：

- 抽取“角色定义”进入 `agent_templates`
- 运行态进入 `agent_instances`

### 推荐策略

第一版建议：

- 全局默认 Agent 先转为全局模板
- 后续由用户手动复制到项目内

这样风险更低。

---

## Step 6：Session runtime 补结构化字段

### 目标

把原本散落在代码里的运行态参数开始结构化记录。

### 建议回填内容

- cwd
- model
- tools
- env 摘要
- memoryScope

如果无法完整追溯，可先只填默认值，不强行补历史精细数据。

---

## Step 7：Memory 迁移策略

这是最容易复杂化的一块，所以建议分层处理。

### 策略原则

- 不要求第一版把所有历史 memory 完全结构化
- 先保证新数据按项目写入
- 历史 memory 先通过 `main` 项目兼容承接

### 可选方案

#### 方案 A：软迁移（推荐）

- 保留原 memory 文件 / 原存储方式
- 增加一层 `scope resolver`
- 让新逻辑按 `project/chat/session/agent` 去取对应 memory

优点：风险低。

#### 方案 B：硬迁移

- 全量把历史 memory 入库
- 重建索引和作用域

优点：最终更干净；缺点：工作量大、风险高。

### 建议

第一阶段只做软迁移。

---

## 7. 数据库约束加固顺序

不要一开始就把新字段设成 `NOT NULL`，推荐顺序如下：

### 第一阶段

- 加字段
- 不加强约束

### 第二阶段

- 回填默认值
- 开始新写入强制写 project_id

### 第三阶段

- 检查存量数据是否已清理完
- 再补 `NOT NULL`
- 再补外键约束与索引

### 建议索引

```sql
CREATE INDEX idx_chats_project_id ON chats(project_id);
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_chat_id ON sessions(chat_id);
CREATE INDEX idx_workspaces_project_id ON workspaces(project_id);
CREATE INDEX idx_agent_templates_project_id ON agent_templates(project_id);
CREATE INDEX idx_agent_instances_project_id ON agent_instances(project_id);
```

---

## 8. 应用层切流策略

迁移不只是数据库动作，还要控制应用读写逻辑切换。

### 8.1 阶段一：双兼容读写

- 旧逻辑可继续使用
- 新逻辑开始写 `project_id`
- 读时若缺 `project_id`，兜底到 `main`

### 8.2 阶段二：新写入强制项目化

- 所有新建 chat/session 必须落 project_id
- 前端请求带 currentProjectId

### 8.3 阶段三：清理旧分支

- 删除“无 project_id”兜底逻辑
- 所有查询必须显式带项目作用域

---

## 9. 回滚策略

迁移方案如果没有回滚设计，基本不算完整。

### 9.1 轻量回滚

适用于：

- 只创建了新表
- 只新增了新字段
- 旧逻辑尚未删除

做法：

- 关闭 feature flag
- 前端隐藏项目能力
- 应用退回只使用 `main`

### 9.2 数据回滚

适用于严重问题：

- 迁移脚本写坏
- 查询错乱
- 数据归属异常

做法：

- 恢复迁移前数据库备份
- 恢复旧版本应用
- 暂停项目化功能开关

### 9.3 为什么推荐“增量迁移 + 兼容壳层”

因为这样多数情况下根本不需要物理回滚，只需要逻辑回切即可。

---

## 10. 验证清单

### 10.1 数据验证

- [ ] `projects` 表存在且包含 `main`
- [ ] 所有 chats 均有 `project_id`
- [ ] 所有 sessions 均有 `project_id`
- [ ] `sessions.project_id` 与其 `chat.project_id` 一致
- [ ] workspaces 已正确绑定默认项目
- [ ] agent 模板与实例结构可正常查询

### 10.2 功能验证

- [ ] 不传 projectId 仍可正常创建 chat，默认归 `main`
- [ ] 创建新项目后，可看到独立 chat 列表
- [ ] 不同项目 chat 不串数据
- [ ] agent 不跨项目串用
- [ ] 旧主流程未中断

### 10.3 并发验证

- [ ] 多项目同时访问时查询正确
- [ ] session 状态不串项目
- [ ] 写同一文件有冲突保护

---

## 11. 灰度发布建议

### Feature Flag 建议

- `project_scope_enabled`
- `project_ui_enabled`
- `project_agent_enabled`
- `project_runtime_enabled`

### 灰度顺序

1. 内部环境验证迁移脚本
2. 仅开放项目数据结构，不开放 UI
3. 对少量用户开放项目切换
4. 再开放项目内 chat / session
5. 最后开放 agent 与并发增强

---

## 12. 异常处理建议

### 异常 1：历史 session 找不到 chat

处理建议：

- 回填为 `main`
- 标记为孤儿记录
- 进入审计清单

### 异常 2：历史 cwd 无法解析

处理建议：

- 退回项目默认 rootPath
- 记录 warning

### 异常 3：agent 历史配置无法拆分

处理建议：

- 先迁成全局模板
- 运行态不强追历史实例

### 异常 4：memory 历史来源混乱

处理建议：

- 第一版先保留旧 memory 读取逻辑
- 新 memory 走项目化存储

---

## 13. 推荐迁移顺序总结

推荐顺序：

```text
1. 备份
2. 建 projects / workspaces / agent 新表
3. chats 增 project_id
4. sessions 增 project_id
5. 插入默认项目 main
6. 回填 chats.project_id = main
7. 回填 sessions.project_id
8. 建索引
9. 应用层开启兼容读取
10. 新写入切到项目模式
11. 灰度开放 UI
12. 补强约束与收尾
```

---

## 14. 最终建议

如果你要把迁移风险压到最低，我的建议是：

> **先做软迁移和兼容承接，不要试图第一版就把所有历史 memory、agent 运行态、日志结构一次性洗干净。**

先确保：

- 项目作用域建立起来
- 新数据正确写入
- 老数据能稳定兼容

等新模型跑稳后，再做历史数据清洗。

---

## 15. 下一步建议

建议下一份直接看：

- `OpenClaw-项目化UI原型说明-v1.md`

因为数据迁移和实施方案确定后，UI 原型就能帮助前端与产品把交互快速对齐。