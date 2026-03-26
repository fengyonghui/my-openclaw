import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';
import { FileToolService } from '../services/FileToolService.js';

export async function FileRoutes(fastify: FastifyInstance) {
  fastify.get('/projects/:id/files/tree', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path = '.', depth = '3' } = request.query as { path?: string; depth?: string };
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.listFiles(project.workspace, path, Number(depth) || 3);
  });

  fastify.get('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, offset = '1', limit = '200' } = request.query as { path?: string; offset?: string; limit?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.readFile(project.workspace, path, Number(offset) || 1, Number(limit) || 200);
  });

  fastify.put('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, content } = request.body as { path?: string; content?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.writeFile(project.workspace, path, content || '');
  });

  fastify.patch('/projects/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { path, oldText, newText } = request.body as { path?: string; oldText?: string; newText?: string };
    if (!path) return reply.status(400).send({ error: 'path is required' });
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      return reply.status(400).send({ error: 'oldText and newText are required' });
    }
    const project = await DbService.getProject(id);
    if (!project?.workspace) return reply.status(404).send({ error: '项目未找到' });
    return await FileToolService.editFile(project.workspace, path, oldText, newText);
  });
}
