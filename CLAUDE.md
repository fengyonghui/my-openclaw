# CLAUDE.md - 项目 Agent 指导

## 项目概述

my-openclaw 是一个多 Agent 协作开发平台（monorepo）：
- `backend/` - Fastify + TypeScript 后端（端口 3001）
- `ui/` - React + Vite + TypeScript + Tailwind CSS 前端（端口 5173）

## 关键约定

### 路径
- 项目根目录：`/mnt/d/workspace/my-openclaw`（Windows: `D:\workspace\my-openclaw`）
- Windows ↔ WSL 路径转换通过 `PathService.ts` 处理
- `getProjectWorkspacePath()` 不可双重调用

### 文件操作
- 使用 `read_file`/`write_file`/`patch` 工具，不用 shell 读写文件
- 重写整个文件用 `write_file`，局部修改用 `patch`

### Windows WSL 开发
- UI dev (`npm run dev`) 必须在 Windows 侧运行（node_modules 是 Windows 安装的 native 模块）
- WSL 里跑 `npm run dev` 会报 `MODULE_NOT_FOUND`
- 后端重启：`yarn dev`（tsx watch）有时不会热重载所有模块，改代码后行为没变时先停掉再重启

## MEMORY.md 维护规范

> 每次完成功能开发后，需要将稳定事实更新到 `MEMORY.md`。

**写入前进行摘要去重**：
1. **合并同类项** — 同模块的多条修复合并为一条
2. **去除过程细节** — 只存最终结论，不存尝试过程
3. **去除重复状态** — Active State / In Progress / Pending User Asks 等临时状态不写入
4. **稳定事实优先** — Bug 修复、技术决策、路径约定、工具版本等持久化信息才写入
5. **结构化压缩** — 用表格替代列表过长项

**只写**：
- 项目结构和技术栈（稳定）
- Bug 修复记录（最终结论，一条）
- 关键路径约定和坑点
- 工具安装和配置状态
- Phase 完成度

**不写**：
- 任务进度和 TODO
- 具体错误日志和堆栈
- 已被覆盖的方案和尝试过程
- 用户 Ask 的详细描述

## 技术栈

- 后端：Fastify + TypeScript + pino logger
- 前端：React + TypeScript + Tailwind CSS
- 模型：MiniMax mx27 via localhost:8080 proxy
- 文档解析：mammoth（.docx）、MinerU（.doc/.docx/.pdf）、xlsx、pdf-parse
- 包管理：npm（backend）、yarn（ui）

## 记忆系统（MEMORY.md 写入规则）

记忆写入前必须经过摘要去重：
1. **规范化比对** — 去空格 → 去中文标点 → 小写化，再做 Set 比对
2. **合并同类项** — 同模块的多条合并为一条
3. **去除过程** — 只存最终结论，不存尝试过程
4. **格式要求** — 记忆条目必须符合 `- [category] content（来源: ...）` 格式，便于正则提取