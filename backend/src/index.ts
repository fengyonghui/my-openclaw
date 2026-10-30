import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join } from 'path';
import { ProjectRoutes } from './routes/projects.js';
import { AgentRoutes } from './routes/agents.js';
import { ChatRoutes } from './routes/chats.js';
import { ProjectChatRoutes } from './routes/project-chats.js';
import { SystemRoutes } from './routes/system.js';
import { ModelRoutes } from './routes/models.js';
import { SkillRoutes } from './routes/skills.js';
import { FileRoutes } from './routes/files.js';
import { SystemToolsRoutes } from './routes/systemTools.js';
import { SystemCommandsRoutes } from './routes/systemCommands.js';
import { HeartbeatRoutes } from './routes/heartbeats.js';
import { FeatureFlagsRoutes } from './routes/feature-flags.js';
import { TableMetadataRoutes } from './routes/tableMetadata.js';
import { VersionRoutes } from './routes/version.js';
import { bootstrapSystemCommands } from './services/systemBootstrap.js';
import { restoreHeartbeats } from './services/HeartbeatService.js';
import { DataSyncService } from './services/DataSyncService.js';

// bodyLimit 50 MiB — 修复用户带附件提交后被 fastify 默认 1 MiB 限制打回 413 的问题
// 背景：前端 send 端点把附件 base64 (dataUrl) 直接塞 JSON body，base64 比 binary 大 33%
//   + JSON encoding 多倍，几个常见附件（pdf/xlsx/图片）就超限。前端 UI 看到的是"提交后页面
//   空白 + LLM 没响应"，实际是后端 413 直接拒绝，processSSEStream 收不到任何 chunk。
// 上限 50 MiB 覆盖：~30MB 文件转 base64 ~40MB JSON 仍 OK；超过此值应让前端单独处理（避免 DoS）。
const fastify = Fastify({
  logger: true,
  bodyLimit: 50 * 1024 * 1024,
});

// --- Plugins (增强型跨域配置) ---
await fastify.register(cors, {
  origin: true, // 允许所有来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Type', 'Cache-Control', 'Connection'],
  credentials: true
});

// --- Routes ---
await fastify.register(VersionRoutes, { prefix: '/api/version' });
await fastify.register(ProjectRoutes, { prefix: '/api/v1/projects' });
await fastify.register(AgentRoutes, { prefix: '/api/v1/agents' });
await fastify.register(ChatRoutes, { prefix: '/api/v1/chats' });
await fastify.register(ProjectChatRoutes, { prefix: '/api/v1/project-chats' });
await fastify.register(SystemRoutes, { prefix: '/api/v1/system' });
await fastify.register(ModelRoutes, { prefix: '/api/v1/models' });
await fastify.register(SkillRoutes, { prefix: '/api/v1/skills' });
await fastify.register(FileRoutes, { prefix: '/api/v1' });
await fastify.register(SystemToolsRoutes, { prefix: '/api/tools' });
await fastify.register(SystemCommandsRoutes, { prefix: '/api/tools' });
await fastify.register(HeartbeatRoutes, { prefix: '/api/v1/heartbeats' });
await fastify.register(FeatureFlagsRoutes, { prefix: '/api/v1/flags' });
await fastify.register(TableMetadataRoutes, { prefix: '/api/v1/table-metadata' });

// --- Serve built frontend in production ---
// In release zip: backend/ and ui/ are siblings, so ui/dist is ../ui/dist relative to backend/
const uiDistPath = join(process.cwd(), '..', 'ui', 'dist');
await fastify.register(fastifyStatic, {
  root: uiDistPath,
  prefix: '/',
  decorateReply: true,
  wildcard: false,
});

// SPA fallback — all non-API routes serve index.html
fastify.setNotFoundHandler(async (_request, reply) => {
  return reply.sendFile('index.html');
});

// --- Start Server ---
try {
  // 启动时写入当前系统的正确命令集
  bootstrapSystemCommands();

  // 数据同步：确保文件系统数据已导入数据库
  await DataSyncService.syncOnStartup();

  // 预热 workspaceCache（避免首请求触发 130MB db.json 解析）
  // 同步执行：仅一次 660ms 代价，但保证首个会话打开就在快速路径
  const { DbService } = await import('./services/DbService.js');
  await DbService.load();

  // 恢复所有心跳调度
  await restoreHeartbeats();
  
  await fastify.listen({ port: 3001, host: '0.0.0.0' });
  console.log(`🚀 OpenClaw Backend + Frontend running on http://localhost:3001`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
