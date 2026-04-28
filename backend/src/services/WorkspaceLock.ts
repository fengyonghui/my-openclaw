/**
 * WorkspaceLock - Workspace 文件级并发锁
 * 
 * 防止多个 Chat 会话同时写入同一项目的工作空间文件。
 * 使用内存锁 + TTL 自动过期，适合单机部署。
 * 
 * Phase 4 基础设施
 */

import { EventEmitter } from 'events';

// ============================================
// 类型定义
// ============================================

export interface LockEntry {
  projectId: string;
  file: string;        // 相对于 workspace 的路径
  owner: string;       // chatId
  lockedAt: number;
  expiresAt: number;
}

export interface LockResult {
  success: boolean;
  existingLock?: LockEntry;
}

// ============================================
// 常量
// ============================================

const DEFAULT_TTL_MS = 30 * 1000;  // 默认 30 秒
const LOCK_INTERVAL_MS = 10 * 1000; // 每 10 秒清理过期锁

// ============================================
// 主类
// ============================================

export class WorkspaceLock extends EventEmitter {
  // 锁存储: key = `${projectId}:${file}`
  private locks = new Map<string, LockEntry>();

  // 定时清理
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startCleanup();
  }

  // ==========================================
  // 锁操作
  // ==========================================

  /**
   * 获取锁
   * 
   * @param projectId 项目 ID
   * @param file 文件路径（相对于 workspace）
   * @param owner 锁持有者（通常是 chatId）
   * @param ttlMs 锁有效期（毫秒）
   * @returns true = 获取成功, false = 已被占用
   */
  acquire(
    projectId: string,
    file: string,
    owner: string,
    ttlMs: number = DEFAULT_TTL_MS
  ): boolean {
    const key = this.makeKey(projectId, file);
    const now = Date.now();

    // 检查是否已被占用
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now && existing.owner !== owner) {
      return false;
    }

    // 设置/更新锁
    const entry: LockEntry = {
      projectId,
      file,
      owner,
      lockedAt: now,
      expiresAt: now + ttlMs,
    };

    this.locks.set(key, entry);
    this.emit('acquired', entry);
    return true;
  }

  /**
   * 释放锁
   */
  release(projectId: string, file: string, owner: string): boolean {
    const key = this.makeKey(projectId, file);
    const existing = this.locks.get(key);

    if (!existing) {
      return false;
    }

    // 只有锁持有者可以释放
    if (existing.owner !== owner) {
      return false;
    }

    this.locks.delete(key);
    this.emit('released', { projectId, file, owner });
    return true;
  }

  /**
   * 强制释放锁（管理员操作）
   */
  forceRelease(projectId: string, file: string): boolean {
    const key = this.makeKey(projectId, file);
    const existed = this.locks.delete(key);
    if (existed) {
      this.emit('force_released', { projectId, file });
    }
    return existed;
  }

  /**
   * 释放某个 owner 的所有锁
   */
  releaseAllByOwner(owner: string): number {
    let count = 0;
    for (const [key, entry] of this.locks.entries()) {
      if (entry.owner === owner) {
        this.locks.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.emit('batch_released', { owner, count });
    }
    return count;
  }

  /**
   * 检查文件是否被锁定
   */
  isLocked(projectId: string, file: string): boolean {
    const key = this.makeKey(projectId, file);
    const entry = this.locks.get(key);
    
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      // 已过期，自动清理
      this.locks.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 获取锁信息
   */
  getLock(projectId: string, file: string): LockEntry | null {
    const key = this.makeKey(projectId, file);
    const entry = this.locks.get(key);
    
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * 获取项目的所有锁
   */
  getProjectLocks(projectId: string): LockEntry[] {
    const now = Date.now();
    const result: LockEntry[] = [];

    for (const entry of this.locks.values()) {
      if (entry.projectId !== projectId) continue;
      if (entry.expiresAt <= now) {
        this.locks.delete(this.makeKey(entry.projectId, entry.file));
        continue;
      }
      result.push(entry);
    }

    return result;
  }

  /**
   * 获取所有锁
   */
  getAllLocks(): LockEntry[] {
    this.cleanupExpired();
    return Array.from(this.locks.values());
  }

  /**
   * 续期锁
   */
  renew(projectId: string, file: string, owner: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
    const key = this.makeKey(projectId, file);
    const entry = this.locks.get(key);

    if (!entry || entry.owner !== owner) {
      return false;
    }

    entry.expiresAt = Date.now() + ttlMs;
    return true;
  }

  // ==========================================
  // 清理
  // ==========================================

  /**
   * 清理过期锁
   */
  cleanupExpired(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.locks.entries()) {
      if (entry.expiresAt <= now) {
        this.locks.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.emit('cleanup', { count });
    }

    return count;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, LOCK_INTERVAL_MS);
  }

  /**
   * 停止清理定时器（用于测试或优雅关闭）
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ==========================================
  // 工具
  // ==========================================

  private makeKey(projectId: string, file: string): string {
    // 标准化路径
    const normalizedFile = file.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${projectId}:${normalizedFile}`;
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byProject: Record<string, number> } {
    const byProject: Record<string, number> = {};
    
    for (const entry of this.locks.values()) {
      if (entry.expiresAt <= Date.now()) continue;
      byProject[entry.projectId] = (byProject[entry.projectId] || 0) + 1;
    }

    return {
      total: Object.values(byProject).reduce((a, b) => a + b, 0),
      byProject,
    };
  }
}

export default new WorkspaceLock();
