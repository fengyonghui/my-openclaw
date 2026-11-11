/**
 * db.json 瘦身迁移脚本（2026-11-11）
 *
 * 背景：
 *   db.json 的 chats 数组存的是会话全文副本，与项目文件
 *   <workspace>/data/chats/<id>.json 重复。184 条会话里 175 条在项目文件中
 *   已有副本 —— db.json 的 113MB 几乎全是冗余，且因热路径不写 db.json 而陈旧。
 *
 * 做什么：
 *   把「项目文件里已存在」的会话在 db.json 里降级为元数据索引；
 *   「项目文件不存在」的会话（孤儿）保留正文 —— 其 workspace 目录已删除，
 *   正文只此一份，丢了就真没了。
 *
 * 用法：
 *   npx tsx backend/scripts/migrate-db-slim.ts --dry-run   # 只报告
 *   npx tsx backend/scripts/migrate-db-slim.ts             # 实际执行
 *
 * 安全性：
 *   - 默认 --dry-run，只报告不写盘
 *   - 写盘前自动备份 db.json → db.json.bak-<timestamp>
 *   - 只改 db.json，不动任何项目文件
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'db.json');

const dryRun = process.argv.includes('--dry-run');

function toChatIndex(chat: any): any {
  return {
    id: chat.id,
    projectId: chat.projectId,
    agentId: chat.agentId,
    modelId: chat.modelId,
    title: chat.title ?? chat.name,
    name: chat.name,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    // 会话级记忆（L1）：体积很小且是有效数据，保留
    ...(Array.isArray(chat.sessionMemory) && chat.sessionMemory.length
      ? { sessionMemory: chat.sessionMemory }
      : {}),
    _indexOnly: true,
  };
}

function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`[Migrate] db.json 不存在: ${DB_PATH}`);
    process.exit(1);
  }

  const beforeSize = statSync(DB_PATH).size;
  console.log(`[Migrate] db.json 原始大小: ${(beforeSize / 1024 / 1024).toFixed(2)} MB`);

  const db = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
  const chats: any[] = db.chats || [];
  const wsMap = new Map<string, string>();
  for (const p of db.projects || []) {
    if (p?.id && p?.workspace) wsMap.set(p.id, p.workspace);
  }

  let slimmed = 0;
  let keptBody = 0;
  let keptBodyBytes = 0;

  const nextChats = chats.map((chat) => {
    const ws = chat.projectId ? wsMap.get(chat.projectId) : undefined;

    // workspace 缺失或目录不存在 → 孤儿：正文只此一份，必须保留
    const isOrphan = !ws || !existsSync(ws);
    if (isOrphan) {
      keptBody++;
      keptBodyBytes += JSON.stringify(chat).length;
      return chat;
    }

    // 项目文件里已有该会话 → db.json 只留元数据
    const projFile = path.join(ws, 'data', 'chats', `${chat.id}.json`);
    if (existsSync(projFile)) {
      slimmed++;
      return toChatIndex(chat);
    }

    // 项目 workspace 在但会话文件不在 → 同样按孤儿处理（正文只此一份）
    keptBody++;
    keptBodyBytes += JSON.stringify(chat).length;
    return chat;
  });

  db.chats = nextChats;

  const after = JSON.stringify(db, null, 2);
  const afterSize = Buffer.byteLength(after, 'utf-8');

  console.log(`[Migrate] 降级为元数据索引: ${slimmed} 条`);
  console.log(`[Migrate] 保留正文（孤儿会话）: ${keptBody} 条 (${(keptBodyBytes / 1024).toFixed(1)} KB)`);
  console.log(`[Migrate] 迁移后大小: ${(afterSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[Migrate] 减少: ${((beforeSize - afterSize) / 1024 / 1024).toFixed(2)} MB (${((1 - afterSize / beforeSize) * 100).toFixed(1)}%)`);

  if (dryRun) {
    console.log('\n[Migrate] --dry-run 模式，未写盘。去掉该参数以实际执行。');
    return;
  }

  const bak = `${DB_PATH}.bak-${Date.now()}`;
  copyFileSync(DB_PATH, bak);
  console.log(`[Migrate] 已备份: ${bak}`);

  writeFileSync(DB_PATH, after, 'utf-8');
  console.log(`[Migrate] 写盘完成: ${DB_PATH}`);
}

main();
