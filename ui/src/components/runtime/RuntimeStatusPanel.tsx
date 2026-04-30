/**
 * RuntimeStatusPanel - 项目运行时状态面板
 * 
 * Phase 4: 展示项目的实时运行状态
 * - 活跃会话数
 * - 流式生成中
 * - 工具调用统计
 * - 锁定的文件
 * - 最近事件时间线
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Zap, Lock, Clock, Bot, MessageSquare,
  ChevronDown, ChevronUp, RefreshCw, AlertCircle, CheckCircle2
} from 'lucide-react';
import { Card, Badge } from '../ui';

interface RuntimeStatus {
  online: boolean;
  activeChats: number;
  activeStreams: number;
  totalSessions: number;
  totalToolCalls: number;
  agentProcesses: number;
  lastActivity: number | null;
  uptime: number;
  locked: boolean;
  lockedFiles: number;
  lockStats: number;
  recentEvents: Array<{
    id?: string;
    type: string;
    timestamp: number;
    chatId?: string;
  }>;
}

interface RuntimeStatusPanelProps {
  projectId: string;
  projectName?: string;
}

function formatUptime(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}秒`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}分钟`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}小时`;
  return `${Math.floor(ms / 86400000)}天`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function getEventLabel(type: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    session_start: { label: '会话开始', color: 'bg-emerald-100 text-emerald-700' },
    session_end: { label: '会话结束', color: 'bg-slate-100 text-slate-700' },
    stream_start: { label: '开始生成', color: 'bg-blue-100 text-blue-700' },
    stream_end: { label: '生成结束', color: 'bg-indigo-100 text-indigo-700' },
    tool_call: { label: '工具调用', color: 'bg-amber-100 text-amber-700' },
    file_lock: { label: '锁定文件', color: 'bg-orange-100 text-orange-700' },
    file_unlock: { label: '解锁文件', color: 'bg-teal-100 text-teal-700' },
    agent_process_start: { label: 'Agent 启动', color: 'bg-violet-100 text-violet-700' },
    agent_process_end: { label: 'Agent 结束', color: 'bg-purple-100 text-purple-700' },
    error: { label: '错误', color: 'bg-rose-100 text-rose-700' },
  };
  return map[type] || { label: type, color: 'bg-slate-100 text-slate-600' };
}

export function RuntimeStatusPanel({ projectId, projectName }: RuntimeStatusPanelProps) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/status`);
      if (!res.ok) throw new Error('获取状态失败');
      const data = await res.json();
      setStatus(data.runtime || data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // 初始加载
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 自动刷新（仅在有流式会话时）
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      if (status?.activeStreams && status.activeStreams > 0) {
        // 有活跃流时每 2 秒刷新
        fetchStatus();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [autoRefresh, status?.activeStreams, fetchStatus]);

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-600 to-slate-700">
          <Activity className="h-5 w-5 text-white opacity-80" />
          <h3 className="font-bold text-white">运行时状态</h3>
        </div>
        <div className="p-6 flex items-center justify-center">
          <RefreshCw className="h-5 w-5 animate-spin text-slate-400 mr-2" />
          <span className="text-slate-500">加载中...</span>
        </div>
      </Card>
    );
  }

  if (error || !status) {
    return (
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-600 to-slate-700">
          <Activity className="h-5 w-5 text-white opacity-80" />
          <h3 className="font-bold text-white">运行时状态</h3>
        </div>
        <div className="p-6 flex items-center gap-2 text-rose-500">
          <AlertCircle className="h-5 w-5" />
          <span>{error || '无法获取状态'}</span>
          <button onClick={fetchStatus} className="ml-auto text-sm hover:underline">
            重试
          </button>
        </div>
      </Card>
    );
  }

  const isActive = status.online || status.activeStreams > 0;

  return (
    <Card className="overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-600 to-slate-700">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-white opacity-80" />
          <h3 className="font-bold text-white">运行时状态</h3>
          <Badge 
            className={`${isActive ? 'bg-emerald-500' : 'bg-slate-500'} text-white border-0`}
          >
            {isActive ? (
              <><span className="relative flex h-2 w-2 mr-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>在线</>
            ) : '离线'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStatus}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 状态指标 */}
      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* 活跃会话 */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <MessageSquare className="h-3.5 w-3.5" />
              活跃会话
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${status.activeChats > 0 ? 'text-indigo-600' : 'text-slate-600'}`}>
                {status.activeChats}
              </span>
              {status.activeStreams > 0 && (
                <Badge className="bg-blue-500 text-white border-0 text-xs animate-pulse">
                  {status.activeStreams} 生成中
                </Badge>
              )}
            </div>
          </div>

          {/* 总工具调用 */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Zap className="h-3.5 w-3.5" />
              工具调用
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-amber-600">
                {status.totalToolCalls}
              </span>
              <span className="text-xs text-slate-400">次</span>
            </div>
          </div>

          {/* 运行时长 */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Clock className="h-3.5 w-3.5" />
              运行时长
            </div>
            <div className="text-2xl font-bold text-slate-600">
              {formatUptime(status.uptime)}
            </div>
          </div>

          {/* 文件锁 */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Lock className="h-3.5 w-3.5" />
              文件锁
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${status.locked ? 'text-orange-600' : 'text-slate-600'}`}>
                {status.lockedFiles}
              </span>
              <span className="text-xs text-slate-400">个</span>
            </div>
          </div>
        </div>
      </div>

      {/* 展开内容：最近事件 */}
      {expanded && (
        <div className="border-t border-slate-100">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                最近事件 ({status.recentEvents?.length || 0})
              </span>
              {status.lastActivity && (
                <span className="text-xs text-slate-400">
                  最后活动: {formatRelativeTime(status.lastActivity)}
                </span>
              )}
            </div>
          </div>

          {status.recentEvents && status.recentEvents.length > 0 ? (
            <div className="max-h-64 overflow-y-auto">
              {status.recentEvents.map((event, idx) => {
                const { label, color } = getEventLabel(event.type);
                return (
                  <div 
                    key={event.id || `${event.type}-${idx}-${event.timestamp}`}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors"
                  >
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
                      {label}
                    </span>
                    {event.chatId && (
                      <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">
                        {event.chatId.slice(0, 8)}...
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-slate-400 text-sm">
              暂无事件记录
            </div>
          )}
        </div>
      )}

      {/* 底部状态栏 */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span>总会话: {status.totalSessions}</span>
        {status.agentProcesses > 0 && (
          <span className="flex items-center gap-1">
            <Bot className="h-3 w-3" />
            Agent 进程: {status.agentProcesses}
          </span>
        )}
        <span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            自动刷新
          </label>
        </span>
      </div>
    </Card>
  );
}

export default RuntimeStatusPanel;
