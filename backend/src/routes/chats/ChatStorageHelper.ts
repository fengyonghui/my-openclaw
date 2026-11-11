/**
 * ChatStorageHelper - 双源读写抽象（项目文件 + db.json）
 *
 * 性能优化 (2026-09-12)：
 *   - backend/data/db.json 已膨胀到 130MB，单次 DbService.load() 需 ~660ms
 *   - 项目目录 data/chats/<id>.json 单文件读取仅 ~19ms (38 倍快)
 *   - 读：项目文件优先 → db.json 回退
 *   - 写：双写保证后续读取命中快速路径
 *
 * 写策略：先写 db.json（已有原子性），再写项目文件（失败不回滚，前端会下次
 *         initData 重新走 DbService 兜底；DbService.save 内部 fs.writeFileSync 已是原子替换）。
 */

import { DbService } from '../../services/DbService.js';
import { ProjectDataService } from '../../services/ProjectDataService.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

let workspaceWarned = false;

/**
 * 读取会话：项目文件优先 → db.json 回退
 * @param chatId 会话 ID
 * @param projectId 可选，项目 ID。提供时优先走项目目录文件
 * @returns 会话对象或 null
 *
 * 重要 (2026-09-14): 移除 db.json 双写后，db.json 是陈旧的，仅作备份。
 * 若调用方没传 projectId，必须扫描 workspaceCache 找出 chatId 所属项目文件，
 * 不能直接回退到 db.json（否则 LLM 会拿到陈旧历史，回复错问题）。
 */
export async function readChat(chatId: string, projectId?: string): Promise<any | null> {
  // 1. 显式 projectId 路径（最快）
  if (projectId) {
    const workspace = await DbService.getProjectWorkspace(projectId);
    if (workspace) {
      const dataService = new ProjectDataService(workspace);
      const chat = dataService.getChat(chatId);  // ~19ms
      if (chat) return chat;
    }
  }

  // 2. 性能优化 (2026-09-14): 没传 projectId 时，扫描 workspaceCache 找 chatId
  // 对每个项目做 fs.existsSync 检查（毫秒级），命中后从项目文件读取。
  // 这样 runChatLLMStream 在没拿到 projectId 时也能读到最新内容。
  const workspaces = DbService.getAllProjectWorkspaces();
  for (const workspace of workspaces) {
    const filePath = path.join(workspace, 'data', 'chats', `${chatId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const dataService = new ProjectDataService(workspace);
        const chat = dataService.getChat(chatId);
        if (chat) return chat;
      } catch { /* fall through */ }
    }
  }

  // 3. 兜底：db.json（仅含启动时 DataSyncService 同步的旧数据，可能陈旧）
  //
  // 2026-11-11: db.json 瘦身后，多数会话在 db.json 里只剩元数据索引（无正文）。
  // 必须用 getChatWithBody() 而不是 getChat() —— 后者会把「有 id 没正文」的
  // 索引条目当成合法会话返回，runChatLLMStream 拿到空历史后
  // LLM 会答非所问（与 2026-10-30 的 Bug #13 同类症状）。
  // 返回 null = 正文确实不可得，上层应报「会话不存在」而非硬跑空历史。
  return await DbService.getChatWithBody(chatId);
}

/**
 * 双写会话：db.json（DbService）+ 项目目录文件
 * 用于 PATCH /:id 局部更新场景
 *
 * 性能优化 (2026-09-12): 同步写项目文件（快），异步 fire-and-forget 写 db.json，
 * 避免 DbService.save() 重写 130MB 阻塞响应。db.json 由 DataSyncService 兜底同步。
 */
export async function writeChatDual(chat: any): Promise<any> {
  if (!chat || !chat.id) throw new Error('writeChatDual: chat 必须有 id');

  // 1. 同步写项目文件（真实数据源，必须阻塞保证落盘）
  if (chat.projectId) {
    try {
      const workspace = await DbService.getProjectWorkspace(chat.projectId);
      if (workspace) {
        const dataService = new ProjectDataService(workspace);
        dataService.saveChat(chat);
      }
    } catch (err: any) {
      console.warn(`[ChatStorageHelper] 项目文件写入失败: ${err.message}`);
      return chat;
    }
  }

  // 2. 异步 fire-and-forget 写 db.json（仅冗余备份，不阻塞响应）
  setImmediate(() => {
    DbService.upsertChat(chat).catch((err: any) =>
      console.warn(`[ChatStorageHelper] db.json 异步写失败: ${err.message}`)
    );
  });

  return chat;
}

/**
 * 添加一条消息并双写
 * @param chatId 会话 ID
 * @param message 要追加的消息（含 role, content 等字段；id/timestamp 自动生成）
 * @param projectId 可选，提供时跳过 DbService.getChats() 全表查（避免 130MB 加载）
 * @returns 更新后的完整会话
 *
 * 性能优化 (2026-09-12): chat 内容真实来源是项目文件。热路径不再写 db.json，
 * 避免 DbService.save() 重写 130MB 引入 ~1.36s 阻塞。db.json 仅作冗余备份，
 * 由 DataSyncService 定期从项目文件同步（启动时已 syncOnStartup）。
 */
export async function appendMessageDual(chatId: string, message: any, projectId?: string): Promise<any | null> {
  // 优先用 projectId，避免加载整个 db.json
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    // 兜底：仅在 caller 没传 projectId 时才全表查
    const allChats = await DbService.getChats();
    const chatInDb = allChats.find((c: any) => String(c.id) === String(chatId));
    if (chatInDb) {
      resolvedProjectId = chatInDb.projectId;
    } else {
      // 关键修复 (2026-10-30): db.json 里找不到时，不要直接 return null 丢弃消息。
      // 改为扫描项目目录找 chatId 所属项目（与 readChat 第 2 步同策略）。
      //
      // 背景: chat 只存在于项目文件（db.json 尚未同步）时，旧逻辑返回 null，
      //   user 消息被完全丢弃 → runChatLLMStream 读到空历史 → LLM 收到
      //   空 messages → 报 "chat content is empty" 或答非所问。
      const workspaces = DbService.getAllProjectWorkspaces();
      for (const ws of workspaces) {
        const filePath = path.join(ws, 'data', 'chats', `${chatId}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const dataService = new ProjectDataService(ws);
            const chat = dataService.getChat(chatId);
            if (chat?.projectId) {
              resolvedProjectId = chat.projectId;
              break;
            }
          } catch { /* 继续扫描下一个 */ }
        }
      }
      if (!resolvedProjectId) {
        console.error(`[ChatStorageHelper] Chat not found: ${chatId}（db.json 与项目目录均未命中，消息将被丢弃）`);
        return null;
      }
    }
  }

  // 性能优化 (2026-09-12): 跳过 db.json 写放大，仅写项目文件
  // （旧的 DbService.addMessageToChat 会触发 DbService.save() 重写 130MB，~1.36s 阻塞）
  if (resolvedProjectId) {
    const workspace = await DbService.getProjectWorkspace(resolvedProjectId);
    if (workspace) {
      try {
        const dataService = new ProjectDataService(workspace);
        dataService.addMessage(chatId, message);
      } catch (err: any) {
        console.warn(`[ChatStorageHelper] 项目文件追加消息失败: ${err.message}`);
        return null;
      }
    }
  }

  // 返回最新会话（走快速路径）
  return await readChat(chatId, resolvedProjectId);
}

/**
 * 截断消息（resend 时删除 fromMessageId 之后所有消息）并双写
 * @param projectId 可选，提供时跳过 DbService.getChats() 全表查
 *
 * 性能优化 (2026-09-12): 改写策略——chat 内容的真实来源是项目文件，
 * db.json 仅保留 metadata 冗余备份。热路径不再写 db.json，避免
 * DbService.save() 重写 130MB 引入 ~1.36s 阻塞（实测重发端点 20.6s 阻塞
 * 即由此导致）。项目文件 + db.json 的同步由后台 DataSyncService 兜底。
 */
export async function truncateMessagesDual(chatId: string, fromMessageId: string, projectId?: string): Promise<any | null> {
  // 优先用 projectId，避免加载整个 db.json
  let resolvedProjectId = projectId;
  if (!resolvedProjectId) {
    const allChats = await DbService.getChats();
    const chatInDb = allChats.find((c: any) => String(c.id) === String(chatId));
    if (!chatInDb) return null;
    resolvedProjectId = chatInDb.projectId;
  }

  // 性能优化 (2026-09-12): 直接用项目文件做截断（最快路径，避免 130MB db.json 读写）
  if (resolvedProjectId) {
    const workspace = await DbService.getProjectWorkspace(resolvedProjectId);
    if (workspace) {
      try {
        const dataService = new ProjectDataService(workspace);
        dataService.deleteMessagesFrom(chatId, fromMessageId);
      } catch (err: any) {
        console.warn(`[ChatStorageHelper] 项目文件截断失败: ${err.message}`);
        return null;
      }
    }
  }

  return await readChat(chatId, resolvedProjectId);
}

/**
 * 双源删除会话
 * 性能优化 (2026-09-12): 项目文件同步删（真实数据源），db.json 异步删
 */
export async function deleteChatDual(chatId: string, projectId?: string): Promise<boolean> {
  // 1. 项目目录文件删除（真实数据源，同步）
  let dbChatsAfter: any = null;
  if (projectId) {
    try {
      const workspace = await DbService.getProjectWorkspace(projectId);
      if (workspace) {
        const dataService = new ProjectDataService(workspace);
        dataService.deleteChat(chatId);
      }
    } catch (err: any) {
      console.warn(`[ChatStorageHelper] 项目文件删除失败: ${err.message}`);
    }
  }

  // 2. db.json 删除（异步 fire-and-forget）
  setImmediate(() => {
    DbService.deleteChat(chatId).catch((err: any) =>
      console.warn(`[ChatStorageHelper] db.json 异步删除失败: ${err.message}`)
    );
  });
  dbChatsAfter = []; // 乐观返回

  return Array.isArray(dbChatsAfter);
}

/**
 * 创建空会话并双写
 * 性能优化 (2026-09-12): 同步创建 db.json 对象（in-memory + 写盘仍然慢），
 * 项目文件同步写。db.json 异步。
 */
export async function createChatDual(args: {
  projectId: string;
  title: string;
  agentId?: string;
  modelId?: string;
}): Promise<any> {
  // 性能优化：先在内存里构造 newChat（不阻塞），再异步 fire-and-forget db.json 写
  const newChat: any = {
    id: Date.now().toString(),
    projectId: args.projectId,
    agentId: args.agentId || '',
    title: args.title || '新会话',
    modelId: args.modelId,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. 同步写项目文件（真实数据源）
  if (args.projectId) {
    try {
      const workspace = await DbService.getProjectWorkspace(args.projectId);
      if (workspace) {
        const dataService = new ProjectDataService(workspace);
        dataService.saveChat(newChat);
      }
    } catch (err: any) {
      console.warn(`[ChatStorageHelper] 项目文件创建失败: ${err.message}`);
      return newChat;
    }
  }

  // 2. 异步 fire-and-forget 写 db.json
  // 关键 (2026-09-14): 必须传入完整 newChat（含同一个 id），
  //   旧的 DbService.createChat 会用 Date.now() 生成新 id，导致
  //   DELETE 时 filter 找不到刚创建的会话（id 不一致）。
  //   现在改用 DbService.upsertChat(chat) 接受完整 chat 对象。
  setImmediate(() => {
    DbService.upsertChat(newChat)
      .catch((err: any) => console.warn(`[ChatStorageHelper] db.json 异步创建失败: ${err.message}`));
  });

  return newChat;
}

/**
 * 列出项目的所有会话：项目目录文件 + db.json 中该项目的会话（合并去重）
 * 用于 dashboard 摘要等需要全部会话列表的场景
 */
export async function listChatsForProject(projectId: string): Promise<any[]> {
  // 性能优化 (2026-09-12): 走轻量级 workspace 缓存，避免 DbService.getProjects() 解析 130MB
  const workspace = await DbService.getProjectWorkspace(projectId);
  if (!workspace) return [];

  const fileChats: any[] = [];
  try {
    const dataService = new ProjectDataService(workspace);
    // 性能优化 (2026-09-12): 用 getChatsAsync 并发读取，39 文件 ~800ms → ~50ms
    const chats = await dataService.getChatsAsync();
    fileChats.push(...chats);
  } catch (err: any) {
    if (!workspaceWarned) {
      console.warn(`[ChatStorageHelper] 项目目录读取失败，回退 db.json: ${err.message}`);
      workspaceWarned = true;
    }
  }

  // 合并 db.json 中属于该项目但不在项目文件中的会话（遗留数据）
  const fileIds = new Set(fileChats.map(c => String(c.id)));
  const dbChats = (await DbService.getChats(projectId))
    .filter((c: any) => !fileIds.has(String(c.id)));

  // 合并并按 updatedAt 降序
  return [...fileChats, ...dbChats]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}