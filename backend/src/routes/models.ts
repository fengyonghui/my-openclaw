import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function ModelRoutes(fastify: FastifyInstance) {
  // 获取全局模型
  fastify.get('/', async () => {
    return await DbService.getModels();
  });

  // 添加全局模型 (支持批量)
  fastify.post('/', async (request) => {
    const body = request.body as any;
    if (Array.isArray(body)) {
      for (const item of body) {
        await DbService.addGlobalModel(item);
      }
      return await DbService.getModels();
    }
    return await DbService.addGlobalModel(body);
  });

  // 扫描远程模型 (代理请求 - 增强版)
  fastify.post('/fetch-remote', async (request, reply) => {
    let { baseUrl, apiKey } = request.body as { baseUrl: string, apiKey: string };
    
    if (!baseUrl) return reply.status(400).send({ error: 'Base URL 不能为空' });

    // 1. 基础路径清洗
    let cleanBaseUrl = baseUrl.trim().replace(/\/$/, '');
    if (!cleanBaseUrl.startsWith('http')) {
      cleanBaseUrl = `https://${cleanBaseUrl}`;
    }

    // 2. 智能补全 /models 路径
    const url = cleanBaseUrl.endsWith('/models') ? cleanBaseUrl : `${cleanBaseUrl}/models`;

    console.log(`[Proxy] 正在从以下地址扫描模型: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'OpenClaw-Backend-Agent'
        }
      });

      if (!response.ok) {
        const status = response.status;
        const errorText = await response.text();
        console.error(`[Proxy] 远程服务报错 (${status}): ${errorText}`);
        
        let tip = '请检查 API Key 是否正确，或 Base URL 是否需要补全 /v1 (例如: https://api.openai.com/v1)';
        if (status === 404) tip = '接口不存在，请检查 Base URL (例如: 是否遗漏了 /v1)';
        if (status === 401) tip = 'API Key 无效或已过期';

        return reply.status(status).send({ error: `远程服务返回错误 (${status}): ${tip}` });
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return reply.status(500).send({ error: '远程服务返回了非 JSON 格式的数据，请检查 URL 是否正确' });
      }

      const data: any = await response.json();
      const models = data.data || data;
      
      if (!Array.isArray(models)) {
        return reply.status(500).send({ error: '远程服务返回的数据格式不符合模型列表规范' });
      }

      return models;
    } catch (err: any) {
      console.error(`[Proxy] 连接失败: ${err.message}`);
      return reply.status(500).send({ error: `无法连接到远程服务: ${err.message}` });
    }
  });

  // 删除全局模型
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteGlobalModel(id);
  });
}
