/**
 * FeatureFlags Routes - 功能开关管理 API
 */

import { FastifyInstance } from 'fastify';
import { featureFlags } from '../services/FeatureFlags.js';

export async function FeatureFlagsRoutes(fastify: FastifyInstance) {

  // GET /api/v1/flags - 获取所有功能开关
  fastify.get('/', async () => {
    return featureFlags.getAll();
  });

  // GET /api/v1/flags/:key - 获取单个功能开关
  fastify.get('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const flag = featureFlags.get(key);
    if (!flag) return reply.status(404).send({ error: '功能开关不存在' });
    return flag;
  });

  // GET /api/v1/flags/:key/evaluate - 评估功能开关
  fastify.get('/:key/evaluate', async (request, reply) => {
    const { key } = request.params as { key: string };
    const { projectId, environment } = request.query as { projectId?: string; environment?: string };
    return featureFlags.evaluate(key, { projectId, environment });
  });

  // POST /api/v1/flags - 创建功能开关
  fastify.post('/', async (request, reply) => {
    const data = request.body as any;
    if (!data.key || !data.name) {
      return reply.status(400).send({ error: '缺少 key 或 name' });
    }
    const created = featureFlags.create(data);
    if (!created) {
      return reply.status(409).send({ error: '功能开关已存在' });
    }
    return reply.status(201).send(created);
  });

  // PATCH /api/v1/flags/:key - 更新功能开关
  fastify.patch('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const updates = request.body as any;
    const updated = featureFlags.update(key, updates);
    if (!updated) {
      return reply.status(404).send({ error: '功能开关不存在' });
    }
    return updated;
  });

  // POST /api/v1/flags/:key/enable - 启用功能开关
  fastify.post('/:key/enable', async (request, reply) => {
    const { key } = request.params as { key: string };
    const updated = featureFlags.setEnabled(key, true);
    if (!updated) return reply.status(404).send({ error: '功能开关不存在' });
    return updated;
  });

  // POST /api/v1/flags/:key/disable - 禁用功能开关
  fastify.post('/:key/disable', async (request, reply) => {
    const { key } = request.params as { key: string };
    const updated = featureFlags.setEnabled(key, false);
    if (!updated) return reply.status(404).send({ error: '功能开关不存在' });
    return updated;
  });

  // POST /api/v1/flags/:key/rollout - 设置灰度百分比
  fastify.post('/:key/rollout', async (request, reply) => {
    const { key } = request.params as { key: string };
    const { percentage } = request.body as { percentage: number };
    if (percentage === undefined || percentage < 0 || percentage > 100) {
      return reply.status(400).send({ error: 'percentage 必须在 0-100 之间' });
    }
    const updated = featureFlags.setRollout(key, percentage);
    if (!updated) return reply.status(404).send({ error: '功能开关不存在' });
    return updated;
  });

  // DELETE /api/v1/flags/:key - 删除功能开关
  fastify.delete('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const deleted = featureFlags.delete(key);
    if (!deleted) return reply.status(404).send({ error: '功能开关不存在' });
    return { success: true };
  });

  // POST /api/v1/flags/reset - 重置为默认
  fastify.post('/reset', async () => {
    featureFlags.reset();
    return { success: true, message: '已重置为默认功能开关' };
  });
}
