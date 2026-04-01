import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { HeartbeatService } from '../services/HeartbeatService.js';

export async function HeartbeatRoutes(fastify: FastifyInstance) {

  // 获取项目的所有心跳配置
  fastify.get('/', async (request) => {
    const { projectId } = request.query as { projectId: string };
    if (!projectId) return [];
    return await DbService.getProjectHeartbeats(projectId);
  });

  // 创建心跳配置
  fastify.post('/', async (request) => {
    const config = request.body as any;
    return await DbService.createHeartbeat(config);
  });

  // 更新心跳配置
  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const updates = request.body as any;
    return await DbService.updateHeartbeat(id, updates);
  });

  // 删除心跳配置
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteHeartbeat(id);
  });

  // 手动触发一次心跳
  fastify.post('/:id/trigger', async (request) => {
    const { id } = request.params as { id: string };
    const result = await HeartbeatService.triggerHeartbeat(id);
    return result;
  });

  // 获取心跳执行历史
  fastify.get('/history', async (request) => {
    const { projectId, limit = '20' } = request.query as { projectId?: string; limit?: string };
    return await DbService.getHeartbeatHistory(projectId, parseInt(limit));
  });

  // 获取心跳运行状态
  fastify.get('/status', async (request) => {
    const { projectId } = request.query as { projectId: string };
    if (!projectId) return { active: false, heartbeats: [] };
    const heartbeats = await DbService.getProjectHeartbeats(projectId);
    const status = HeartbeatService.getStatus(projectId);
    return { active: status.running, heartbeats, status };
  });
}
