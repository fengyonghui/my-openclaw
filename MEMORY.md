# My-OpenClaw 项目记忆

> 最后更新：2026-06-03

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
| Phase 4 | Runtime 隔离与并发 | 🔶 部分完成 | status API 已新增 |
| Phase 5 | Memory/Activity/Settings | 🔶 部分完成 | Activity 已增强 |
| **Phase 6** | **测试、灰度、上线** | 🔶 部分完成 | 文件解析功能已实现 |

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
- `FileParserService` - 文档解析（Word/Excel/PDF/TXT/图片）
- `MemoryAutoSaveService` - 双层记忆自动提取（L1 会话层，L2 项目层 MEMORY.md）
- `MemoryFileHandler` - 手动记忆写入（"请注意"触发词 + "请牢记"等）

## 记忆系统

### 存储层次
| 层级 | 存储位置 | 触发方式 |
|------|----------|----------|
| 会话层 | `chat.json` → `sessionMemory[]` | 自动：LLM 提取最近 10 条消息 |
| 项目层 | 项目 `MEMORY.md` | 自动（每日分区）+ 手动（"请注意"前缀） |
| 数据库层 | `db.json` → `memories[]` | 自动同步 + 前端手动添加 |

### 记忆写入触发词（`MemoryFileHandler.ts`）
`请注意`、`请记住`、`记住`、`记住：`、`请牢记` — 触发后将内容追加到 MEMORY.md

### 摘要去重逻辑（写入前强制执行）
- 从 MEMORY.md 现有内容提取所有 `- [category] content（来源: ...）` 行
- 对每条内容做**规范化**：去空格 → 去中文标点 → 小写化
- 与待写入内容同样规范化后做 Set 比对，命中则跳过
- 同样逻辑适用于 `MemoryAutoSaveService.saveProjectMemory()` 和 `MemoryFileHandler.saveToMemoryFile()`

### MEMORY.md 格式
```markdown
## 2026-05-29 自动提取
**摘要**: 一句话描述

- [项目信息] 内容（来源: 来源描述）
- [技术决策] 内容（来源: 来源描述）
```

## 模型同步功能

### 后端接口
- `POST /api/v1/models/sync-from-provider` - 从当前 glue provider 自动同步所有可用模型
- 自动读取 db.json 中现有 glue 模型配置的 baseUrl/apiKey
- 保留现有模型的 temperature/maxTokens 设置
- 返回同步结果统计

### 前端入口
- `ui/src/pages/ModelsPage.tsx` - 新增「同步模型」按钮（绿色渐变）
- 显示同步结果提示（成功/失败）
- 同步后自动刷新模型列表

## 文件上传与 AI 解读功能

### 实现状态（Phase 6）

**前端** (`ui/src/pages/ChatDetailPage.tsx`)
- `addFileAsAttachment()` 函数：所有文件类型均通过 `FileReader.readAsDataURL` 读取 base64
- Word/Excel/TXT/PDF/图片均支持上传

**后端** (`backend/src/services/FileParserService.ts`)
- `parseFile()` - 统一分发入口
- `parseAttachments()` - 批量解析 attachments 数组
- `buildMessageWithAttachments()` - 将解析内容合并到用户消息文本

### Word 文档解析三层策略

| 策略 | 适用 | 方式 | 备注 |
|------|------|------|------|
| 1 | `.docx` | mammoth（内置 Node.js） | 主路径 |
| 2 | `.docx`+`.doc` | MinerU flash-extract | 兜底，免费无 token |
| 3 | `.doc` 兜底 | 二进制 UTF-16/GBK 扫描 | 纯 Node.js，无需依赖 |

- **MinerU CLI**: `~/.hermes/node/lib/node_modules/mineru-open-api-linux-x64/bin/mineru-open-api`
- **MinerU flash-extract 限制**: 10MB / 20页，无需 token
- **MinerU extract 模式**: 支持 `.doc`、表格识别、公式识别，需要 https://mineru.net/apiManage/token
- mammoth 只支持 `.docx`（ZIP/XML），不支持 `.doc` 二进制格式

### 支持的文件类型

| 类型 | 解析方式 | 后端模块 |
|------|----------|----------|
| `.docx` | mammoth → MinerU | FileParserService.parseWord |
| `.doc` | MinerU → 二进制扫描 | FileParserService.parseOldDoc |
| `.xlsx`/`.xls` | xlsx (SheetJS) | FileParserService.parseExcel |
| `.pdf` | pdf-parse | FileParserService.parsePdf |
| `.txt` | Node.js Buffer | FileParserService.parseText |
| 图片 | base64 透传 | FileParserService.parseImage |

### 消息内容合并格式
```
【Word 文档内容 - xxx.docx】
<提取的纯文本>
```

错误时在消息后追加：
```
📎 [xxx.doc]: <错误提示>
```

## ClawHub CLI 集成

**安装位置**: `~/.hermes/node/lib/node_modules/clawhub/`
**主要命令**:
- `clawhub search <query>` - 向量搜索技能
- `clawhub inspect <slug>` - 查看技能元数据（无需安装）
- `clawhub install <slug> --dir <path>` - 安装技能到本地目录
- `clawhub explore` - 浏览最新更新的技能

**工作流**: `clawhub search` → `clawhub inspect` → 读 SKILL.md → 调用对应工具

## 关键 Bug 修复记录

1. ✅ `chats.ts` 中 3 处双重 `getProjectWorkspacePath()` 调用 → 已修复
2. ✅ `db.chats.find()` → `ProjectChatService` → 已修复
3. ✅ DELETE 端点缺少 `projectId` query 参数 → 已修复
4. ✅ 新建会话时 `agentId/modelId` 未保存 → 已修复
5. ✅ mammoth 不支持 `.doc` 二进制格式 → 已修复（MinerU + 二进制扫描）

## Agent 角色
- `architect_agent.md` - 系统架构师
- `backend_agent.md` - 后端工程师
- `frontend_agent.md` - 前端工程师
- `ux_agent.md` - UI/UX 设计
- `pm_agent.md` - 产品经理
- `qa_agent.md` - QA 工程师

## MEMORY.md 维护规范

**核心原则**：只存稳定事实，不存临时任务状态和会话过程。

**写入前进行摘要去重**：
1. **合并同类项** — 同模块的多条修复记录合并为一个条目
2. **去除过程细节** — 不存"尝试了 A 方法失败"、"改了 B 代码"等过程，只存最终结论
3. **去除重复状态** — Active State / Pending User Asks / In Progress 等会话过程不写入
4. **稳定事实优先** — Bug 修复、技术决策、路径约定、工具版本等持久化信息才写入
5. **结构化压缩** — 用表格替代列表过长项，用分层标题减少重复描述

**MEMORY.md 只应包含**：
- 项目结构和技术栈（稳定）
- Bug 修复记录（最终结论，只留一条）
- 关键路径约定和坑点（避免重复踩坑）
- 工具安装和配置状态（持久化）
- Phase 完成度（定期更新）

**MEMORY.md 不应包含**：
- 任务进度和 TODO
- Active State / In Progress 等临时状态
- 具体错误日志和堆栈
- 已被覆盖的方案和尝试过程
- 用户 Ask 的详细描述

## 2026-06-03 自动提取
**摘要**: 更新了模型同步接口，并计划将 Gemini 3 Pro 模型配置更新为 Gemini 3.1 Pro。

- [项目信息] 项目包含 ui/src/pages/SettingsPage.tsx 文件。（来源: 第[5]至[7]条工具返回信息）
- [项目信息] 项目使用 db.json 存储模型配置，且 models.ts 中新增了 sync-from-provider 接口。（来源: 第[9]条和第[10]条助手思考内容）
- [技术决策] 在 models.ts 中新增 sync-from-provider 接口用于从提供商同步模型。（来源: 第[9]条助手思考内容）
- [待办事项] 检查后端是否运行，验证并调用新接口，确认前端是否需要更新调用逻辑。（来源: 第[9]条助手思考内容）
- [待办事项] 在 db.json 中将 Gemini 3 Pro 模型配置更新为 Gemini 3.1 Pro。（来源: 第[10]条助手思考内容）
**摘要**: 用户要求编写并运行一个测试特定接口的 PowerShell 脚本。

- [待办事项] 编写并运行 PowerShell 脚本测试 http://localhost:3001/nonexistent 接口。（来源: 用户在消息[1]中提出）
- [用户偏好] 偏好使用 PowerShell 编写测试脚本并使用 shell_exec 工具执行。（来源: 用户在消息[1]中提出）
**摘要**: 用户要求编写并运行一个测试本地接口的 PowerShell 脚本，但因故未成功执行。

- [用户偏好] 偏好使用 PowerShell 编写测试脚本，并通过 shell_exec 工具直接运行。（来源: 第1条用户消息）
- [待办事项] 编写 PowerShell 脚本测试 http://localhost:3001/nonexistent 接口并处理异常。（来源: 第1条用户消息）
**摘要**: 创建并运行了用于测试不存在接口的 PowerShell 脚本，并确定了脚本存放路径。

- [项目信息] 测试脚本保存在 `pm/test-nonexistent.ps1` 中。（来源: 助手在消息[2]中的回复）
- [技术决策] 使用 PowerShell 的 try-catch 结构请求接口，成功时用 ConvertTo-Json 输出，失败时打印错误。（来源: 用户在消息[1]中的请求）
- [用户偏好] 偏好使用 shell_exec 工具直接运行编写的脚本。（来源: 用户在消息[1]中的请求）
