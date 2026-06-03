import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function TableMetadataRoutes(fastify: FastifyInstance) {

  // 分页列表
  fastify.get('/', async (request) => {
    const { pageNum = '1', pageSize = '10', keyword } = request.query as any;
    return await DbService.getTableMetadataPage(
      parseInt(pageNum),
      parseInt(pageSize),
      keyword || undefined
    );
  });

  // 全部列表（不分页，用于下拉选择）
  fastify.get('/all', async () => {
    return await DbService.getTableMetadataList();
  });

  // 按表名查单条
  fastify.get('/by-name/:tableName', async (request) => {
    const { tableName } = request.params as { tableName: string };
    return await DbService.getTableMetadataByName(tableName);
  });

  // 新增
  fastify.post('/', async (request) => {
    const body = request.body as any;
    return await DbService.saveTableMetadata(body);
  });

  // 更新
  fastify.put('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    return await DbService.updateTableMetadata(parseInt(id), body);
  });

  // 删除
  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return await DbService.deleteTableMetadata(parseInt(id));
  });

  // 刷新缓存
  fastify.post('/refresh-cache', async () => {
    const count = await DbService.refreshTableMetadataCache();
    return { message: `缓存已刷新，共 ${count} 条记录` };
  });
}