/**
 * SessionEventService - Session 事件存储服务
 * 
 * 记录项目中所有 Session 相关的事件，供审计和回放使用。
 * 事件存储在内存中，可选持久化到文件。
 * 
 * Phase 4 基础设施
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// ============================================
// 类型定义
// ============================================

export type EventType = 
  | 'session_start'
  | 'session_end'
  | 'stream_start'
  | 'stream_end'
  | 'tool_call'
  | 'file_lock'
  | 'file_unlock'
  | 'agent_process_start'
  | 'agent_process_end'
  | 'error';

export interface SessionEvent {
  id: string;
  type: EventType;
  projectId: string;
  chatId?: string;
  timestamp: number;
  data: Record<string, any>;
}

export interface EventQuery {
  projectId?: string;
  chatId?: string;
  type?: EventType;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

// ============================================
// 常量
// ============================================

const MAX_EVENTS_IN_MEMORY = 10000; // 内存中最多保留事件数
const DEFAULT_LIMIT = 100;
const STORAGE_FILE = 'data/session-events.jsonl';

// ============================================
// 主类
// ============================================

export class SessionEventService extends EventEmitter {
  // 内存中的事件
  private events: SessionEvent[] = [];
  
  // 事件计数器（用于生成 ID）
  private eventCounter = 0;
  
  // 持久化文件路径
  private storagePath: string;
  
  // 是否启用持久化
  private persistEnabled = false;

  // 批量写入缓冲区
  private persistBuffer: SessionEvent[] = [];
  private persistFlushTimer: NodeJS.Timeout | null = null;
  private readonly PERSIST_FLUSH_INTERVAL = 5000; // 5 秒
  private readonly PERSIST_BUFFER_SIZE = 100;    // 100 条

  constructor() {
    super();
    
    // 尝试确定存储路径
    this.storagePath = STORAGE_FILE;
    
    // 尝试启用持久化
    this.tryEnablePersistence();
    
    // 启动定时 flush
    this.startFlushTimer();
  }

  // ==========================================
  // 记录事件
  // ==========================================

  /**
   * 记录一个事件
   */
  record(type: EventType, data: Record<string, any>): SessionEvent {
    // 确保 projectId 存在
    const projectId = data.projectId as string;
    if (!projectId) {
      console.warn('[SessionEventService] Missing projectId in event:', type, data);
    }

    const event: SessionEvent = {
      id: this.generateId(),
      type,
      projectId: projectId || 'unknown',
      chatId: data.chatId,
      timestamp: Date.now(),
      data,
    };

    this.events.push(event);
    this.eventCounter++;

    // 内存限制
    if (this.events.length > MAX_EVENTS_IN_MEMORY) {
      // 删除最老的 10%
      const removeCount = Math.floor(MAX_EVENTS_IN_MEMORY * 0.1);
      this.events.splice(0, removeCount);
    }

    // 持久化缓冲
    if (this.persistEnabled) {
      this.persistBuffer.push(event);
      if (this.persistBuffer.length >= this.PERSIST_BUFFER_SIZE) {
        this.flushToDisk();
      }
    }

    this.emit('event', event);
    return event;
  }

  /**
   * 批量记录事件
   */
  recordMany(events: Array<{ type: EventType; data: Record<string, any> }>): SessionEvent[] {
    return events.map(e => this.record(e.type, e.data));
  }

  // ==========================================
  // 查询事件
  // ==========================================

  /**
   * 查询事件
   */
  query(query: EventQuery): SessionEvent[] {
    let results = [...this.events];

    if (query.projectId) {
      results = results.filter(e => e.projectId === query.projectId);
    }

    if (query.chatId) {
      results = results.filter(e => e.chatId === query.chatId);
    }

    if (query.type) {
      results = results.filter(e => e.type === query.type);
    }

    if (query.from !== undefined) {
      results = results.filter(e => e.timestamp >= query.from!);
    }

    if (query.to !== undefined) {
      results = results.filter(e => e.timestamp <= query.to!);
    }

    // 排序（按时间倒序）
    results.sort((a, b) => b.timestamp - a.timestamp);

    // 分页
    const limit = query.limit || DEFAULT_LIMIT;
    const offset = query.offset || 0;

    return results.slice(offset, offset + limit);
  }

  /**
   * 获取项目的所有事件
   */
  getProjectEvents(projectId: string, limit: number = 50): SessionEvent[] {
    return this.query({ projectId, limit });
  }

  /**
   * 获取 Chat 会话的所有事件
   */
  getChatEvents(chatId: string, limit: number = 50): SessionEvent[] {
    return this.query({ chatId, limit });
  }

  /**
   * 获取项目事件的时间线（用于 Activity 页面）
   */
  getProjectTimeline(
    projectId: string,
    limit: number = 100
  ): Array<SessionEvent & { label: string }> {
    const events = this.getProjectEvents(projectId, limit);
    
    return events.map(event => ({
      ...event,
      label: this.getEventLabel(event),
    }));
  }

  // ==========================================
  // 统计
  // ==========================================

  /**
   * 获取项目统计
   */
  getProjectStats(projectId: string): {
    totalEvents: number;
    sessionStarts: number;
    sessionEnds: number;
    toolCalls: number;
    fileLocks: number;
    errors: number;
    firstEvent: number | null;
    lastEvent: number | null;
  } {
    const events = this.query({ projectId, limit: MAX_EVENTS_IN_MEMORY });
    
    return {
      totalEvents: events.length,
      sessionStarts: events.filter(e => e.type === 'session_start').length,
      sessionEnds: events.filter(e => e.type === 'session_end').length,
      toolCalls: events.filter(e => e.type === 'tool_call').length,
      fileLocks: events.filter(e => e.type === 'file_lock').length,
      errors: events.filter(e => e.type === 'error').length,
      firstEvent: events.length > 0 ? events[events.length - 1].timestamp : null,
      lastEvent: events.length > 0 ? events[0].timestamp : null,
    };
  }

  /**
   * 获取事件计数
   */
  getEventCount(projectId?: string): number {
    if (projectId) {
      return this.events.filter(e => e.projectId === projectId).length;
    }
    return this.events.length;
  }

  // ==========================================
  // 工具
  // ==========================================

  private generateId(): string {
    return `evt_${Date.now()}_${String(++this.eventCounter).padStart(6, '0')}`;
  }

  private getEventLabel(event: SessionEvent): string {
    switch (event.type) {
      case 'session_start':
        return `会话开始 (${event.data.agentId || 'unknown'})`;
      case 'session_end':
        return `会话结束 (${event.data.duration}ms, ${event.data.messages || 0} 条消息)`;
      case 'stream_start':
        return 'AI 开始生成';
      case 'stream_end':
        return `AI 生成结束 (${event.data.toolCalls || 0} 次工具调用)`;
      case 'tool_call':
        return `工具调用: ${event.data.toolName || 'unknown'}`;
      case 'file_lock':
        return `锁定文件: ${event.data.file}`;
      case 'file_unlock':
        return `解锁文件: ${event.data.file}`;
      case 'agent_process_start':
        return `Agent 进程启动: ${event.data.agentId}`;
      case 'agent_process_end':
        return `Agent 进程结束: ${event.data.status}`;
      case 'error':
        return `错误: ${event.data.message || 'unknown'}`;
      default:
        return event.type;
    }
  }

  // ==========================================
  // 持久化
  // ==========================================

  private tryEnablePersistence(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.persistEnabled = true;
      console.log('[SessionEventService] Persistence enabled at:', this.storagePath);
    } catch (err) {
      console.warn('[SessionEventService] Failed to enable persistence:', err);
    }
  }

  private startFlushTimer(): void {
    this.persistFlushTimer = setInterval(() => {
      if (this.persistBuffer.length > 0) {
        this.flushToDisk();
      }
    }, this.PERSIST_FLUSH_INTERVAL);
  }

  private flushToDisk(): void {
    if (!this.persistEnabled || this.persistBuffer.length === 0) return;

    const toWrite = this.persistBuffer;
    this.persistBuffer = [];

    try {
      const lines = toWrite.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(this.storagePath, lines, 'utf-8');
    } catch (err) {
      console.error('[SessionEventService] Failed to write events to disk:', err);
      // 写失败时放回缓冲区
      this.persistBuffer.unshift(...toWrite);
    }
  }

  /**
   * 优雅关闭（刷新缓冲区）
   */
  shutdown(): void {
    if (this.persistFlushTimer) {
      clearInterval(this.persistFlushTimer);
    }
    this.flushToDisk();
  }

  /**
   * 清空事件（用于测试）
   */
  clear(): void {
    this.events = [];
    this.eventCounter = 0;
  }
}

export default new SessionEventService();
