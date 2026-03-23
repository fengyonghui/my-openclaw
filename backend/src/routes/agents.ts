import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function AgentRoutes(fastify: FastifyInstance) {
  // 获取项目内的 Agent 列表 (已在 projects.ts 中定义，这里保持兼容)
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId: string };
    const agents = await DbService.getAgents();
    // 实际生产中这里应从项目配置中过滤，目前返回全局可用 Agent
    return agents;
  });
}
