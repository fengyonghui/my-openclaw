import { Activity, MessageSquare, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Card, Badge } from '../components/ui';

export function ActivityPage({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        setLoading(true);
        const res = await fetch(`http://localhost:3001/api/v1/projects/${projectId}/chats`);
        const data = await res.json();
        const transformed = data.map((chat: any) => ({
          id: chat.id,
          type: 'chat',
          title: `新建会话: ${chat.title}`,
          user: 'System',
          time: new Date(chat.updatedAt).toLocaleString(),
          icon: MessageSquare,
          colorClass: 'text-primary-600 bg-primary-50'
        }));
        setActivities(transformed);
      } catch (err) { console.error(err); } finally { setLoading(false); }
    }
    fetchActivity();
  }, [projectId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Activity Logs</h1>
          <p className="text-sm text-slate-500 font-medium">监控项目内的操作记录、任务执行及 Agent 生命周期</p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-slate-100 shadow-sm">
          <Clock className="h-4 w-4 text-primary-600 animate-pulse" />
          <span className="text-xs font-black text-slate-900">Real-time Monitoring</span>
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-100" />
        <div className="space-y-12 relative">
          {activities.length === 0 ? (
            <div className="p-20 text-center opacity-30 italic flex flex-col items-center">
              <Activity className="h-12 w-12 mb-4" />
              <p className="text-sm font-bold uppercase tracking-widest">{loading ? '加载中...' : '暂无活动日志'}</p>
            </div>
          ) : (
            activities.map((activity) => (
              <div key={activity.id} className="flex gap-8 group">
                <div className={`relative z-10 p-3 rounded-2xl shadow-sm border border-slate-100 group-hover:scale-110 transition-transform ${activity.colorClass}`}>
                  <activity.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{activity.time}</span>
                    <Badge status="default">{activity.type}</Badge>
                  </div>
                  <Card className="p-5 border-slate-100 group-hover:border-primary-100 group-hover:bg-primary-50/10 transition-all">
                    <h3 className="text-sm font-black text-slate-900 mb-2">{activity.title}</h3>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed italic">
                      操作人: {activity.user}
                    </p>
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
