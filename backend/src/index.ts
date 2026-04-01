import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ProjectRoutes } from './routes/projects.js';
import { AgentRoutes } from './routes/agents.js';
import { ChatRoutes } from './routes/chats.js';
import { SystemRoutes } from './routes/system.js';
import { ModelRoutes } from './routes/models.js';
import { SkillRoutes } from './routes/skills.js';
import { FileRoutes } from './routes/files.js';
import { SystemToolsRoutes } from './routes/systemTools.js';
import { bootstrapSystemCommands } from './services/systemBootstrap.js';

const fastify = Fastify({ logger: true });

// --- Plugins (增强型跨域配置) ---
await fastify.register(cors, {
  origin: true, // 允许所有来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Type', 'Cache-Control', 'Connection'],
  credentials: true
});

// --- Routes ---
await fastify.register(ProjectRoutes, { prefix: '/api/v1/projects' });
await fastify.register(AgentRoutes, { prefix: '/api/v1/agents' });
await fastify.register(ChatRoutes, { prefix: '/api/v1/chats' });
await fastify.register(SystemRoutes, { prefix: '/api/v1/system' });
await fastify.register(ModelRoutes, { prefix: '/api/v1/models' });
await fastify.register(SkillRoutes, { prefix: '/api/v1/skills' });
await fastify.register(FileRoutes, { prefix: '/api/v1' });
await fastify.register(SystemToolsRoutes, { prefix: '/api/tools' });

// --- Start Server ---
try {
  // 启动时写入当前系统的正确命令集
  bootstrapSystemCommands();
  
  await fastify.listen({ port: 3001, host: '0.0.0.0' });
  console.log('🚀 OpenClaw Backend running on http://localhost:3001');
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
