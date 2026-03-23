# Agents Directory

本目录用于统一存放项目内的 Agent 定义文件，避免各类 agent 散落在项目根目录，便于管理、扩展与后续项目化接入。

## 1. 目录目标

将不同职责的 agent 收口到 `agents/` 目录下，形成统一规范，方便：

- 查找与维护
- 后续程序自动扫描 / 注册
- 角色分工清晰化
- 项目内多 agent 协作扩展

---

## 2. 当前 Agent 列表

| 文件名 | 角色 | 说明 |
| :--- | :--- | :--- |
| `pm_agent.md` | 产品经理 Agent | 负责需求分析、PRD、流程设计、验收标准、埋点规划 |
| `ux_agent.md` | UI/UX Agent (DesignMate) | 负责界面设计、体验评估、视觉分析、前端 UI 代码生成 |
| `frontend_agent.md` | 前端 Agent | 负责 React / TypeScript / Tailwind 前端实现与组件工程化 |
| `backend_agent.md` | 后端 Agent | 负责 API、数据库、服务设计、迁移与稳定性方案 |
| `qa_agent.md` | QA Agent | 负责测试方案、质量门禁、风险分析、回归与验收 |
| `architect_agent.md` | 架构师 Agent | 负责系统建模、模块边界、演进路径与技术权衡 |

---

## 3. 推荐命名规范

统一采用：

```text
<role>_agent.md
```

例如：

- `pm_agent.md`
- `ux_agent.md`
- `frontend_agent.md`
- `backend_agent.md`
- `qa_agent.md`
- `architect_agent.md`

### 命名原则

1. 使用小写英文
2. 使用下划线 `_` 分隔
3. 文件名直接体现角色职责
4. 避免使用含糊名称，如：
   - `helper.md`
   - `assistant.md`
   - `worker.md`

---

## 4. 推荐文件结构规范

每个 agent 文件建议统一包含以下部分：

```markdown
# Role: [角色名]

## Profile
## Core Competencies / Core Capabilities
## Constraints & Guidelines
## Workflow
## Output Format Template
## Default Technical Preferences
## Working Principles
```

### 说明

- `Profile`：定义角色定位与核心价值
- `Core Competencies`：定义能力边界
- `Constraints & Guidelines`：定义行为约束和输出要求
- `Workflow`：定义处理问题的步骤
- `Output Format Template`：统一输出结构，提升稳定性
- `Default Technical Preferences`：沉淀技术栈偏好
- `Working Principles`：定义该 agent 的长期行为原则

---

## 5. 推荐角色分工

### 需求与方案层
- `pm_agent.md`
- `architect_agent.md`

### 设计与体验层
- `ux_agent.md`

### 工程实现层
- `frontend_agent.md`
- `backend_agent.md`

### 质量保障层
- `qa_agent.md`

这种分层适合构建一个典型的软件交付协作链路：

```text
PM -> Architect -> UX -> Frontend / Backend -> QA
```

---

## 6. 后续建议可补充的 Agent

如果后续继续扩展，建议按同样规范补以下角色：

- `devops_agent.md`：CI/CD、部署、环境、监控、发布
- `data_agent.md`：指标、分析、埋点、报表
- `research_agent.md`：竞品、技术调研、资料汇总
- `operations_agent.md`：运营流程、活动方案、内容策略
- `security_agent.md`：安全评审、权限、审计、风险排查

---

## 7. 迁移建议

目前这些 agent 原文件仍保留在项目根目录中，目的是避免直接删除造成兼容或引用问题。

### 推荐后续处理方式

分两步走：

#### 第一步：以 `agents/` 目录为主目录
- 新增和维护统一在 `agents/` 下进行
- 后续文档和代码引用逐步切到 `agents/` 路径

#### 第二步：确认无引用后，再清理根目录旧副本
- 清理前需确认调用入口
- 若要删除旧文件，必须先征得用户确认

---

## 8. 维护原则

1. 新增 agent 必须放到 `agents/` 目录
2. 新增 agent 必须遵守命名规范
3. 新增 agent 应保持与现有文件结构风格一致
4. 若 agent 职责发生明显变化，应更新 README 中的角色说明
5. 若后续系统支持自动注册 agent，可直接以此目录作为扫描入口

---

## 9. 当前建议

从现在开始，建议把：

- 新 agent 创建
- agent 内容迭代
- agent 文档管理

统一收口到：

```text
D:\workspace\my-openclaw\agents
```

如果后续继续做“项目内创建和使用 agent”的系统能力，这个目录可直接作为本地 Agent 模板目录的基础。