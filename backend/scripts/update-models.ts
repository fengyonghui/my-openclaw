import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const DB_PATH = path.resolve(process.cwd(), 'data/db.json');

async function fetchRemoteModels() {
  const baseUrl = 'http://localhost:8080/v1';
  const url = `${baseUrl}/models`;
  const apiKey = '13391822168';

  console.log(`[Fetch] 正在从 ${url} 获取模型列表...`);

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
    console.error(`[Fetch] 远程服务报错 (${status}): ${errorText}`);
    throw new Error(`HTTP ${status}: ${errorText}`);
  }

  const data: any = await response.json();
  const models = data.data || data;

  if (!Array.isArray(models)) {
    throw new Error('返回数据格式不符合模型列表规范');
  }

  console.log(`[Fetch] 获取到 ${models.length} 个模型`);
  return models;
}

async function updateModels() {
  // 加载数据库
  const dbContent = await readFile(DB_PATH, 'utf-8');
  const db = JSON.parse(dbContent);

  // 获取远程模型列表
  const remoteModels = await fetchRemoteModels();

  // 保留现有模型的温度/maxTokens设置
  const existingModels = db.availableModels || [];
  const existingMap = new Map(existingModels.map(m => [m.modelId, m]));

  // 过滤出 glue provider 的模型 (baseUrl 包含 localhost:8080)
  const glueModels = remoteModels.filter(m => {
    const id = m.id || m.modelId || '';
    // 远程API返回的模型ID格式可能是 "provider/model-id"
    return !id.includes('/') || id.startsWith('glue/') || id.startsWith('claude-') || id.startsWith('gpt-') || id.startsWith('gemini-') || id.startsWith('deepseek-') || id.startsWith('minimax');
  });

  console.log(`[Filter] 符合 glue provider 的模型: ${glueModels.length} 个`);

  // 构建新模型列表
  const newModels = remoteModels.map(m => {
    const modelId = m.id || m.modelId || '';
    const existing = existingMap.get(modelId);
    
    return {
      id: modelId,
      name: m.name || modelId,
      modelId: modelId,
      baseUrl: 'http://localhost:8080/v1',
      apiKey: '13391822168',
      provider: 'glue',
      temperature: existing?.temperature ?? 0.7,
      maxTokens: existing?.maxTokens ?? 4096,
      description: m.description || `Via glue proxy: ${modelId}`
    };
  });

  console.log(`[Update] 更新模型数量: ${db.availableModels?.length || 0} -> ${newModels.length}`);

  // 保留非 glue provider 的模型
  const nonGlueModels = (db.availableModels || []).filter(m => 
    m.provider !== 'glue' && !m.baseUrl?.includes('localhost:8080')
  );

  db.availableModels = [...nonGlueModels, ...newModels];

  // 保存
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  console.log(`[Success] 已更新模型列表，共 ${db.availableModels.length} 个模型`);

  return db.availableModels;
}

updateModels().catch(err => {
  console.error('[Error]', err.message);
  process.exit(1);
});