/**
 * 数据同步服务 - 启动时自动同步文件系统到数据库
 *
 * 功能：
 * 1. 扫描所有项目的 data/chats/ 目录
 * 2. 将缺失的聊天记录同步到数据库
 * 3. 确保项目列表完整（从本地配置文件、日志和工作空间目录恢复）
 *
 * 注意：known-workspaces.json 是本机私有的数据恢复配置（gitignore，
 * 不进 release 包）—— 项目列表的机器特定信息不能硬编码在源码里，
 * 否则 release 到新机器上会把维护者的项目"恢复"出来。
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbService } from '../services/DbService.js';

interface WorkspaceEntry {
  id: string;
  name: string;
  workspace: string;
}

/**
 * 读取本机私有的工作空间恢复配置 data/known-workspaces.json。
 * 文件不存在（如 release 新装环境）返回空列表 —— 恢复流程跳过，
 * 项目列表靠用户在 UI 里正常创建。
 */
function loadKnownWorkspaces(): WorkspaceEntry[] {
  const path = join(process.cwd(), 'data', 'known-workspaces.json');
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkspaceEntry[];
  } catch (err: any) {
    console.warn('[DataSync] known-workspaces.json 解析失败，跳过恢复:', err.message);
    return [];
  }
}

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

    // 从本机私有配置检查（known-workspaces.json，gitignore 不进 release）
    const knownWorkspaces = loadKnownWorkspaces();
    knownWorkspaces.forEach(ws => {
      if (!existingIds.has(ws.id)) {
        missing.push(ws);
      }
    });

    // 从 session 日志中提取项目ID（日志只在产生它的机器上存在，天然机器隔离）
    const logPath = join(process.cwd(), 'data', 'session-events.jsonl');
    if (existsSync(logPath)) {
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        try {
          const obj = JSON.parse(line);
          if (obj.projectId && !existingIds.has(obj.projectId)) {
            // 只在 known-workspaces.json 有该项目的记录时才恢复 ——
            // 不再猜 d:/workspace/<id> 这种维护者机器专属的路径
            const known = knownWorkspaces.find(w => w.id === obj.projectId);
            if (known) {
              missing.push(known);
            }
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
            enabledSkillIds: [
              'builtin-file-io',
              'builtin-shell-cmd',
              'builtin-inline-python-edit',
            ],
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
   *
   * 2026-11-11: 只同步「元数据索引」，不再把会话全文灌进 db.json。
   *   原因：项目文件就是会话正文的唯一真相源，全文副本会让 db.json
   *   膨胀到 125MB，且每次 save() 都要整体重写。详见 DbService.toChatIndex。
   *   同时这里改为「按已知工作区扫描」而非写死 KNOWN_WORKSPACES 之外的项目 ——
   *   实际上 KNOWN_WORKSPACES 只覆盖了 8 个项目，db.json 里还有其它项目的会话，
   *   那些会话在项目文件存在时同样应降级为索引。
   */
  private static async syncChats() {
    const db = await DbService.load();
    const existingChatIds = new Set(db.chats.map((c: any) => String(c.id)));
    let added = 0;
    let slimmed = 0;

    // 遍历源用 db.json 的 projects 列表（含全部项目），而非硬编码的
    // KNOWN_WORKSPACES —— 后者只覆盖 8 个项目，会漏掉 onewindow-dv、
    // db_struct_sync 等，导致它们的会话无法被降级为索引。
    const workspaces: Array<{ id: string; workspace: string }> = (db.projects || [])
      .filter((p: any) => p?.id && p?.workspace)
      .map((p: any) => ({ id: String(p.id), workspace: p.workspace }));

    for (const ws of workspaces) {
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

          // 只存元数据索引 —— 正文已在项目文件里（就是刚读出来的这个文件）
          db.chats.push(DbService.toChatIndex(chat));
          existingChatIds.add(chatId);
          added++;
        }
      } catch (err: any) {
        console.error(`  ⚠️ 读取 ${ws.id}/data/chats/ 失败:`, err.message);
      }
    }

    // 已有条目降级：正文已在项目文件中的会话，db.json 里只保留元数据
    // 统一走 DbService.toChatIndex()，保证降级后的条目结构与新写入的一致
    // （含 _indexOnly 标记与 messageCount），而不是简单 delete messages。
    for (let i = 0; i < db.chats.length; i++) {
      const chat = db.chats[i];
      const ws = workspaces.find(w => w.id === chat.projectId);
      if (!ws) continue;                              // 项目不在列表里 → 保留正文（孤儿）
      const projFile = join(ws.workspace, 'data', 'chats', `${chat.id}.json`);
      if (!existsSync(projFile)) continue;             // 项目文件不在 → 保留正文（孤儿）

      if (Array.isArray(chat.messages)) {
        // 带正文 → 降级为索引
        db.chats[i] = DbService.toChatIndex(chat);
        slimmed++;
      } else if (chat._indexOnly !== true) {
        // 已是「无正文」但缺标记（早期版本用 delete messages 降级留下的）
        // → 补齐为标准索引结构，保证幂等
        db.chats[i] = DbService.toChatIndex(chat);
        slimmed++;
      }
    }

    if (added > 0 || slimmed > 0) {
      await DbService.save();
      console.log(`  ✅ 同步聊天: +${added} 条, 降级为索引 ${slimmed} 条`);
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
      // 添加默认模型（MiniMax-M3）。API Key 必须来自环境变量 OPENCLAW_API_KEY ——
      // 不能在源码里放默认值，否则会随 release 包泄漏维护者的 Key
      const apiKey = process.env.OPENCLAW_API_KEY;
      if (!apiKey) {
        console.warn('  ⚠️ 未配置 OPENCLAW_API_KEY 环境变量，跳过默认模型创建');
        console.warn('     （可在系统环境变量或 backend/.env 中配置后重启）');
        return;
      }
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
