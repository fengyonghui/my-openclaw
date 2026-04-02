/**
 * 系统工具路由 - 旧版兼容
 * 
 * 注意：主要路由已迁移到 systemCommands.ts
 * 此文件保留用于兼容旧的 API
 */

import { FastifyInstance } from 'fastify';
import { getSystemInfo, getCommands, readFileCommand } from '../services/systemTools.js';

export async function SystemToolsRoutes(fastify: FastifyInstance) {
  // 注意: /commands 路由已由 systemCommands.ts 提供
  // 这里不再重复定义

  // 生成读取文件的命令（旧版兼容）
  fastify.post('/system/read-file-cmd', async (request: any, reply) => {
    const { filePath, lines, from, to } = request.body || {};
    if (!filePath) {
      return { success: false, error: '缺少 filePath 参数' };
    }
    try {
      const cmd = readFileCommand(filePath, { lines, from, to });
      return { success: true, command: cmd };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
