import { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function SystemRoutes(fastify: FastifyInstance) {
  // 列出指定路径下的所有子目录
  fastify.get('/ls', async (request, reply) => {
    const { currentPath } = request.query as { currentPath: string };
    const targetPath = currentPath || '/';

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => ({
          name: entry.name,
          path: path.join(targetPath, entry.name)
        }));

      return {
        currentPath: targetPath,
        parentPath: path.dirname(targetPath),
        directories
      };
    } catch (err: any) {
      return reply.status(500).send({ error: `无法读取目录: ${err.message}` });
    }
  });
}
