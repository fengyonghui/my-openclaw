/**
 * WorkspaceLock 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceLock } from '../../src/services/WorkspaceLock';

describe('WorkspaceLock', () => {
  let lock: WorkspaceLock;

  beforeEach(() => {
    lock = new WorkspaceLock();
  });

  afterEach(() => {
    lock.stopCleanup();
  });

  it('should acquire a lock', () => {
    const result = lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    expect(result).toBe(true);
  });

  it('should not allow duplicate lock on same file', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const result = lock.acquire('proj1', 'src/app.ts', 'chat2', 5000);
    expect(result).toBe(false);
  });

  it('should allow same owner to renew lock', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const result = lock.acquire('proj1', 'src/app.ts', 'chat1', 10000);
    expect(result).toBe(true);
  });

  it('should release lock by owner', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const released = lock.release('proj1', 'src/app.ts', 'chat1');
    expect(released).toBe(true);
    expect(lock.isLocked('proj1', 'src/app.ts')).toBe(false);
  });

  it('should not allow non-owner to release lock', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const released = lock.release('proj1', 'src/app.ts', 'chat2');
    expect(released).toBe(false);
    expect(lock.isLocked('proj1', 'src/app.ts')).toBe(true);
  });

  it('should release all locks by owner', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    lock.acquire('proj1', 'src/index.ts', 'chat1', 5000);
    lock.acquire('proj1', 'src/util.ts', 'chat1', 5000);
    lock.acquire('proj2', 'README.md', 'chat1', 5000);
    const count = lock.releaseAllByOwner('chat1');
    expect(count).toBe(4);
  });

  it('should get project locks', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    lock.acquire('proj1', 'src/index.ts', 'chat2', 5000);
    lock.acquire('proj2', 'README.md', 'chat3', 5000);
    const proj1Locks = lock.getProjectLocks('proj1');
    expect(proj1Locks.length).toBe(2);
  });

  it('should get lock info', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const info = lock.getLock('proj1', 'src/app.ts');
    expect(info).not.toBeNull();
    expect(info?.owner).toBe('chat1');
  });

  it('should force release lock', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    const result = lock.forceRelease('proj1', 'src/app.ts');
    expect(result).toBe(true);
    expect(lock.isLocked('proj1', 'src/app.ts')).toBe(false);
  });

  it('should get stats', () => {
    lock.acquire('proj1', 'src/app.ts', 'chat1', 5000);
    lock.acquire('proj1', 'src/index.ts', 'chat2', 5000);
    lock.acquire('proj2', 'README.md', 'chat3', 5000);
    const stats = lock.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byProject['proj1']).toBe(2);
    expect(stats.byProject['proj2']).toBe(1);
  });
});
