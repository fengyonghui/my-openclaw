import { Activity, MessageSquare, Clock, Heart, Zap, Settings, Bot, Bell, ChevronRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Badge } from '../components/ui';

type ActivityItem = {
  id: string;
  type: 'chat' | 'heartbeat' | 'project' | 'agent' | 'system';
  title: string;
  description?: string;
  user: string;
  time: Date;
  icon: any;
  colorClass: string;
};

export function ActivityPage({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        setLoading(true);
        const [chatRes, heartbeatRes] = await Promise.all([
          fetch(`http://localhost:3001/api/v1/projects/${projectId}/chats`),
          fetch(`http://localhost:3001/api/v1/heartbeats/history?projectId=${projectId}&limit=20`)
        ]);

        const chats = await chatRes.json().catch(() => []);
        const heartbeats = await heartbeatRes.json().catch(() => []);

        const chatItems: ActivityItem[] = (Array.isArray(chats) ? chats : []).map((chat: any) => ({
          id: `chat-${chat.id}`,
          type: 'chat' as const,
          title: chat.title || chat.name || '新会话',
          description: `${(chat.messages || []).length} 条消息`,
          user: 'User / Assistant',
          time: new Date(chat.updatedAt || chat.createdAt),
          icon: MessageSquare,
          colorClass: 'text-indigo-600 bg-indigo-50'
        }));

        const heartbeatItems: ActivityItem[] = (Array.isArray(heartbeats) ? heartbeats : []).map((hb: any) => ({
          id: `hb-${hb.id}`,
          type: 'heartbeat' as const,
          title: hb.name || '心跳任务',
          description: hb.result?.slice(0, 100) || hb.status || '已执行',
          user: 'Heartbeat Agent',
          time: new Date(hb.executedAt || hb.timestamp || Date.now()),
          icon: Heart,
          colorClass: 'text-rose-600 bg-rose-50'
        }));

        // 合并并按时间倒序
        const all = [...chatItems, ...heartbeatItems].sort((a, b) => b.time.getTime() - a.time.getTime());
        setActivities(all);
      } catch (err) {
        console.error('Failed to load activity:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchActivity();
  }, [projectId]);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const typeLabels: Record<string, string> = {
    chat: '对话',
    heartbeat: '心跳',
    project: '项目',
    agent: 'Agent',
    system: '系统'
  };

  const typeColors: Record<string, string> = {
    chat: 'bg-indigo-100 text-indigo-700',
    heartbeat: 'bg-rose-100 text-rose-700',
    project: 'bg-emerald-100 text-emerald-700',
    agent: 'bg-amber-100 text-amber-700',
    system: 'bg-slate-100 text-slate-700'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Activity Logs</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">监控项目内的操作记录、任务执行及 Agent 生命周期</p>
        </div>
        <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl border border-slate-100 shadow-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-black text-slate-700">Real-time</span>
          <Clock className="h-4 w-4 text-slate-400" />
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="relative">
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-200 via-purple-200 to-slate-100" />
        <div className="space-y-6 relative">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="flex flex-col items-center gap-4 opacity-50">
                <Activity className="h-10 w-10 text-indigo-500 animate-pulse" />
                <p className="text-sm font-bold text-slate-500">加载活动日志中...</p>
              </div>
            </div>
          ) : activities.length === 0 ? (
            <div className="p-20 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                <Activity className="h-10 w-10 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-400 mb-2">暂无活动日志</h3>
              <p className="text-sm text-slate-400">开始对话或配置心跳任务后，这里将显示活动记录</p>
            </div>
          ) : (
            activities.map((activity, idx) => (
              <div key={activity.id} className="flex gap-6 group">
                {/* Icon */}
                <div className={`relative z-10 flex-shrink-0 w-14 h-14 rounded-2xl ${activity.colorClass} border border-white shadow-sm flex items-center justify-center group-hover:scale-110 group-hover:shadow-md transition-all duration-300`}>
                  <activity.icon className="h-6 w-6" />
                </div>
                
                {/* Content */}
                <div className={`flex-1 pt-2 pb-8 ${idx === activities.length - 1 ? '' : 'border-b border-slate-100'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-black text-slate-400 tracking-wider">
                      {formatTime(activity.time)}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${typeColors[activity.type]}`}>
                      {typeLabels[activity.type] || activity.type}
                    </span>
                  </div>
                  
                  <Card className="p-5 border border-slate-100 group-hover:border-indigo-100 group-hover:bg-indigo-50/30 transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-base font-black text-slate-900 mb-1.5">{activity.title}</h3>
                        {activity.description && (
                          <p className="text-xs text-slate-500 font-medium leading-relaxed">
                            {activity.description}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-400 font-semibold mt-2 uppercase tracking-wide">
                          操作人: {activity.user}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-400 transition-colors flex-shrink-0 mt-1" />
                    </div>
                  </Card>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
