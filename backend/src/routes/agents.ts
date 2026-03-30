import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function AgentRoutes(fastify: FastifyInstance) {
  // 获取项目内的 Agent 列表
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId: string };
    const agents = await DbService.getAgents();
    return agents;
  });

  // 更新 Agent (包括默认模型)
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    
    try {
      await DbService.updateAgent(id, updates);
      return { success: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
