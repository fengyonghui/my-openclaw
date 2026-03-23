# OpenClaw 项目化任务拆解清单 v1

> 配套文档：
> - `OpenClaw-项目化改造设计-v1.md`
> - `OpenClaw-项目化改造实施方案-v1.md`
> - `OpenClaw-项目化API详细设计-v1.md`
> - `OpenClaw-项目化数据库表设计-v1.md`

本清单用于直接排期、分工和推进开发。结构按：阶段 > 模块 > 任务 > 产出 > 验收。

---

## 1. Phase 0：基线梳理

### 1.1 后端现状梳理

- [ ] 梳理现有 chat 数据模型
- [ ] 梳理现有 session 数据模型
- [ ] 梳理现有 agent 数据模型
- [ ] 梳理 runtime / memory / workspace 来源
- [ ] 列出现有 API 清单
- [ ] 标记全局状态依赖点

**产出**
- 现状结构图
- 依赖清单
- 风险点清单

**验收**
- 团队对当前架构边界有统一认知

### 1.2 前端现状梳理

- [ ] 梳理 chat 列表页
- [ ] 梳理 chat 详情页
- [ ] 梳理 session 状态展示
- [ ] 梳理 agent 相关 UI
- [ ] 标记默认“单工作区”假设位置

**产出**
- 前端信息流图
- 状态管理改造点列表

---

## 2. Phase 1：Project 壳层落地

### 2.1 数据库 / 存储

- [ ] 新增 `projects` 表
- [ ] 新增默认项目 `main`
- [ ] 新增 `workspaces` 表

### 2.2 后端服务

- [ ] 新建 `ProjectRepository`
- [ ] 新建 `ProjectService`
- [ ] 新建 `ProjectController`
- [ ] 增加 currentProject 解析逻辑
- [ ] 旧接口补 `main` 项目兼容逻辑

### 2.3 前端

- [ ] 新建 `projectStore`
- [ ] 顶部加入 `ProjectSwitcher`
- [ ] 支持项目列表加载
- [ ] 支持切换当前项目

**产出**
- 项目 CRUD 可用
- UI 可切换项目

**验收**
- 老功能无损
- 默认进入 `main`

---

## 3. Phase 2：Chat / Session 项目化

### 3.1 数据库

- [ ] chats 增加 `project_id`
- [ ] sessions 增加 `project_id`
- [ ] sessions 增加 `runtime_json`
- [ ] sessions 增加 `memory_scope`
- [ ] 回填历史 `project_id`

### 3.2 后端 API

- [ ] 实现 `GET /api/projects/:projectId/chats`
- [ ] 实现 `POST /api/projects/:projectId/chats`
- [ ] 实现 `GET /api/projects/:projectId/chats/:chatId`
- [ ] 实现 `PATCH /api/projects/:projectId/chats/:chatId`
- [ ] 实现 `GET /api/projects/:projectId/sessions`
- [ ] 实现 `POST /api/projects/:projectId/sessions`
- [ ] 实现 `POST /api/projects/:projectId/sessions/:sessionId/run`

### 3.3 业务校验

- [ ] 校验 session 与 chat 项目归属一致
- [ ] 查询统一按 projectId 过滤
- [ ] session 启动时继承项目默认配置

### 3.4 前端

- [ ] chat 列表按项目切换
- [ ] 新建 chat 默认归当前项目
- [ ] chat 页面显示项目名
- [ ] session 状态中显示 cwd / memoryScope

**产出**
- 项目内 chat / session 闭环

**验收**
- 多项目 chat 列表不串
- 旧主流程继续可用

---

## 4. Phase 3：Agent 项目化

### 4.1 数据库

- [ ] 新增 `agent_templates`
- [ ] 新增 `agent_instances`

### 4.2 后端 API

- [ ] 实现 `GET /api/projects/:projectId/agents`
- [ ] 实现 `POST /api/projects/:projectId/agents`
- [ ] 实现 `PATCH /api/projects/:projectId/agents/:agentId`
- [ ] 实现 `POST /api/projects/:projectId/agents/:agentId/spawn`
- [ ] 实现 `GET /api/projects/:projectId/agent-instances/:instanceId`

### 4.3 业务逻辑

- [ ] 拆分 Agent Template / Agent Instance
- [ ] chat 支持 defaultAgentId
- [ ] agent 使用项目级 memory / tool policy
- [ ] 支持从全局模板导入

### 4.4 前端

- [ ] 新建 Agents 页面
- [ ] 新建 Agent 列表卡片
- [ ] 新建 Agent 创建弹窗
- [ ] Chat 中支持切换默认 Agent

**产出**
- 项目内可管理 agent
- chat 可绑定 agent

**验收**
- A 项目的 agent 不出现在 B 项目
- 同项目不同 chat 可选不同 agent

---

## 5. Phase 4：Runtime 隔离与并发

### 5.1 后端 Runtime

- [ ] 新建 `ProjectRuntimeManager`
- [ ] session worker 增加 projectId 绑定
- [ ] 项目级队列 / 缓存 key 规范
- [ ] 项目级状态汇总
- [ ] 后台任务执行器

### 5.2 并发控制

- [ ] 文件级锁
- [ ] workspace 写锁
- [ ] 同文件冲突检测
- [ ] 长任务转后台

### 5.3 事件与状态流

- [ ] session events 存储
- [ ] SSE / WS 按项目化频道推送
- [ ] 全局运行状态 API

### 5.4 前端

- [ ] 全局运行状态面板
- [ ] chat 列表展示运行状态
- [ ] 后台任务提示
- [ ] 项目活动流页面

**产出**
- 多项目 / 多 chat 并发执行可见可控

**验收**
- 不同项目可同时运行
- 同项目多个 chat 可并行
- 写冲突能被拦截或排队

---

## 6. Phase 5：Memory / Activity / Settings 补齐

### 6.1 后端

- [ ] 项目级 Memory API
- [ ] Chat 级 Memory API
- [ ] 项目 Activity API
- [ ] Audit Log API
- [ ] Project Settings 持久化

### 6.2 前端

- [ ] Memory 页面
- [ ] Activity 页面
- [ ] Files / Workspace 页面
- [ ] Project Settings 页面

**产出**
- 项目侧辅助模块完整

**验收**
- 项目设置能改能存
- memory / activity 可查看

---

## 7. Phase 6：测试、灰度、上线

### 7.1 测试

- [ ] 单元测试：project 解析
- [ ] 单元测试：chat/session 归属校验
- [ ] 单元测试：agent template / instance
- [ ] 集成测试：项目隔离
- [ ] 集成测试：并发执行
- [ ] 回归测试：旧功能可用

### 7.2 灰度

- [ ] Feature Flag：`project_scope_enabled`
- [ ] Feature Flag：`project_agent_enabled`
- [ ] Feature Flag：`project_runtime_enabled`
- [ ] 小范围灰度
- [ ] 收集异常与回滚预案

### 7.3 上线

- [ ] 执行数据库迁移
- [ ] 验证默认项目 `main`
- [ ] 放开项目切换 UI
- [ ] 放开项目化 chat/session
- [ ] 放开项目化 agent

---

## 8. 横向专项任务

### 8.1 日志与审计

- [ ] 所有日志补 projectId
- [ ] 所有关键写操作补 audit log
- [ ] 错误日志补 chatId / sessionId / agentId

### 8.2 权限与安全

- [ ] 工具权限按项目隔离
- [ ] workspace 可访问路径白名单
- [ ] 跨项目访问显式拒绝

### 8.3 文档与培训

- [ ] 更新开发文档
- [ ] 更新 API 文档
- [ ] 更新前端交互说明
- [ ] 编写升级说明

---

## 9. 建议分工

### 后端负责人

负责：
- 数据模型
- API
- runtime
- 并发控制
- 审计与日志

### 前端负责人

负责：
- 项目导航
- chat / agent 页面
- 状态展示
- activity / memory / settings 页面

### PM / 架构

负责：
- 作用域定义
- 验收标准
- 排期与优先级
- 风险控制

### QA

负责：
- 项目隔离回归
- 多 chat 并发验证
- 迁移前后对比验证

---

## 10. 建议优先级

### P0

- Project 壳层
- chat / session 项目化
- 默认 main 兼容

### P1

- agent 项目化
- 项目切换 UI
- 数据迁移脚本

### P2

- 并发与 runtime 隔离
- activity / memory / files 页面
- 运行状态总览

### P3

- 更高级的多 agent 协作
- 更复杂的审计与报表
- 体验优化

---

## 11. 里程碑建议

### M1：项目壳层可用

完成标志：
- 可创建项目
- 默认 main 存在
- UI 可切换项目

### M2：项目内 chat / session 可用

完成标志：
- 多项目 chat 隔离
- session 按项目运行

### M3：项目内 agent 可用

完成标志：
- 可创建项目 agent
- chat 可绑定 agent

### M4：多项目并发可用

完成标志：
- 多项目多 chat 同时工作
- 状态和冲突控制稳定

### M5：全链路上线

完成标志：
- memory / activity / settings 补齐
- 测试通过
- 灰度上线

---

## 12. 最终建议

如果要直接进入开发排期，我建议按照下面顺序拉任务：

1. 先排 **Project + chat/session 项目化**
2. 再排 **Agent 项目化**
3. 最后排 **Runtime 并发隔离和周边页面**

这样路径最稳，返工最少。
