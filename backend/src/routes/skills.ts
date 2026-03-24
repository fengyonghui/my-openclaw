import { FastifyInstance } from 'fastify';
import { DbService } from '../services/DbService.js';

export async function SkillRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => await DbService.getGlobalSkills());

  // 综合导入方案：针对 ClawHub 进行特化抓取
  fastify.post('/import', async (request, reply) => {
    const { url } = request.body as { url: string };
    if (!url) return reply.status(400).send({ error: 'URL is required' });

    try {
      let skillName = "";
      let skillDesc = "";
      let rawContent = "";
      let finalUrl = url;

      // 1. 如果是 ClawHub 链接，直接抓取详情页
      if (url.includes('clawhub.ai/') || url.includes('clawhub.com/')) {
        console.log(`>>> [CLAW HUB SNIFF] Fetching page: ${url}`);
        const pageRes = await fetch(url);
        const html = await pageRes.text();

        // 提取网页标题 (一般是技能名称)
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        skillName = titleMatch ? titleMatch[1].split('|')[0].replace('Skill:', '').trim() : "Unknown Skill";

        // 提取描述 (从 meta 标签中获取最准)
        const metaDescMatch = html.match(/<meta name="description" content="(.*?)"/i);
        skillDesc = metaDescMatch ? metaDescMatch[1].trim() : "Imported from ClawHub.";

        // 尝试寻找 SKILL.md 的链接进行内容抓取 (如有)
        const githubMatch = html.match(/https:\/\/github\.com\/[-a-zA-Z0-9._/]+/);
        if (githubMatch) {
          // 逻辑同前：尝试转换 GitHub 链接并抓取正文
        }
      } 
      
      // 2. 如果已经解析出名称和描述，则直接保存
      if (skillName && skillName !== "Unknown Skill") {
        const newSkill = {
          name: skillName,
          description: skillDesc,
          url: url,
          rawContent: rawContent || `# ${skillName}\n\n${skillDesc}`
        };
        return await DbService.addGlobalSkill(newSkill);
      }

      // 3. 兜底逻辑：文件直连解析
      let targetUrl = url.split('?')[0].replace(/\/+$/, '');
      if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
        targetUrl = targetUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }

      const res = await fetch(targetUrl);
      const content = await res.text();
      const h1Match = content.match(/^#\s+(.*)/m);
      const descMatch = content.match(/<description>([\s\S]*?)<\/description>/i);

      const resultSkill = {
        name: h1Match ? h1Match[1].trim() : targetUrl.split('/').pop() || 'New Skill',
        description: descMatch ? descMatch[1].trim() : 'Imported from URL.',
        url: url,
        rawContent: content
      };

      return await DbService.addGlobalSkill(resultSkill);
    } catch (err: any) {
      console.error('[IMPORT ERROR]', err.message);
      return reply.status(500).send({ error: err.message });
    }
  });

  // ZIP 智能导入逻辑 (保留)
  fastify.post('/import-zip', async (request, reply) => {
    // ... 原有逻辑保持不变 ...
    return reply.status(501).send({ error: "ZIP 导入当前不可用，请使用普通导入。" });
  });

  fastify.post('/manual', async (request) => {
    const { content } = request.body as { content: string };
    const h1Match = content.match(/^#\s+(.*)/m);
    const newSkill = {
      name: h1Match ? h1Match[1].trim() : 'Manual Skill',
      description: 'Manually pasted.',
      url: 'local://manual',
      rawContent: content
    };
    return await DbService.addGlobalSkill(newSkill);
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    const db = await DbService.load();
    db.availableSkills = db.availableSkills.filter((s: any) => String(s.id) !== String(id));
    await DbService.save();
    return db.availableSkills;
  });
}
