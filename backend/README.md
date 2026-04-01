# OpenClaw Backend

OpenClaw 项目的后端服务，提供 REST API 接口。

## 功能描述

本项目是一个基于 Fastify 框架的 Node.js 后端服务，为 OpenClaw AI 助手平台提供 API 支持。

### 核心功能

- **项目管理 (Projects)** - 项目的创建、查询、更新、删除
- **智能体管理 (Agents)** - AI 智能体的配置和管理
- **对话管理 (Chats)** - 会话管理、消息处理
- **模型管理 (Models)** - AI 模型配置
- **技能管理 (Skills)** - 内置技能和自定义技能
- **文件服务 (Files)** - 文件上传、下载、管理
- **系统管理 (System)** - 系统配置和状态查询

### API 端点

| 模块 | 前缀 | 说明 |
|------|------|------|
| Projects | `/api/v1/projects` | 项目管理 |
| Agents | `/api/v1/agents` | 智能体管理 |
| Chats | `/api/v1/chats` | 对话管理 |
| System | `/api/v1/system` | 系统管理 |
| Models | `/api/v1/models` | 模型管理 |
| Skills | `/api/v1/skills` | 技能管理 |
| Files | `/api/v1/files` | 文件服务 |

## 技术架构

### 技术栈

- **运行时**: Node.js
- **语言**: TypeScript
- **Web 框架**: Fastify v5
- **数据验证**: Zod
- **跨域支持**: @fastify/cors
- **自动加载**: @fastify/autoload
- **开发工具**: tsx (TypeScript Execute)

### 项目结构

```
backend/
├── src/
│   ├── index.ts          # 入口文件
│   ├── routes/           # 路由模块
│   │   ├── agents.ts
│   │   ├── chats.ts
│   │   ├── files.ts
│   │   ├── models.ts
│   │   ├── projects.ts
│   │   ├── skills.ts
│   │   └── system.ts
│   └── services/         # 业务服务
│       ├── BuiltinSkills.ts
│       ├── DbService.ts
│       └── FileToolService.ts
├── data/                 # 数据存储
├── dist/                 # 编译输出
├── package.json
├── tsconfig.json
└── yarn.lock
```

## 启动方式

### 前置要求

- Node.js 20+
- yarn 或 npm

### 安装依赖

```bash
cd backend
yarn install
```

或使用 npm:

```bash
cd backend
npm install
```

### 开发模式

使用 tsx 监听模式启动，支持热重载：

```bash
yarn dev
```

服务启动后访问 `http://localhost:3001`

### 生产构建

1. 编译 TypeScript:

```bash
yarn build
```

2. 启动生产服务:

```bash
yarn start
```

### 环境配置

默认配置：
- 端口: 3001
- 监听地址: 0.0.0.0 (支持所有网络接口)
- 日志: 开启 (Pino)

## API 文档

启动服务后，可访问根路径查看服务状态：

```
GET http://localhost:3001/
```

各模块 API 详细文档请参考各路由文件的注释说明。