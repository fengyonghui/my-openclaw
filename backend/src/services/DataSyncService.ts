/**
 * 数据同步服务 - 启动时自动同步文件系统到数据库
 *
 * 功能：
 * 1. 扫描所有项目的 data/chats/ 目录
 * 2. 将缺失的聊天记录同步到数据库
 * 3. 确保项目列表完整（从日志和工作空间目录恢复）
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DbService } from '../services/DbService.js';

// 已知的工作空间目录（从日志和配置中恢复）
const KNOWN_WORKSPACES: Array<{ id: string; name: string; workspace: string }> = [
  { id: 'my-openclaw', name: 'my-openclaw', workspace: 'd:/workspace/my-openclaw' },
  { id: 'voice-monitor', name: 'voice-monitor', workspace: 'd:/workspace/onewindow/voice-monitor' },
  { id: 'onewindow-mcp', name: 'onewindow-mcp', workspace: 'd:/workspace/onewindow/onewindow-mcp' },
  { id: 'onewindow-dify', name: 'onewindow-dify', workspace: 'd:/workspace/onewindow/onewindow-dify' },
  { id: 'test', name: 'test', workspace: 'd:/workspace/test' },
  { id: 'stock', name: 'stock', workspace: 'd:/workspace/stock' },
  { id: 'ai-material-preview', name: 'ai-material-preview', workspace: 'd:/workspace/onewindow/ai-material-preview' },
  { id: 'tools', name: 'tools', workspace: 'd:/workspace/tools' },
];

export class DataSyncService {
  /**
   * 启动时执行数据同步
   */
  static async syncOnStartup() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('🔄 数据同步检查...');
    console.log('════════════════════════════════════════════════════════════\n');

    try {
      await this.syncProjects();
      await this.syncChats();
      await this.syncModels();
      console.log('\n✅ 数据同步完成\n');
    } catch (err: any) {
      console.error('[DataSync] 同步失败:', err.message);
    }
  }

  /**
   * 同步项目列表
   * 从已知工作空间和 session 日志中恢复
   */
  private static async syncProjects() {
    const db = await DbService.load();
    const existingIds = new Set(db.projects.map((p: any) => String(p.id)));
    const missing: Array<{ id: string; name: string; workspace: string }> = [];

    // 从已知工作空间检查
    KNOWN_WORKSPACES.forEach(ws => {
      if (!existingIds.has(ws.id)) {
        missing.push(ws);
      }
    });

    // 从 session 日志中提取项目ID
    const logPath = join(process.cwd(), 'data', 'session-events.jsonl');
    if (existsSync(logPath)) {
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        try {
          const obj = JSON.parse(line);
          if (obj.projectId && !existingIds.has(obj.projectId)) {
            missing.push({
              id: obj.projectId,
              name: obj.projectId,
              workspace: join('d:/workspace', obj.projectId)
            });
          }
        } catch {}
      });
    }

    // 添加缺失的项目（去重：只添加不存在的项目）
    if (missing.length > 0) {
      missing.forEach(ws => {
        // 双重检查：确保项目不存在
        const exists = db.projects.some((p: any) => String(p.id) === String(ws.id));
        if (!exists) {
          db.projects.push({
            ...ws,
            defaultModel: db.availableModels?.[0]?.id || '',
            enabledAgentIds: [],
            enabledSkillIds: [],
            createdAt: new Date().toISOString()
          });
          console.log('  📁 恢复项目:', ws.id);
        }
      });
      await DbService.save();
    } else {
      console.log('  ✅ 项目列表完整');
    }
  }

  /**
   * 同步聊天数据
   * 从各项目工作区的 data/chats/ 目录读取
   */
  private static async syncChats() {
    const db = await DbService.load();
    const existingChatIds = new Set(db.chats.map((c: any) => String(c.id)));
    let added = 0;

    for (const ws of KNOWN_WORKSPACES) {
      const chatsDir = join(ws.workspace, 'data', 'chats');
      if (!existsSync(chatsDir)) continue;

      try {
        const files = await readdir(chatsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const chatId = file.replace('.json', '');
          if (existingChatIds.has(chatId)) continue;

          const filePath = join(chatsDir, file);
          const content = await readFile(filePath, 'utf-8');
          const chat = JSON.parse(content);

          // 确保 projectId 正确
          if (!chat.projectId) chat.projectId = ws.id;

          db.chats.push(chat);
          existingChatIds.add(chatId);
          added++;
        }
      } catch (err: any) {
        console.error(`  ⚠️ 读取 ${ws.id}/data/chats/ 失败:`, err.message);
      }
    }

    if (added > 0) {
      await DbService.save();
      console.log(`  ✅ 同步聊天: +${added} 条`);
    } else {
      console.log('  ✅ 聊天数据完整');
    }
  }

  /**
   * 同步模型配置
   * 确保有可用的模型
   */
  private static async syncModels() {
    const db = await DbService.load();

    if (!db.availableModels || db.availableModels.length === 0) {
      // 添加默认模型（MiniMax-M3，API Key 从环境变量读取）
      const apiKey = process.env.OPENCLAW_API_KEY || 'REDACTED_API_KEY';
      db.availableModels = [{
        id: 'minimax-m3',
        name: 'MiniMax-M3',
        provider: 'minimax',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey,
        modelId: 'MiniMax-M3',
        temperature: 0.7,
        maxTokens: 8192
      }];
      await DbService.save();
      console.log('  ✅ 添加默认模型: MiniMax-M3');
    } else {
      console.log('  ✅ 模型配置完整');
    }

    // 确保所有项目都有默认模型
    const defaultModelId = db.availableModels[0]?.id;
    db.projects.forEach((p: any) => {
      if (!p.defaultModel) {
        p.defaultModel = defaultModelId;
      }
    });
    await DbService.save();
  }
}
