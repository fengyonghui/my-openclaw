/**
 * ProjectRuntimeManager - 项目级运行时管理器
 * 
 * 统一管理所有项目的运行时状态：
 * - SSE 连接追踪
 * - 活跃 Chat 会话
 * - Agent 进程状态
 * - Workspace 锁状态
 * - 心跳监控
 * 
 * Phase 4 核心基础设施
 */

import { EventEmitter } from 'events';
import { WorkspaceLock } from './WorkspaceLock.js';
import { SessionEventService } from './SessionEventService.js';

// ============================================
// 类型定义
// ============================================

export interface ChatSession {
  chatId: string;
  projectId: string;
  agentId: string;
  modelId: string;
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
  toolCallsCount: number;
  status: 'active' | 'idle' | 'streaming';
  abortController?: AbortController;
  sseConnectionId?: string;
}

export interface AgentProcess {
  processId: string;
  projectId: string;
  agentId: string;
  type: 'delegate' | 'subagent';
  startedAt: number;
  pid?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number;
}

export interface ProjectRuntimeStatus {
  projectId: string;
  online: boolean;
  activeChats: number;
  activeStreams: number;
  totalSessions: number;
  totalToolCalls: number;
  agentProcesses: number;
  lastActivity: number | null;
  uptime: number;
  lockedFiles: number;
  locked: boolean;
}

export interface WorkspaceLockInfo {
  projectId: string;
  file: string;
  lockedBy: string; // chatId
  lockedAt: number;
  expiresAt: number;
}

// ============================================
// 主类
// ============================================

export class ProjectRuntimeManager extends EventEmitter {
  // 项目级 Chat 会话
  private chatSessions = new Map<string, ChatSession>();
  
  // Agent 子进程
  private agentProcesses = new Map<string, AgentProcess>();
  
  // Workspace 锁
  private workspaceLock: WorkspaceLock;
  
  // Session 事件存储
  private sessionEventService: SessionEventService;
  
  // SSE 连接追踪 (projectId -> Set<connectionId>)
  private sseConnections = new Map<string, Set<string>>();
  
  // 统计
  private totalSessions = 0;
  private totalToolCalls = 0;
  private projectStartTimes = new Map<string, number>();

  constructor() {
    super();
    this.workspaceLock = new WorkspaceLock();
    this.sessionEventService = new SessionEventService();
    
    // 设置会话超时清理 (5分钟 idle)
    setInterval(() => this.cleanupIdleSessions(), 60 * 1000);
  }

  // ==========================================
  // Chat 会话管理
  // ==========================================

  /**
   * 创建新的 Chat 会话
   */
  createChatSession(params: {
    chatId: string;
    projectId: string;
    agentId: string;
    modelId: string;
    abortController?: AbortController;
  }): ChatSession {
    // 如果已存在，先移除旧的
    if (this.chatSessions.has(params.chatId)) {
      this.removeChatSession(params.chatId);
    }

    const session: ChatSession = {
      chatId: params.chatId,
      projectId: params.projectId,
      agentId: params.agentId,
      modelId: params.modelId,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      messageCount: 0,
      toolCallsCount: 0,
      status: 'idle',
      abortController: params.abortController,
    };

    this.chatSessions.set(params.chatId, session);
    this.totalSessions++;
    
    // 初始化项目启动时间
    if (!this.projectStartTimes.has(params.projectId)) {
      this.projectStartTimes.set(params.projectId, Date.now());
    }

    // 记录事件
    this.sessionEventService.record('session_start', {
      chatId: params.chatId,
      projectId: params.projectId,
      agentId: params.agentId,
      modelId: params.modelId,
    });

    this.emit('session:created', session);
    return session;
  }

  /**
   * 获取会话
   */
  getChatSession(chatId: string): ChatSession | undefined {
    return this.chatSessions.get(chatId);
  }

  /**
   * 更新会话状态
   */
  updateSession(chatId: string, updates: Partial<ChatSession>): void {
    const session = this.chatSessions.get(chatId);
    if (!session) return;

    Object.assign(session, updates, { lastActiveAt: Date.now() });
    
    if (updates.status === 'streaming') {
      this.emit('session:streaming', session);
    }
  }

  /**
   * 增加消息计数
   */
  incrementMessageCount(chatId: string): void {
    const session = this.chatSessions.get(chatId);
    if (session) {
      session.messageCount++;
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * 增加工具调用计数
   */
  incrementToolCalls(chatId: string): void {
    const session = this.chatSessions.get(chatId);
    if (session) {
      session.toolCallsCount++;
      this.totalToolCalls++;
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * 开始流式响应
   */
  startStreaming(chatId: string, sseConnectionId: string): void {
    const session = this.chatSessions.get(chatId);
    if (session) {
      session.status = 'streaming';
      session.sseConnectionId = sseConnectionId;
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * 结束流式响应
   */
  stopStreaming(chatId: string): void {
    const session = this.chatSessions.get(chatId);
    if (session) {
      session.status = 'active';
      session.lastActiveAt = Date.now();
      
      // 记录流结束事件
      this.sessionEventService.record('stream_end', {
        chatId,
        projectId: session.projectId,
        toolCalls: session.toolCallsCount,
      });
    }
  }

  /**
   * 移除会话
   */
  removeChatSession(chatId: string): void {
    const session = this.chatSessions.get(chatId);
    if (!session) return;

    // 清理 abort controller
    if (session.abortController) {
      try { session.abortController.abort(); } catch {}
    }

    // 释放所有锁
    this.workspaceLock.releaseAllByOwner(chatId);

    // 记录事件
    this.sessionEventService.record('session_end', {
      chatId,
      projectId: session.projectId,
      duration: Date.now() - session.startedAt,
      messages: session.messageCount,
      toolCalls: session.toolCallsCount,
    });

    this.chatSessions.delete(chatId);
    this.emit('session:ended', session);
  }

  /**
   * 清理空闲会话 (5分钟无活动)
   */
  private cleanupIdleSessions(): void {
    const now = Date.now();
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟

    for (const [chatId, session] of this.chatSessions.entries()) {
      if (session.status !== 'streaming' && now - session.lastActiveAt > IDLE_TIMEOUT) {
        console.log(`[RuntimeManager] Cleaning up idle session: ${chatId}`);
        this.removeChatSession(chatId);
      }
    }

    // 清理过期的锁
    this.workspaceLock.cleanupExpired();
  }

  /**
   * 获取项目的所有会话
   */
  getProjectSessions(projectId: string): ChatSession[] {
    return Array.from(this.chatSessions.values())
      .filter(s => s.projectId === projectId);
  }

  // ==========================================
  // Agent 进程管理
  // ==========================================

  /**
   * 注册 Agent 进程
   */
  registerAgentProcess(process: AgentProcess): void {
    this.agentProcesses.set(process.processId, process);
    
    this.sessionEventService.record('agent_process_start', {
      processId: process.processId,
      projectId: process.projectId,
      agentId: process.agentId,
      type: process.type,
    });

    this.emit('process:started', process);
  }

  /**
   * 更新进程状态
   */
  updateAgentProcess(processId: string, updates: Partial<AgentProcess>): void {
    const process = this.agentProcesses.get(processId);
    if (!process) return;

    const wasRunning = process.status === 'running';
    Object.assign(process, updates);

    if (wasRunning && process.status !== 'running') {
      this.emit('process:ended', process);
      
      this.sessionEventService.record('agent_process_end', {
        processId,
        projectId: process.projectId,
        status: process.status,
        exitCode: process.exitCode,
      });
    }
  }

  /**
   * 获取项目的所有 Agent 进程
   */
  getProjectProcesses(projectId: string): AgentProcess[] {
    return Array.from(this.agentProcesses.values())
      .filter(p => p.projectId === projectId && p.status === 'running');
  }

  // ==========================================
  // SSE 连接追踪
  // ==========================================

  /**
   * 注册 SSE 连接
   */
  registerSSEConnection(projectId: string, connectionId: string): void {
    if (!this.sseConnections.has(projectId)) {
      this.sseConnections.set(projectId, new Set());
    }
    this.sseConnections.get(projectId)!.add(connectionId);
    
    this.emit('sse:connected', { projectId, connectionId });
  }

  /**
   * 移除 SSE 连接
   */
  removeSSEConnection(projectId: string, connectionId: string): void {
    const connections = this.sseConnections.get(projectId);
    if (connections) {
      connections.delete(connectionId);
      if (connections.size === 0) {
        this.sseConnections.delete(projectId);
      }
    }
    
    this.emit('sse:disconnected', { projectId, connectionId });
  }

  /**
   * 获取 SSE 连接数
   */
  getSSEConnectionCount(projectId: string): number {
    return this.sseConnections.get(projectId)?.size ?? 0;
  }

  // ==========================================
  // Workspace 锁
  // ==========================================

  /**
   * 获取锁服务
   */
  getLockService(): WorkspaceLock {
    return this.workspaceLock;
  }

  /**
   * 锁定文件
   */
  async acquireLock(
    projectId: string,
    file: string,
    chatId: string,
    ttlMs: number = 30 * 1000
  ): Promise<boolean> {
    const acquired = this.workspaceLock.acquire(projectId, file, chatId, ttlMs);
    
    if (acquired) {
      this.sessionEventService.record('file_lock', {
        projectId,
        file,
        chatId,
      });
      this.emit('lock:acquired', { projectId, file, chatId });
    }
    
    return acquired;
  }

  /**
   * 释放锁
   */
  releaseLock(projectId: string, file: string, chatId: string): void {
    this.workspaceLock.release(projectId, file, chatId);
    
    this.sessionEventService.record('file_unlock', {
      projectId,
      file,
      chatId,
    });
    this.emit('lock:released', { projectId, file, chatId });
  }

  // ==========================================
  // Session Events
  // ==========================================

  /**
   * 获取事件服务
   */
  getEventService(): SessionEventService {
    return this.sessionEventService;
  }

  /**
   * 查询项目事件历史
   */
  getProjectEvents(projectId: string, limit: number = 50): any[] {
    return this.sessionEventService.getProjectEvents(projectId, limit);
  }

  // ==========================================
  // 状态汇总
  // ==========================================

  /**
   * 获取项目运行时状态
   */
  getProjectStatus(projectId: string): ProjectRuntimeStatus {
    const sessions = this.getProjectSessions(projectId);
    const processes = this.getProjectProcesses(projectId);
    const lockedFiles = this.workspaceLock.getProjectLocks(projectId);
    const startTime = this.projectStartTimes.get(projectId) || Date.now();

    return {
      projectId,
      online: sessions.length > 0 || processes.length > 0,
      activeChats: sessions.filter(s => s.status !== 'streaming').length,
      activeStreams: sessions.filter(s => s.status === 'streaming').length,
      totalSessions: sessions.length,
      totalToolCalls: sessions.reduce((sum, s) => sum + s.toolCallsCount, 0),
      agentProcesses: processes.length,
      lastActivity: sessions.length > 0
        ? Math.max(...sessions.map(s => s.lastActiveAt))
        : null,
      uptime: Date.now() - startTime,
      lockedFiles: lockedFiles.length,
      locked: lockedFiles.length > 0,
    };
  }

  /**
   * 获取全局统计
   */
  getGlobalStats(): {
    totalSessions: number;
    totalToolCalls: number;
    activeProjects: number;
    totalProjects: number;
  } {
    return {
      totalSessions: this.chatSessions.size,
      totalToolCalls: this.totalToolCalls,
      activeProjects: new Set(
        Array.from(this.chatSessions.values()).map(s => s.projectId)
      ).size,
      totalProjects: this.projectStartTimes.size,
    };
  }

  /**
   * 获取所有活跃项目的状态
   */
  getAllActiveProjectStatuses(): ProjectRuntimeStatus[] {
    const activeProjectIds = new Set(
      Array.from(this.chatSessions.values()).map(s => s.projectId)
    );
    
    return Array.from(activeProjectIds).map(id => this.getProjectStatus(id));
  }
}

// ============================================
// 单例（类定义之后实例化，避免 ESM 初始化顺序问题）
// ============================================

export const projectRuntimeManager = new ProjectRuntimeManager();

export default projectRuntimeManager;
