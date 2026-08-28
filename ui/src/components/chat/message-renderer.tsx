import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Check, User, MessageSquare, Wrench, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { ThinkBlock, PreBlock } from './renderers';
import type { Message as MessageType } from './types';

// 空消息列表欢迎界面
export function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-6 shadow-lg">
        <MessageSquare className="h-10 w-10 text-indigo-500" />
      </div>
      <h2 className="text-xl font-bold text-slate-700 mb-2">开始新对话</h2>
      <p className="text-sm text-slate-400 text-center max-w-md">
        支持粘贴图片、拖拽文件、语音输入
      </p>
    </div>
  );
}

// 工具结果消息
export function ToolResult({ m }: { m: MessageType }) {
  return (
    <div className="flex w-full justify-start pl-14">
      <div className="max-w-[80%] w-full">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
          <div className="flex items-center gap-2 mb-1.5 font-semibold text-slate-500">
            <Wrench className="h-3.5 w-3.5" />
            <span>工具: {m.toolName || 'unknown'}</span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-700 max-h-60 overflow-y-auto">
            {m.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

// 单条消息气泡
export function MessageBubble({
  m,
  currentAgentName,
  isTyping,
  handleResend,
  handleDelete,
}: {
  m: MessageType;
  currentAgentName?: string;
  isTyping: boolean;
  handleResend?: (msg: MessageType) => void;
  handleDelete?: (msg: MessageType) => void;
}) {
  // think 标签解析
  const END_THINK = '[/think]';
  const START_THINK = '<think>';
  const tIdx = m.content.lastIndexOf(END_THINK);
  const sIdx = m.content.indexOf(START_THINK);
  let thinkContent = '';
  let rawBody = m.content;
  if (tIdx !== -1 && sIdx !== -1 && tIdx > sIdx) {
    const rawThink = m.content.slice(sIdx + START_THINK.length, tIdx);
    thinkContent = rawThink.trim();
    rawBody = m.content.slice(tIdx + END_THINK.length).trimStart();
  } else if (sIdx !== -1 && tIdx === -1) {
    rawBody = m.content;
  }
  const cleanThink = thinkContent
    .replace(/<invoke\s+[^<]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/&lt;invoke\s+[^<]*&gt;[\s\S]*?&lt;\/invoke&gt;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const cleanBody = rawBody
    .replace(/minimax:\w+\s*<invoke\s+[^<]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/minimax:\w+\s*&lt;invoke\s+[^<]*&gt;[\s\S]*?&lt;\/invoke&gt;/gi, '')
    .replace(/<invoke\s+[^<]*>[\s\S]*?<\/invoke>/gi, '')
    .replace(/&lt;invoke\s+[^<]*&gt;[\s\S]*?&lt;\/invoke&gt;/gi, '')
    .trim();

  return (
    <div className={`flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex gap-4 max-w-[80%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* 头像 */}
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md ${
          m.role === 'user'
            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
            : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500'
        }`}>
          {m.role === 'user' ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
        </div>

        <div className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
          {/* agent 进度事件 */}
          {m.role === 'assistant' && m.agentEvents && m.agentEvents.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {m.agentEvents.map((ev, idx) => (
                <div key={idx} className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 ${
                  ev.type === 'start'
                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                    : ev.task?.startsWith('❌')
                      ? 'bg-red-50 text-red-600 border border-red-100'
                      : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                }`}>
                  {ev.type === 'start' ? (
                    <>
                      <Bot className="h-3 w-3" />
                      <span><b>{ev.agentName}</b> 执行中{ev.task ? `: ${ev.task}` : ''}</span>
                    </>
                  ) : ev.task?.startsWith('❌') ? (
                    <span><b>{ev.agentName}</b> {ev.task}</span>
                  ) : (
                    <>
                      <Check className="h-3 w-3" />
                      <span><b>{ev.agentName}</b> 任务完成</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* 通知 */}
          {m.role === 'assistant' && m.notifications && m.notifications.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {m.notifications.map((n, idx) => (
                <div key={idx} className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                  ⚠️ {n}
                </div>
              ))}
            </div>
          )}
          {/* 用户附件 */}
          {m.role === 'user' && m.attachments && m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {m.attachments.map(att => {
                const isImage = att.type.startsWith('image/');
                return (
                  <div key={att.id} className="relative">
                    {isImage ? (
                      <img src={att.dataUrl || ''} alt={att.name} className="h-20 w-20 rounded-xl object-cover border border-slate-200 shadow-sm" />
                    ) : (
                      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
                        <FileText className="h-4 w-4 text-indigo-500" />
                        <span className="text-xs font-medium text-slate-600">{att.name}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 消息气泡 */}
          <div className={`px-5 py-4 rounded-2xl shadow-sm ${
            m.role === 'user'
              ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-tr-sm'
              : m.status === 'error'
                ? 'bg-red-50 border border-red-100 text-red-700'
                : 'bg-white border border-slate-100 text-slate-700 rounded-tl-sm'
          }`}>
            {m.role === 'assistant' ? (
              <div className="prose prose-sm max-w-none">
                {cleanThink && <ThinkBlock>{cleanThink}</ThinkBlock>}
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: PreBlock,
                    code: ({ inline, className, children: codeChildren, ...props }: any) => {
                      if (className || !inline) return <code className={className} {...props}>{codeChildren}</code>;
                      return <code className="bg-slate-100 text-indigo-600 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{codeChildren}</code>;
                    }
                  }}
                >
                  {cleanBody}
                </ReactMarkdown>
                {m.status === 'streaming' && (
                  <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle rounded-sm" />
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words overflow-wrap-anywhere text-sm leading-relaxed max-w-full">{m.content}</p>
            )}

            {/* 状态显示 */}
            {m.status && m.status !== 'streaming' && m.status !== 'error' && (
              <div className="mt-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
                {m.status}
              </div>
            )}
          </div>

          {/* 发送者标签 */}
          <span className="mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
            {m.role === 'user' ? '你' : (currentAgentName || '助手')}
          </span>

          {/* 重发和删除按钮 */}
          {m.role === 'user' && handleResend && handleDelete && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => handleResend(m)}
                disabled={isTyping}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重发
              </button>
              <button
                onClick={() => handleDelete(m)}
                disabled={isTyping}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-600 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
