# My-OpenClaw 项目记忆

> 最后更新：2026-04-28

## 项目概述

**my-openclaw** 是一个多 Agent 协作开发平台，采用 monorepo 结构：
- `backend/` - Fastify 后端 (端口 3001)，纯 TypeScript，无数据库（文件存储）
- `ui/` - React + Vite + TypeScript + Tailwind CSS 前端 (端口 5173)

## 当前开发阶段

正在推进 **Phase 1-6 项目化改造**（多项目隔离架构）

### Phase 完成度

| Phase | 内容 | 完成度 | 备注 |
|-------|------|--------|------|
| Phase 0 | 基线梳理 | ✅ 完成 | |
| Phase 1 | Project 壳层 | ✅ 完成 | CRUD/import/ProjectContext |
| Phase 2 | Chat/Session 项目化 | 🔶 基本完成 | 核心 bug 已修复 |
| Phase 3 | Agent 项目化 | 🔶 部分完成 | Agent 绑定已修通 |
| Phase 4 | Runtime 隔离与并发 | 🔴 未开始 | 已新增 status API |
| Phase 5 | Memory/Activity/Settings | 🔶 部分完成 | Activity 已增强 |
| Phase 6 | 测试、灰度、上线 | 🔴 未开始 | |

## 技术细节

### 存储架构
- `backend/data/db.json` - 全局数据（项目列表、全局 Agent/Model/Skill、心跳配置）
- `backend/data/system-commands.json` - 系统命令（自动生成，不要手动修改）
- 各项目 `data/chats/*.json` - 按项目隔离的会话文件

### 路径处理
- `PathService.ts` - Windows ↔ WSL 路径转换
- Windows: `d:\workspace\xxx` → WSL: `/mnt/d/workspace/xxx`
- **注意**: `getProjectWorkspacePath()` 不可双重调用

### 核心服务
- `DbService` - 全局数据读写
- `ProjectDataService` - 项目文件存储 (data/chats/)
- `ProjectChatService` - 项目会话 CRUD
- `HeartbeatService` - 心跳调度
- `PathService` - 跨平台路径

### 关键 Bug 修复记录 (2026-04-28)
1. ✅ `chats.ts` 中 3 处双重 `getProjectWorkspacePath()` 调用 → 已修复
2. ✅ `db.chats.find()` → `ProjectChatService` → 已修复
3. ✅ DELETE 端点缺少 `projectId` query 参数 → 已修复
4. ✅ 新建会话时 `agentId/modelId` 未保存 → 已修复

## Agent 角色
- `architect_agent.md` - 系统架构师
- `backend_agent.md` - 后端工程师
- `frontend_agent.md` - 前端工程师
- `ux_agent.md` - UI/UX 设计
- `pm_agent.md` - 产品经理
- `qa_agent.md` - QA 工程师

## 维护约定
- 所有文件操作用 `read_file`/`write_file` 工具，不用 shell 命令
- Windows 下 shell 命令先 `curl http://localhost:3001/api/tools/commands` 获取正确语法
- GitHub token 已配置在 `~/.git-credentials`
- Git identity: fengyonghui / fengyonghui@github.com
