import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname 等价：相对源文件定位，不依赖 process.cwd()
// （进程可能从任何目录启动 — 用 cwd 会读到错误文件导致数据丢失）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'db.json');

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

    // 如果前端没传，尝试从 db.json 中读取第一个可用模型
    if (!baseUrl || !apiKey) {
      const dbContent = await readFile(DB_PATH, 'utf-8');
      const db = JSON.parse(dbContent);
      const models = db.availableModels || [];
      if (models.length > 0) {
        const firstModel = models.find((m: any) => m.baseUrl) || models[0];
        baseUrl = baseUrl || firstModel.baseUrl;
        apiKey = apiKey || firstModel.apiKey;
      }
    }

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

  // 更新当前 provider 下所有可用模型
  fastify.post('/sync-from-provider', async (request, reply) => {
    const { provider, baseUrl, apiKey } = request.body as { provider?: string, baseUrl?: string, apiKey?: string };

    let targetBaseUrl = baseUrl;
    let targetApiKey = apiKey;

    // 如果没有提供 baseUrl/apiKey，则使用 db.json 中已存在的模型配置
    if (!targetBaseUrl || !targetApiKey) {
      const dbContent = await readFile(DB_PATH, 'utf-8');
      const db = JSON.parse(dbContent);
      const models = db.availableModels || [];

      if (models.length === 0) {
        return reply.status(400).send({ error: '请提供 baseUrl 和 apiKey，或确保 db.json 中已有模型配置' });
      }

      // 优先使用非 minimax 的模型（更通用）
      const generalModel = models.find((m: any) => m.provider !== 'minimax') || models[0];
      targetBaseUrl = targetBaseUrl || generalModel.baseUrl;
      targetApiKey = targetApiKey || generalModel.apiKey;
    }

    // 读取 db 用于后续操作
    const dbContent = await readFile(DB_PATH, 'utf-8');
    const db = JSON.parse(dbContent);

    // 1. 基础路径清洗
    let cleanBaseUrl = targetBaseUrl.trim().replace(/\/$/, '');
    if (!cleanBaseUrl.startsWith('http')) {
      cleanBaseUrl = `https://${cleanBaseUrl}`;
    }

    // 2. 智能补全 /models 路径
    const url = cleanBaseUrl.endsWith('/models') ? cleanBaseUrl : `${cleanBaseUrl}/models`;

    console.log(`[Sync] 正在从 ${url} 同步模型列表...`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${targetApiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'OpenClaw-Backend-Agent'
        }
      });

      if (!response.ok) {
        const status = response.status;
        const errorText = await response.text();
        console.error(`[Sync] 远程服务报错 (${status}): ${errorText}`);
        return reply.status(status).send({ error: `远程服务返回错误 (${status}): ${errorText}` });
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return reply.status(500).send({ error: '远程服务返回了非 JSON 格式的数据' });
      }

      const data: any = await response.json();
      const remoteModels = data.data || data;
      
      if (!Array.isArray(remoteModels)) {
        return reply.status(500).send({ error: '远程服务返回的数据格式不符合模型列表规范' });
      }

      // 保留现有模型的温度/maxTokens设置
      const existingModels = (db.availableModels || []) as any[];
      const existingMap = new Map<string, any>(existingModels.map(m => [m.modelId, m]));

      // 保留非目标 provider 的模型
      const targetProvider = provider || 'glue';
      const otherModels = existingModels.filter((m: any) => {
        if (m.provider !== targetProvider) return true;
        // 如果 baseUrl 不包含在目标 URL 中，也保留
        if (targetBaseUrl && !m.baseUrl?.includes(new URL(targetBaseUrl).host)) return true;
        return false;
      });

      // 构建新模型列表
      const newModels = remoteModels.map((m: any) => {
        const modelId = m.id || m.modelId || '';
        const existing = existingMap.get(modelId);

        return {
          id: modelId,
          name: m.name || modelId,
          modelId: modelId,
          baseUrl: cleanBaseUrl,
          apiKey: targetApiKey,
          provider: targetProvider,
          temperature: existing?.temperature ?? 0.7,
          maxTokens: existing?.maxTokens ?? 4096,
          description: m.description || `Via ${targetProvider} proxy: ${modelId}`
        };
      });

      // 合并模型列表
      const updatedDb = {
        ...db,
        availableModels: [...otherModels, ...newModels]
      };

      // 保存
      await writeFile(DB_PATH, JSON.stringify(updatedDb, null, 2), 'utf-8');

      // 更新内存缓存
      const DbService = (await import('../services/DbService.js')).DbService;
      await DbService.reload();

      console.log(`[Sync] 完成: 保留 ${otherModels.length} 个非 ${targetProvider} 模型，新增 ${newModels.length} 个 ${targetProvider} 模型`);

      return {
        success: true,
        message: `已同步 ${newModels.length} 个 ${targetProvider} 模型`,
        totalModels: updatedDb.availableModels.length,
        newModels: newModels.length,
        existingModels: otherModels.length
      };
    } catch (err: any) {
      console.error(`[Sync] 连接失败: ${err.message}`);
      return reply.status(500).send({ error: `无法连接到远程服务: ${err.message}` });
    }
  });

  // 删除全局模型
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteGlobalModel(id);
  });
}
