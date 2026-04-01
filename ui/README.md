# OpenClaw Frontend

OpenClaw 项目的前端界面，基于 React + TypeScript 构建。

## 功能描述

本项目是 OpenClaw AI 助手平台的 Web 管理界面，提供可视化操作体验。

### 核心功能

- **项目管理** - 创建、编辑、删除项目，项目仪表盘
- **智能体管理** - 配置和管理 AI 智能体
- **模型管理** - 添加、配置 AI 模型
- **对话管理** - 会话列表、聊天界面
- **技能管理** - 技能配置和使用
- **文件管理** - 文件上传、浏览和管理
- **系统设置** - 系统配置和个性化设置
- **活动记录** - 查看操作日志和活动历史
- **记忆管理** - 上下文和记忆管理

### 页面模块

| 页面 | 路径 | 说明 |
|------|------|------|
| 项目列表 | `/` | 项目管理和列表 |
| 项目仪表盘 | `/project/:id` | 项目详情和概览 |
| 智能体 | `/agents` | 全局智能体配置 |
| 模型 | `/models` | AI 模型管理 |
| 技能 | `/skills` | 技能管理 |
| 文件 | `/files` | 文件管理 |
| 设置 | `/settings` | 系统设置 |
| 活动 | `/activity` | 活动记录 |
| 记忆 | `/memory` | 记忆管理 |

## 技术架构

### 技术栈

- **框架**: React 18
- **语言**: TypeScript
- **构建工具**: Vite
- **样式**: Tailwind CSS + PostCSS
- **图标**: Lucide React
- **Markdown**: react-markdown + remark-gfm
- **排版**: @tailwindcss/typography

### 项目结构

```
ui/
├── src/
│   ├── main.tsx              # 入口文件
│   ├── App.tsx               # 主应用组件
│   ├── index.css             # 全局样式
│   ├── components/           # 组件
│   │   ├── layout/           # 布局组件
│   │   │   ├── AppShell.tsx
│   │   │   └── ContextPanel.tsx
│   │   ├── model/            # 模型相关
│   │   │   └── AddModelDialog.tsx
│   │   └── ui/               # 基础 UI 组件
│   ├── pages/                # 页面组件
│   │   ├── ActivityPage.tsx
│   │   ├── AgentsPage.tsx
│   │   ├── ChatDetailPage.tsx
│   │   ├── FilesPage.tsx
│   │   ├── GlobalAgentsPage.tsx
│   │   ├── MemoryPage.tsx
│   │   ├── ModelsPage.tsx
│   │   ├── ProjectDashboardPage.tsx
│   │   ├── ProjectListPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── SkillsPage.tsx
│   └── contexts/             # React Context
│       └── ProjectContext.tsx
├── public/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── yarn.lock
```

## 启动方式

### 前置要求

- Node.js 18+
- yarn 或 npm

### 安装依赖

```bash
cd ui
yarn install
```

或使用 npm:

```bash
cd ui
npm install
```

### 开发模式

启动开发服务器，支持热重载：

```bash
yarn dev
```

默认访问 `http://localhost:5173`

### 生产构建

```bash
yarn build
```

构建产物输出到 `dist/` 目录

### 预览构建

```bash
yarn preview
```

### API 配置

前端默认连接后端服务 `http://localhost:3001`，如需修改请在代码中调整 API 请求地址。

## 技术细节

### Tailwind CSS 配置

使用 Tailwind CSS 进行样式管理，配合 `@tailwindcss/typography` 插件实现美观的 Markdown 渲染效果。

### 组件架构

- **布局组件** (`components/layout/`) - 应用外壳、侧边栏、上下文面板
- **业务组件** - 各功能模块的专用组件
- **UI 组件** (`components/ui/`) - 可复用的基础 UI 组件

### 状态管理

使用 React Context (`ProjectContext`) 进行项目级状态管理。