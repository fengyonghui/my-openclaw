# 迁移指南：从旧版本迁移到最新版本

## 概述

本指南适用于从 **v0.3.2 及更早版本** 迁移到 **v0.3.33+** 的用户。

v0.3.3+ 引入了重大架构变更：**项目隔离数据目录**、**模块化聊天路由**、**三层记忆系统**、**Windows shell 命令统一转换管线**、**429 限流处理**、**文件解析服务**等。

---

## 一、快速迁移（推荐：下载 Release）

最简单的方式是直接下载最新 Release 包，覆盖旧安装：

```bash
# 1. 备份旧数据
cp -r my-openclaw my-openclaw-backup

# 2. 解压新版本
unzip my-openclaw-v0.3.33-dist.zip
cd my-openclaw-v0.3.33-dist

# 3. 复制旧数据到新目录
cp my-openclaw-backend/backend/data/db.json backend/data/
cp -r my-openclaw-backend/data/chats backend/data/ 2>/dev/null || true

# 4. 安装依赖
npm install --prefix backend --registry https://registry.npmjs.org/

# 5. 启动
npm start --prefix backend
```

> **注意**：首次启动时，`DbService` 会自动执行数据库版本迁移（v1 → v2 → v3），无需手动操作。

---

## 二、架构变更详解

### 2.1 数据存储结构变更（重要）

#### 旧结构（v0.3.2 及以前）

```
backend/
├── data/
│   ├── db.json          ← 所有数据（projects, agents, chats, models, skills）
```

#### 新结构（v0.3.3+）

```
backend/
├── data/
│   ├── db.json          ← 仅存 projects, agents, models, skills, memories
│   ├── feature-flags.json  ← 新增：功能开关配置
│   ├── system-commands.json ← 自动生成
│   └── session-events.jsonl ← 新增：会话审计日志
├── agents/              ← 新增：全局 Agent 定义文件
│   ├── product-manager.json
│   ├── backend.json
│   ├── qa.json
│   └── ux.json
└── config/
    └── rateLimitConfig.json  ← 新增：限流配置

# 每个项目的 workspace 下新增：
<project-workspace>/
├── data/
│   └── chats/           ← 新增：会话文件按项目隔离存储
│       └── {chatId}.json
├── agents/              ← 新增：项目私有 Agent 定义
│   └── *.json
└── MEMORY.md            ← 新增：项目层记忆文件
```

#### 数据迁移说明

- **db.json 中的 `chats` 数组**：旧版将所有会话存在 `db.json.chats` 中。新版将每个会话独立为 `<workspace>/data/chats/{chatId}.json` 文件。
- **db.json 中的 `agents` 数组**：旧版将所有 Agent 定义存在 `db.json.agents` 中。新版将 Agent 拆分为文件：
  - v1 → v2：`db.json.agents` → `backend/agents/*.json`
  - v2 → v3：`backend/agents/*.json` → 各项目的 `<workspace>/agents/*.json`
- **首次启动自动迁移**：`DbService.migrateToV3()` 会自动处理以上迁移。

### 2.2 新增的服务层

| 服务 | 说明 | 影响 |
|------|------|------|
| `ProjectChatService` | 项目级会话 CRUD（读写 `<workspace>/data/chats/`） | 会话存储从 db.json 改为文件 |
| `ProjectDataService` | 项目级数据存储（chats, memory, config） | 新项目自动创建 data 目录 |
| `ProjectRuntimeManager` | 运行时状态追踪（SSE 连接、活跃会话、Agent 进程、工作区锁） | 新增 `/api/v1/system/runtime` 端点 |
| `MemoryAutoSaveService` | 自动记忆提取（L1 会话层、L2 项目层 MEMORY.md） | 新增记忆自动保存功能 |
| `RateLimitHandler` | 429 限流检测 + 指数退避重试 | 模型请求失败自动重试/切换 |
| `ModelRequestHandler` | 增强模型请求（重试 + 故障转移） | 模型请求更稳定 |
| `FileParserService` | 文档解析（Word/Excel/PDF/TXT/图片） | 新增文件上传解析功能 |
| `FeatureFlags` | 功能开关（按项目/环境/百分比灰度） | 6 个功能开关：runtime_status_panel, workspace_lock, session_events, streaming_mode, agent_delegation, memory_auto_save |
| `PathService` | 跨平台路径转换（Windows ↔ WSL） | shell_exec 路径处理更可靠 |
| `SessionEventService` | 会话事件审计日志 | 新增 `backend/data/session-events.jsonl` |
| `WorkspaceLock` | 文件级并发锁 | 防止多会话同时修改同一文件 |
| `BuiltinSkills` | 平台感知的内置技能生成 | 自动生成 file-io, shell-cmd, inline-python-edit 技能 |
| `systemBootstrap` | 系统初始化引导 | 启动时自动生成 system-commands.json |

### 2.3 新增的 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/version` | 获取版本信息 |
| `GET` | `/api/v1/project-chats` | 项目级会话列表 |
| `POST` | `/api/v1/project-chats` | 创建项目级会话 |
| `GET` | `/api/v1/project-chats/:id` | 获取项目级会话 |
| `PUT` | `/api/v1/project-chats/:id` | 更新项目级会话 |
| `DELETE` | `/api/v1/project-chats/:id` | 删除项目级会话 |
| `GET` | `/api/v1/flags` | 获取功能开关列表 |
| `PUT` | `/api/v1/flags/:key` | 更新功能开关 |
| `GET` | `/api/v1/table-metadata` | 获取表元数据 |
| `GET` | `/api/v1/system/runtime` | 获取运行时状态 |

### 2.4 现有 API 端点变更

| 端点 | 变更 |
|------|------|
| `POST /api/v1/chats` | 内部改用 `ProjectChatService`，会话保存到项目目录 |
| `GET /api/v1/agents` | Agent 定义从 db.json 改为从 `<workspace>/agents/*.json` 文件读取 |
| `POST /api/v1/models/sync` | 新增：从提供商同步可用模型 |

---

## 三、手动迁移步骤

### 3.1 如果你使用 Release 包

```bash
# 1. 备份旧数据
cp backend/data/db.json backend/data/db.json.backup

# 2. 解压新版本，覆盖文件
unzip my-openclaw-v0.3.33-dist.zip -d .

# 3. 恢复备份数据
cp backend/data/db.json.backup backend/data/db.json

# 4. 安装依赖
npm install --prefix backend --registry https://registry.npmjs.org/

# 5. 启动（会自动执行数据库迁移）
npm start --prefix backend
```

### 3.2 如果你从源码开发

```bash
# 1. 备份
cp backend/data/db.json backend/data/db.json.backup

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
cd backend && npm install --registry https://registry.npmjs.org/
cd ../ui && npm install --registry https://registry.npmjs.org/

# 4. 启动（会自动执行数据库迁移）
npm run dev
```

### 3.3 数据迁移验证

启动后检查以下日志确认迁移成功：

```
[Migration] 检测到旧版本 (v1)，正在迁移到 v3...
[Migration] v1 → v2: N 个 Agent 已写入 backend/agents/
[Migration] v2 → v3: Agent 已复制到 <workspace>/agents/
[Migration] 完成，已升级到 v3
```

---

## 四、常见问题

### Q1: 迁移后会话丢失？

**不会。** 旧版 `db.json.chats` 中的数据会在迁移时自动拆分为 `<workspace>/data/chats/{chatId}.json` 文件。

### Q2: 迁移后 Agent 配置丢失？

**不会。** `db.json.agents` 中的数据会自动迁移为文件：
- 全局 Agent → `backend/agents/*.json`
- 项目 Agent → `<workspace>/agents/*.json`

### Q3: 新功能开关默认状态？

| 功能开关 | 默认 | 说明 |
|----------|------|------|
| `runtime_status_panel` | ON | 运行时状态面板 |
| `workspace_lock` | ON | 工作区文件锁 |
| `session_events` | ON | 会话事件审计日志 |
| `streaming_mode` | OFF | SSE 流式响应 |
| `agent_delegation` | ON | Agent 委派 |
| `memory_auto_save` | ON | 记忆自动保存 |

可通过 `PUT /api/v1/flags/:key` 端点修改。

### Q4: 旧版 db.json 还能用吗？

可以。`DbService` 向后兼容 v1/v2/v3 版本。首次启动时自动升级。

### Q5: 数据目录结构变了，旧的 workspace 路径还有效吗？

有效。`DbService` 会自动为新项目创建 `data/chats/` 和 `agents/` 目录。旧项目的 workspace 路径保持不变。

### Q6: 如何恢复备份？

```bash
# 停止服务
# 恢复备份
cp backend/data/db.json.backup backend/data/db.json
# 重启服务（会重新执行迁移）
npm start --prefix backend
```

---

## 五、变更文件清单

### 新增文件（56 个）

- `backend/src/services/ProjectChatService.ts` — 项目会话服务
- `backend/src/services/ProjectDataService.ts` — 项目数据存储
- `backend/src/services/ProjectRuntimeManager.ts` — 运行时管理器
- `backend/src/services/MemoryAutoSaveService.ts` — 记忆自动保存
- `backend/src/services/RateLimitHandler.ts` — 429 限流处理
- `backend/src/services/RateLimitConfig.ts` — 限流配置
- `backend/src/services/ModelRequestHandler.ts` — 增强模型请求
- `backend/src/services/FileParserService.ts` — 文件解析
- `backend/src/services/FeatureFlags.ts` — 功能开关
- `backend/src/services/PathService.ts` — 路径转换
- `backend/src/services/SessionEventService.ts` — 会话事件
- `backend/src/services/WorkspaceLock.ts` — 工作区锁
- `backend/src/services/BuiltinSkills.ts` — 内置技能
- `backend/src/services/systemBootstrap.ts` — 系统引导
- `backend/src/routes/chats/` — 模块化聊天路由（6 个文件）
- `backend/src/routes/project-chats.ts` — 项目会话路由
- `backend/src/routes/feature-flags.ts` — 功能开关路由
- `backend/src/routes/tableMetadata.ts` — 表元数据路由
- `backend/src/routes/version.ts` — 版本路由
- `backend/config/rateLimitConfig.json` — 限流配置
- `backend/data/feature-flags.json` — 功能开关数据
- `backend/data/session-events.jsonl` — 会话审计日志
- `backend/data/system-commands.json` — 系统命令
- `agents/` — 全局 Agent 定义（4 个文件）
- `backend/agents/` — 全局 Agent 定义副本（4 个文件）

### 修改文件（34 个）

- `backend/src/index.ts` — 新增路由注册、SPA 静态文件服务
- `backend/src/routes/chats.ts` — 重构为模块化导入
- `backend/src/services/DbService.ts` — 版本迁移 v3、表元数据缓存
- `backend/src/services/ContextManager.ts` — 增强上下文管理
- `backend/src/services/SystemCommands.ts` — 系统命令增强
- `backend/src/services/ToolDefinitions.ts` — 工具定义增强
- `backend/src/services/systemTools.ts` — 系统工具增强
- `backend/src/services/FileToolService.ts` — 文件工具增强
- `backend/src/services/BuiltinSkills.ts` — 新增（见上）
- `ui/src/App.tsx` — 新增路由
- `ui/src/pages/` — 多个页面增强

---

## 六、版本对照

| 版本 | 主要变更 |
|------|----------|
| v0.3.2 | 上一稳定版本 |
| v0.3.3 | 项目隔离、模块化聊天路由、Agent 文件化、版本迁移 v3 |
| v0.3.4~v0.3.10 | Windows shell 命令转换修复系列 |
| v0.3.11~v0.3.20 | JSON 恢复、file-io 搜索、composite commands、CLIXML 清理 |
| v0.3.21~v0.3.30 | 429 限流处理、流式响应、文件解析、记忆系统 |
| v0.3.31~v0.3.32 | 团队委派、能力摘要、运行时状态 |
| v0.3.33 | 三层记忆优化、搜索文件工具、shell_exec 全面修复 |
