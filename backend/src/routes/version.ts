import { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 定义 package.json 的结构类型
interface PackageJson {
  name?: string;
  version?: string;
}

export async function VersionRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    try {
      // server is running from 'backend' dir, package.json is in the root dir
      const packageJsonPath = resolve(process.cwd(), '..', 'package.json');
      const fileContent = await readFile(packageJsonPath, 'utf-8');
      const { version = 'unknown' } = JSON.parse(fileContent) as PackageJson;

      return { version };
    } catch (error) {
      fastify.log.error(error, 'Failed to read version from package.json');
      return reply.status(500).send({ error: 'Could not retrieve version information.' });
    }
  });
}
