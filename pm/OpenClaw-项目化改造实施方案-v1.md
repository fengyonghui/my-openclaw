# OpenClaw 项目化改造实施方案 v1

> 配套文档：`OpenClaw-项目化改造设计-v1.md`
>
> 目标：把“项目化设计”转成可执行的开发计划，明确模块拆分、实施阶段、任务清单、验收标准、风险控制与建议排期。

---

## 1. 文档目标

这份文档不再讨论“为什么这样设计”，而是回答以下问题：

1. 具体先改什么，后改什么
2. 前后端分别改哪些模块
3. 数据结构如何渐进演进
4. 如何保证旧功能不坏
5. 每个阶段上线后怎么验收

一句话概括：

> **以最小破坏、可回滚、可灰度的方式，把 OpenClaw 从单工作区模型升级为多项目、多 Agent、多 Chat 并行模型。**

---

## 2. 实施总原则

### 2.1 核心原则

1. **先加壳，再迁移行为**
   - 先引入 Project 容器
   - 再把 Chat / Session / Agent 慢慢收进去

2. **默认兼容旧逻辑**
   - 老数据先挂到 `main` 项目
   - 老 API 继续可用

3. **每一阶段都可独立验收**
   - 阶段结束必须有可运行、可回归、可验证的结果

4. **先后端基础，再前端完整暴露**
   - 避免 UI 先行把用户入口打开，但后端隔离没做好

5. **先建数据边界，再做并发能力**
   - 没有明确归属和作用域，并发一定会乱

---

## 3. 实施范围

### 3.1 本轮要完成

- 引入 Project 作为一级作用域
- Chat / Session 归属于 Project
- Agent 支持项目级模板与实例
- 前端支持项目切换、项目内 Chat / Agent 管理
- 支持多项目、多 Chat 并行运行
- 补齐迁移、监控、审计、兼容逻辑

### 3.2 本轮不强求一次做到极致

以下可放后续优化：

- 团队协作与权限系统
- 跨项目资源共享中心
- 可视化任务编排
- 多租户 SaaS 化
- 项目级成本核算大盘

---

## 4. 推荐实施阶段

建议拆成 5 个阶段，而不是粗暴一次性改完。

---

## Phase 0：基线梳理与保护

### 目标

在开始改造前，先把当前系统基线摸清楚，避免“改了一半才发现依赖关系没看懂”。

### 后端任务

- 梳理现有核心实体：chat / session / agent / runtime / memory / workspace
- 梳理现有 API：创建会话、消息发送、会话列表、agent 启动、消息路由
- 梳理配置来源：全局配置、运行时注入、默认 cwd、memory 文件位置
- 标记关键耦合点

### 前端任务

- 梳理会话列表、当前 chat 页面、session 详情、agent 面板
- 找出现有“默认全局状态”的地方
- 标记哪些组件默认假设“系统只有一个工作上下文”

### 输出物

- 系统现状结构图
- API 清单
- 表结构清单
- 风险点清单

### 验收标准

- 核心数据流画出来
- 能明确指出“加入 projectId 会影响哪些接口与页面”

---

## Phase 1：Project 数据模型落地 + 兼容壳层

### 目标

不改变用户当前主要使用方式，只是让系统内部先具备“项目容器”。

### 后端任务

#### 1. 新增 `projects` 表 / 存储结构

至少包含：

- id
- name
- slug
- rootPath
- status
- configJson
- createdAt
- updatedAt

#### 2. 创建默认项目 `main`

系统启动时确保存在：

- `id = main`
- `name = Main`

#### 3. 提供项目服务层

新增：

- `ProjectService`
- `ProjectRepository`
- `ProjectController`

支持：

- list
- create
- update
- archive
- getById

#### 4. 增加“当前项目解析逻辑”

在请求上下文中引入：

- `currentProjectId`
- 如果未指定，则默认 `main`

#### 5. API 兼容适配层

对旧接口增加隐式解析：

```ts
projectId = request.projectId ?? currentProjectId ?? 'main'
```

### 前端任务

#### 1. 新增项目状态容器

例如：

- `projectStore`
- `currentProjectId`
- `projects[]`

#### 2. 顶部增加项目切换器雏形

先不强暴露复杂能力，只要可切换项目上下文。

#### 3. 所有原本全局请求统一带上项目上下文

即使后端仍然默认 `main`，前端也要逐步建立习惯。

### 输出物

- 项目 CRUD API
- 默认项目逻辑
- 前端项目切换器雏形

### 验收标准

- 老功能无感继续可用
- 新增项目后不报错
- 所有旧 chat/session 仍正常显示在 `main`

### 风险

- 某些代码路径硬编码假定系统只有一个 workspace
- 某些缓存 key 未引入 projectId，可能串数据

---

## Phase 2：Chat / Session 项目化

### 目标

把 Chat / Session 正式纳入项目作用域，这是整个改造的第一道硬边界。

### 后端任务

#### 1. chats 表增加 `project_id`

#### 2. sessions 表增加 `project_id`

#### 3. 新建 Chat 必须指定项目

规则：

- 如果前端未显式传入，则使用 `currentProjectId`
- 创建后绑定到对应项目

#### 4. 新建 Session 必须绑定项目

并校验：

- `session.projectId === chat.projectId`

#### 5. 查询接口项目过滤

例如：

- `listChats(projectId)`
- `listSessions(projectId)`
- `getChat(chatId, projectId)`

#### 6. Session 运行时继承项目默认配置

例如：

- cwd
- model
- tool policy
- timezone
- memory policy

### 前端任务

#### 1. Chat 列表按项目切换

切换项目后：

- 只看当前项目 chats
- 新建 chat 默认归当前项目

#### 2. Chat 创建弹窗增加项目与默认 Agent 选择

#### 3. Session 状态 UI 引入项目感知

- 当前 chat 属于哪个项目
- 当前 session 工作目录

### 输出物

- 项目化 chat/session 数据链路
- 项目过滤的 chat 列表
- 新建 chat / session 新流程

### 验收标准

- 同一系统可创建多个项目，各自拥有独立 chat 列表
- 不同项目的 chat 不串显示
- 旧主项目 `main` 仍正常工作

### 风险

- 查询条件漏加 `project_id`
- WebSocket / 消息订阅通道没有按项目隔离

---

## Phase 3：Agent 项目化

### 目标

支持在项目内创建和使用 Agent，并把 Agent 从“模糊执行者”拆成“模板 + 实例”。

### 后端任务

#### 1. 新增 `agent_templates`

字段建议：

- id
- project_id
- name
- role
- prompt
- config_json
- created_at
- updated_at

#### 2. 新增 `agent_instances`

字段建议：

- id
- project_id
- template_id
- session_id
- status
- runtime_json

#### 3. Agent 模板 API

- 创建项目 Agent
- 编辑项目 Agent
- 复制全局模板到项目
- 获取项目 Agent 列表

#### 4. Agent 实例运行 API

- spawn agent instance
- bind to session
- stop / retry / inspect

#### 5. Chat 增加默认 Agent 支持

### 前端任务

#### 1. 项目 Agents 页面

- 项目 agent 列表
- 新建 agent
- 编辑 agent

#### 2. Chat 页面支持选择 / 切换默认 Agent

#### 3. 多 Agent 协作入口

建议第一版先做轻量：

- 在 chat 中切换当前 agent
- 或通过面板手动启动多个 agent session

不要一开始就做过度复杂的多智能体编排 UI。

### 输出物

- 项目级 agent 模板与实例
- 项目内可配置 agent
- chat 默认 agent 生效

### 验收标准

- 每个项目可维护自己的 agent 列表
- agent 不跨项目串用
- 同一项目能让不同 chat 使用不同 agent

### 风险

- 现有 agent 逻辑若深度绑定 session，需要做兼容包裹层
- agent prompt / tool / skill 来源可能仍然混用全局配置

---

## Phase 4：Project Runtime Manager + 多 Chat 并发

### 目标

支持多个项目、多个 chat、多个 session 同时工作，形成真正运行态隔离。

### 后端任务

#### 1. 引入 `ProjectRuntimeManager`

职责：

- 维护项目级 runtime state
- 管理项目级队列
- 分配 chat/session worker
- 维护资源锁

#### 2. 引入项目级缓存与 key 规范

例如：

- `project:{id}:chats`
- `project:{id}:sessions`
- `project:{id}:memory`

#### 3. Session worker 隔离

每个 session 启动时明确绑定：

- projectId
- chatId
- sessionId
- agentId
- cwd
- toolPolicy

#### 4. 后台任务能力

支持：

- long-running session
- async tool tasks
- 状态轮询 / 推送更新

#### 5. 加锁机制

至少实现：

- 文件级锁
- workspace 级写锁
- session 并发写防冲突

### 前端任务

#### 1. Chat 并发状态面板

展示：

- 哪些 chat 正在运行
- 哪些 chat 有后台任务
- 哪些 chat 正在等待用户输入

#### 2. 项目活动流

用于查看该项目内：

- 最近执行
- agent 输出
- 文件修改记录

### 输出物

- 多项目并发运行能力
- 后台任务与状态流转
- 资源锁与冲突保护

### 验收标准

- 项目 A 和项目 B 可同时执行任务
- 同一项目多个 chat 可并发处理
- 改同一文件时系统能提示冲突或排队

### 风险

- Runtime 与消息总线可能存在全局共享对象
- 并发下日志与状态回放容易错位

---

## Phase 5：观测性、审计、优化与灰度上线

### 目标

把前四阶段的功能打磨到可稳定上线。

### 后端任务

- 补充项目级日志与 tracing
- 记录项目 / chat / session / agent 维度指标
- 补充错误分类
- 增加迁移回滚工具
- 完善审计日志

### 前端任务

- 优化状态提示
- 优化错误提示
- 增加项目设置页
- 增加活动与审计视图

### 输出物

- 可观测性方案
- 错误告警方案
- 灰度发布方案
- 用户培训说明

### 验收标准

- 关键链路可追踪
- 问题可快速定位到项目 / chat / session / agent
- 有灰度开关与快速回退手段

---

## 5. 开发任务拆分建议

下面给一版更适合排进迭代的任务结构。

---

## 5.1 后端任务清单

### A. 数据与模型层

- [ ] 新增 `projects` 表
- [ ] 新增 `workspaces` 表
- [ ] `chats` 增加 `project_id`
- [ ] `sessions` 增加 `project_id`
- [ ] 新增 `agent_templates`
- [ ] 新增 `agent_instances`
- [ ] memory 表结构化或抽象统一接口

### B. 服务层

- [ ] `ProjectService`
- [ ] `WorkspaceService`
- [ ] `ChatService` 项目化改造
- [ ] `SessionService` 项目化改造
- [ ] `AgentTemplateService`
- [ ] `AgentInstanceService`
- [ ] `ProjectRuntimeManager`

### C. API 层

- [ ] Project CRUD API
- [ ] Project-scoped Chat API
- [ ] Project-scoped Session API
- [ ] Project-scoped Agent API
- [ ] Project Memory API
- [ ] Workspace API

### D. Runtime 层

- [ ] 项目级上下文注入
- [ ] session 启动参数标准化
- [ ] 文件锁 / workspace 锁
- [ ] 后台任务执行器
- [ ] 项目级缓存 key 重构

### E. 可观测性

- [ ] 项目维度日志字段
- [ ] session / agent tracing
- [ ] 审计日志
- [ ] 指标仪表盘

---

## 5.2 前端任务清单

### A. 状态层

- [ ] `projectStore`
- [ ] chats / sessions / agents 按项目分桶
- [ ] 当前项目状态持久化

### B. 页面与组件

- [ ] ProjectSwitcher
- [ ] 项目列表页
- [ ] 项目设置页
- [ ] 项目内 Chat 列表
- [ ] 项目内 Agent 页面
- [ ] 项目 Activity 页面

### C. 交互流程

- [ ] 新建项目流程
- [ ] 新建 chat 流程
- [ ] chat 绑定 agent
- [ ] agent 启动与状态查看
- [ ] 多 chat 并发状态提示

### D. 兼容与体验

- [ ] 默认进入 `main` 项目
- [ ] 无项目数据时的空状态页
- [ ] 切换项目时保留最近 chat
- [ ] 错误与冲突提示

---

## 6. 模块依赖顺序

推荐的依赖顺序如下：

```text
projects
  -> chats / sessions 项目化
      -> agents 项目化
          -> runtime 项目隔离
              -> UI 完整开放
                  -> 观测与灰度
```

不要反过来。

尤其不要：

- 先做复杂 UI，再补后端边界
- 先做多 agent 协作炫技，再补 projectId
- 先做并发执行，再做资源锁

这几种顺序都容易翻车。

---

## 7. 联调与测试策略

### 7.1 单元测试重点

- project 解析逻辑
- chat / session 归属校验
- agent 模板 / 实例关系
- 配置继承优先级
- 锁机制行为

### 7.2 集成测试重点

#### 用例 1：默认兼容

- 不传 projectId 创建 chat
- 应自动归属 `main`

#### 用例 2：项目隔离

- 创建 Project A / B
- 各自创建 chat
- 查询时不串数据

#### 用例 3：agent 隔离

- A 项目的 agent 不应出现在 B 项目的可选列表

#### 用例 4：并发执行

- 不同项目并发运行 session
- 状态互不干扰

#### 用例 5：文件冲突

- 两个 session 同时写同一文件
- 应排队或报冲突

### 7.3 回归测试重点

- 现有单项目 chat 收发消息不受影响
- 现有 session 启动流程不受影响
- 现有工具调用不受影响
- 默认主工作区继续可用

---

## 8. 验收口径

### 第一阶段验收

- 能创建项目
- 系统默认存在 `main`
- 旧功能继续可用

### 第二阶段验收

- chat / session 明确归属项目
- 切换项目能切换 chat 列表

### 第三阶段验收

- 每个项目能创建自己的 agent
- chat 可选默认 agent

### 第四阶段验收

- 多项目多 chat 并发运行
- 状态稳定可见
- 文件冲突可控

### 第五阶段验收

- 日志、监控、审计可追溯
- 能灰度、能回退、能定位问题

---

## 9. 风险清单

### 高风险

1. **旧代码存在大量全局状态假设**
2. **查询或缓存 key 漏加 projectId 导致串数据**
3. **runtime 并发时文件读写冲突**
4. **agent 配置来源混乱，导致项目隔离失效**

### 中风险

1. 前端状态管理改造面较大
2. WebSocket / 推送订阅的作用域边界不清
3. 老的 memory 机制可能偏文件化，不易直接结构化

### 低风险

1. 项目切换 UI
2. 基础项目 CRUD
3. 项目级列表查询

---

## 10. 建议排期

如果按一个中等规模团队估算，可以参考：

### 方案 A：稳妥型（推荐）

- Phase 0：3~5 天
- Phase 1：5~7 天
- Phase 2：7~10 天
- Phase 3：7~10 天
- Phase 4：10~15 天
- Phase 5：5~7 天

合计约：5~8 周

### 方案 B：激进型

把 Phase 1~3 压缩并行，但风险明显更大。

---

## 11. 团队分工建议

### 后端

负责：

- 数据模型
- 服务层
- runtime
- 并发控制
- 审计与监控

### 前端

负责：

- 项目切换
- 项目视图
- chat / agent 项目化页面
- 并发状态可视化

### 产品 / PM

负责：

- 作用域定义确认
- 用户流程确认
- 兼容策略确认
- 验收口径

### QA

负责：

- 多项目隔离测试
- 回归测试
- 并发场景测试
- 升级迁移测试

---

## 12. 上线策略建议

### 12.1 灰度上线

建议通过 feature flag 控制：

- `project_scope_enabled`
- `project_agent_enabled`
- `project_runtime_enabled`

### 12.2 上线顺序

1. 先上后端兼容层
2. 再上项目切换 UI
3. 再开放项目化 chat/session
4. 再开放项目 agent
5. 最后开放多项目并发增强

### 12.3 回退策略

- UI 可隐藏项目入口
- API 仍可默认回到 `main`
- runtime 开关可退回单项目模式

---

## 13. 最终执行建议

如果只给一句建议：

> **先把 Project 作为壳层落好，再推动 Chat / Session / Agent 逐层归位，最后再做并发与运行时隔离。**

这条路线最稳，不容易把现有 OpenClaw 功能打断。

---

## 14. 下一步建议

建议继续补两份配套文档：

1. `OpenClaw-项目化数据迁移方案-v1.md`
2. `OpenClaw-项目化UI原型说明-v1.md`

其中：

- 数据迁移方案用于保障升级安全
- UI 原型说明用于让前端和产品快速对齐

这两份文档建议与本实施方案一起使用。